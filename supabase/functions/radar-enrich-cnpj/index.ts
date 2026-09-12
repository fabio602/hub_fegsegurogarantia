// ============================================================================
// radar-enrich-cnpj
//
// Enriquecimento cadastral das empresas do Radar (radar_empresas) pela
// BrasilAPI (https://brasilapi.com.br/api/cnpj/v1/{cnpj}, publica, sem chave).
//
// Por execucao (cron radar-enrich-hourly, a cada hora das 08h as 22h BRT):
//   - pega ate 60 empresas com enriquecido_em nulo e status 'novo', na ordem
//     de score (desempate por valor_total);
//   - uma requisicao por vez, 1200 ms de pausa, timeout de 10 s;
//   - sucesso: preenche cadastro, socios, e-mail e telefone, aplica as
//     exclusoes pos-enriquecimento (Simples/MEI, CNAE 64/65, cadastro nao
//     ativo) e recalcula o score;
//   - 404: marca nao encontrado e exclui;
//   - 429 ou 5xx: registra o codigo em enriquecimento_erro, NAO marca
//     enriquecido_em e encerra a execucao (a proxima rodada tenta de novo).
//
// A Edge Function deste projeto e encerrada aos 150 s: a execucao para por
// conta propria aos 120 s e devolve o que fez; o resto fica para a proxima hora.
//
// Corpo opcional (chamada manual):
//   { "cnpjs": ["33000167000101", ...] }  enriquece so esses, mesmo que ja
//                                          enriquecidos ou fora de 'novo'
//   { "limite": 20 }                       muda o teto de 60
//
// Especificacao: docs/radar/RADAR-FASE1.md (E3).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BRASILAPI_CNPJ = "https://brasilapi.com.br/api/cnpj/v1";
const LIMITE_PADRAO = 60;
const PAUSA_MS = 1200;
const TIMEOUT_MS = 10_000;
const ORCAMENTO_MS = 120_000;

interface Empresa {
  cnpj: string;
  status: string;
}

interface Socio {
  nome: string;
  qualificacao: string | null;
}

interface CadastroBrasilApi {
  razao_social?: string;
  nome_fantasia?: string;
  cnae_fiscal?: number | string;
  cnae_fiscal_descricao?: string;
  porte?: string;
  opcao_pelo_simples?: boolean | null;
  opcao_pelo_mei?: boolean | null;
  descricao_situacao_cadastral?: string;
  municipio?: string;
  email?: string | null;
  ddd_telefone_1?: string | null;
  qsa?: Array<{ nome_socio?: string; qualificacao_socio?: string }>;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** "2121660000" -> "(21) 2166-0000"; "11912345678" -> "(11) 91234-5678". */
function montarTelefone(ddd_telefone_1: unknown): string | null {
  const d = String(ddd_telefone_1 ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  const num = d.slice(2);
  const meio = num.length === 9 ? 5 : 4;
  return `(${ddd}) ${num.slice(0, meio)}-${num.slice(meio)}`;
}

function montarSocios(qsa: CadastroBrasilApi["qsa"]): Socio[] {
  if (!Array.isArray(qsa)) return [];
  return qsa
    .map((s) => ({ nome: texto(s?.nome_socio) ?? "", qualificacao: texto(s?.qualificacao_socio) }))
    .filter((s) => s.nome);
}

/** Motivo de exclusao pos-enriquecimento, na ordem da especificacao. */
function motivoExclusao(c: {
  optante_simples: boolean | null;
  optante_mei: boolean | null;
  cnae_principal: string | null;
  situacao_cadastral: string | null;
}): string | null {
  if (c.optante_simples === true || c.optante_mei === true) return "simples_nacional";
  const cnae = (c.cnae_principal ?? "").replace(/\D/g, "").padStart(7, "0");
  if (cnae.startsWith("64") || cnae.startsWith("65")) return "financeiro";
  if ((c.situacao_cadastral ?? "").trim().toUpperCase() !== "ATIVA") return "cadastro_inativo";
  return null;
}

async function consultarBrasilApi(cnpj: string): Promise<{ status: number; dados: CadastroBrasilApi | null; erro?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BRASILAPI_CNPJ}/${cnpj}`, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json", "User-Agent": "feg-hub-radar/1.0" },
    });
    if (!r.ok) return { status: r.status, dados: null };
    return { status: r.status, dados: await r.json() as CadastroBrasilApi };
  } catch (e) {
    const erro = e instanceof Error && e.name === "AbortError" ? "timeout" : `rede: ${String(e).slice(0, 120)}`;
    return { status: 0, dados: null, erro };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

  let corpo: { cnpjs?: unknown; limite?: unknown } = {};
  try {
    if (req.method === "POST") corpo = await req.json();
  } catch { /* corpo vazio: execucao normal */ }

  const cnpjsPedidos = Array.isArray(corpo.cnpjs)
    ? corpo.cnpjs.map((c) => String(c).replace(/\D/g, "")).filter((c) => c.length === 14)
    : null;
  const limite = Number.isInteger(corpo.limite) && (corpo.limite as number) > 0
    ? Math.min(corpo.limite as number, 500)
    : LIMITE_PADRAO;

  // Selecao
  let consulta = supabase.from("radar_empresas").select("cnpj, status");
  consulta = cnpjsPedidos
    ? consulta.in("cnpj", cnpjsPedidos)
    : consulta.is("enriquecido_em", null).eq("status", "novo");
  const { data: empresas, error: selErr } = await consulta
    .order("score", { ascending: false })
    .order("valor_total", { ascending: false })
    .limit(limite);

  if (selErr) {
    console.error("selecao:", selErr.message);
    return Response.json({ ok: false, erro: selErr.message }, { status: 500 });
  }

  const resumo = {
    selecionadas: (empresas ?? []).length,
    processadas: 0,
    enriquecidas: 0,
    mantidas_novo: 0,
    excluidas: { simples_nacional: 0, financeiro: 0, cadastro_inativo: 0, cnpj_nao_encontrado: 0 },
    parou_em: null as string | null,
    erros_gravacao: 0,
    segundos: 0,
  };

  for (const emp of (empresas ?? []) as Empresa[]) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      resumo.parou_em = "orcamento_de_tempo";
      break;
    }
    if (resumo.processadas > 0) await dormir(PAUSA_MS);
    resumo.processadas++;

    const r = await consultarBrasilApi(emp.cnpj);

    // 429 / 5xx / rede: registra e encerra. Nao marca enriquecido_em.
    if (r.status === 429 || r.status >= 500 || r.status === 0) {
      const codigo = r.status === 0 ? (r.erro ?? "rede") : `http_${r.status}`;
      const { error } = await supabase.from("radar_empresas")
        .update({ enriquecimento_erro: codigo, atualizado_em: new Date().toISOString() })
        .eq("cnpj", emp.cnpj);
      if (error) { console.error("gravar erro:", emp.cnpj, error.message); resumo.erros_gravacao++; }
      resumo.parou_em = `${codigo} em ${emp.cnpj}`;
      console.warn(`parando: ${codigo} em ${emp.cnpj}`);
      break;
    }

    // 404 (ou outro 4xx): CNPJ nao existe na base da Receita.
    if (!r.dados) {
      const { error } = await supabase.from("radar_empresas")
        .update({
          enriquecimento_erro: "nao_encontrado",
          enriquecido_em: new Date().toISOString(),
          status: "excluido",
          motivo_exclusao: "cnpj_nao_encontrado",
          atualizado_em: new Date().toISOString(),
        })
        .eq("cnpj", emp.cnpj);
      if (error) { console.error("gravar 404:", emp.cnpj, error.message); resumo.erros_gravacao++; continue; }
      await supabase.rpc("radar_atualizar_score", { p_cnpj: emp.cnpj });
      resumo.excluidas.cnpj_nao_encontrado++;
      continue;
    }

    const d = r.dados;
    const cadastro = {
      razao_social: texto(d.razao_social),
      nome_fantasia: texto(d.nome_fantasia),
      cnae_principal: texto(d.cnae_fiscal),
      cnae_descricao: texto(d.cnae_fiscal_descricao),
      porte: texto(d.porte),
      optante_simples: typeof d.opcao_pelo_simples === "boolean" ? d.opcao_pelo_simples : null,
      optante_mei: typeof d.opcao_pelo_mei === "boolean" ? d.opcao_pelo_mei : null,
      situacao_cadastral: texto(d.descricao_situacao_cadastral),
      municipio: texto(d.municipio),
      email: texto(d.email)?.toLowerCase() ?? null,
      telefone: montarTelefone(d.ddd_telefone_1),
      socios: montarSocios(d.qsa),
      enriquecido_em: new Date().toISOString(),
      enriquecimento_erro: null as string | null,
      atualizado_em: new Date().toISOString(),
    };

    // Exclusoes pos-enriquecimento. Quem ja saiu de 'novo' pela mao de alguem
    // (enviado ao Kanban, descartado) nao e mexido; so recebe o cadastro.
    const motivo = motivoExclusao(cadastro);
    const mudaStatus = motivo && emp.status === "novo";
    const { error } = await supabase.from("radar_empresas")
      .update(mudaStatus ? { ...cadastro, status: "excluido", motivo_exclusao: motivo } : cadastro)
      .eq("cnpj", emp.cnpj);
    if (error) { console.error("gravar cadastro:", emp.cnpj, error.message); resumo.erros_gravacao++; continue; }

    const { error: scoreErr } = await supabase.rpc("radar_atualizar_score", { p_cnpj: emp.cnpj });
    if (scoreErr) { console.error("score:", emp.cnpj, scoreErr.message); resumo.erros_gravacao++; }

    resumo.enriquecidas++;
    if (mudaStatus) resumo.excluidas[motivo as keyof typeof resumo.excluidas]++;
    else resumo.mantidas_novo++;
  }

  resumo.segundos = Math.round((Date.now() - inicio) / 1000);
  console.log("radar-enrich-cnpj:", JSON.stringify(resumo));
  return Response.json({ ok: true, ...resumo });
});
