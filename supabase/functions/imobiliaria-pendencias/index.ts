// Digest de pendencias do portal da imobiliaria.
//
// Por que existe: o portal mostra quatro paineis que dependem de uma acao da
// imobiliaria (mandar documento da garantia, dizer se renova, recontratar quem
// ficou sem cobertura, responder recado). Nenhum deles avisava ninguem. So o
// repasse tinha disparo automatico, e o pedido de documento so saia quando o
// Fabio clicava no botao do card. Na pratica a imobiliaria so age quando chega
// e-mail, entao as pendencias ficavam paradas.
//
// Um e-mail por parceiro, com os quatro blocos juntos, e so quando ha algo.
// Segunda e quinta de manha, pelo cron `imobiliaria-pendencias-semanal`.
//
// Parametros do POST (todos opcionais):
//   { dry_run: true }      monta tudo e devolve o resumo sem enviar nada
//   { partner_id: <id> }   restringe a um parceiro, para teste
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';
const PORTAL = 'https://hub.fegsegurogarantia.com/imobiliaria.html';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Os mesmos valores que o portal trata como fora do ar. Cadastro encerrado nao
// gera pendencia: cobrar documento de contrato que acabou seria ruido.
const ENCERRADOS = ['cancelado', 'saiu_imovel', 'desistiu', 'reprovado'];

const DOCS_DEF = [
  { key: 'doc_contrato_url',       label: 'Contrato do aluguel' },
  { key: 'doc_termo_vistoria_url', label: 'Termo de vistoria' },
  { key: 'doc_fotos_vistoria_url', label: 'Fotos da vistoria' },
];

const temGarantiaLocaticia = (c: any) => c?.tipo_seguro === 'residencial_garantia' || c?.tipo_seguro === 'garantia';

// Mesma regra do portal: quem disse que renova ja resolveu; quem disse que nao
// renova so resolve de fato quando o distrato chega, se houver garantia.
const renovacaoResolvida = (c: any) => {
  if (c.renovacao_confirmacao === 'vai_renovar') return true;
  if (c.renovacao_confirmacao === 'nao_vai_renovar') {
    return !temGarantiaLocaticia(c) || Boolean(c.distrato_url);
  }
  return false;
};

const fmtData = (iso: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : 'sem data');
const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]!));

/** Hoje em Sao Paulo, como YYYY-MM-DD, para nao errar o dia perto da meia-noite. */
const hojeBRT = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const somenteParceiro = body?.partner_id ?? null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const hoje = hojeBRT();
    const [ano, mes, dia] = hoje.split('-').map(Number);
    const limiteRenovacao = new Date(Date.UTC(ano, mes - 1, dia + 30)).toISOString().slice(0, 10);

    let q = supabase
      .from('imobiliaria_clientes')
      .select('*, partners!inner(id, name, email, email_2)');
    if (somenteParceiro) q = q.eq('partner_id', somenteParceiro);
    const { data: clientes, error } = await q;
    if (error) throw new Error(error.message);

    // Agrupa por parceiro antes de avaliar: o bloco "sem cobertura" precisa
    // olhar a carteira inteira daquela imobiliaria para saber se o inquilino
    // ja tem outra solicitacao aberta.
    const porParceiro = new Map<number, { nome: string; email: string; email2?: string; clientes: any[] }>();
    for (const c of clientes || []) {
      const p = (c as any).partners;
      if (!p?.id) continue;
      if (!porParceiro.has(p.id)) porParceiro.set(p.id, { nome: p.name, email: p.email, email2: p.email_2, clientes: [] });
      porParceiro.get(p.id)!.clientes.push(c);
    }

    const resultados: any[] = [];

    for (const [partnerId, p] of porParceiro) {
      const vivos = p.clientes.filter((c: any) => !ENCERRADOS.includes(c.status_apolice));

      // 1. Documentos da garantia locaticia que ainda nao subiram.
      const docs = vivos
        .filter((c: any) => temGarantiaLocaticia(c) && ['aprovado', 'emitido'].includes(c.status_garantia))
        .map((c: any) => ({ nome: c.inquilino_nome, faltando: DOCS_DEF.filter(d => !c[d.key]).map(d => d.label) }))
        .filter((x) => x.faltando.length > 0);

      // 2. Apolice vencendo em ate 30 dias sem resposta sobre renovacao.
      const renovacoes = vivos
        .filter((c: any) => c.vigencia_fim && String(c.vigencia_fim).slice(0, 10) <= limiteRenovacao && !renovacaoResolvida(c))
        .sort((a: any, b: any) => String(a.vigencia_fim).localeCompare(String(b.vigencia_fim)))
        .map((c: any) => ({
          nome: c.inquilino_nome,
          vigencia_fim: c.vigencia_fim,
          vencida: String(c.vigencia_fim).slice(0, 10) < hoje,
        }));

      // 3. Cancelados sem nenhuma solicitacao nova aberta: imovel desprotegido.
      //    Mesma regra do painel vermelho do portal, com deduplicacao por nome
      //    para quem tem cadastro antigo importado alem do atual.
      const nomesComSolicitacaoAtiva = new Set(
        p.clientes
          .filter((c: any) => c.status_apolice !== 'cancelado' || ['solicitado', 'atendimento_iniciado'].includes(c.kanban_status))
          .map((c: any) => String(c.inquilino_nome || '').toUpperCase().trim()),
      );
      const semCoberturaPorNome = new Map<string, any>();
      for (const c of p.clientes) {
        const nome = String(c.inquilino_nome || '').toUpperCase().trim();
        if (c.status_apolice !== 'cancelado' || nomesComSolicitacaoAtiva.has(nome)) continue;
        const anterior = semCoberturaPorNome.get(nome);
        if (!anterior || String(c.data_inicio || '') > String(anterior.data_inicio || '')) semCoberturaPorNome.set(nome, c);
      }
      const semCobertura = [...semCoberturaPorNome.values()]
        .map((c: any) => ({ nome: c.inquilino_nome, apolice: c.numero_apolice || null }));

      // 4. Recado da corretora marcado como "precisa de retorno".
      const recados = vivos
        .filter((c: any) => c.recado_precisa_retorno && String(c.observacao_imobiliaria || '').trim())
        .map((c: any) => ({ nome: c.inquilino_nome, texto: String(c.observacao_imobiliaria).trim(), quando: c.recado_enviado_em }));

      const total = docs.length + renovacoes.length + semCobertura.length + recados.length;
      const resumo = { partner_id: partnerId, parceiro: p.nome, total, docs, renovacoes, sem_cobertura: semCobertura, recados };

      if (total === 0) { resultados.push({ ...resumo, enviado: false, motivo: 'sem pendencias' }); continue; }
      if (!p.email) { resultados.push({ ...resumo, enviado: false, motivo: 'parceiro sem e-mail cadastrado' }); continue; }
      if (dryRun) { resultados.push({ ...resumo, enviado: false, motivo: 'dry_run' }); continue; }

      const bloco = (titulo: string, cor: string, itens: string[]) => itens.length === 0 ? '' : `
        <div style="margin:0 0 18px;border:1px solid #e8e4dc;border-radius:12px;overflow:hidden;">
          <div style="background:${cor}12;border-left:4px solid ${cor};padding:10px 16px;">
            <span style="font-size:13px;font-weight:900;color:${cor};">${esc(titulo)} (${itens.length})</span>
          </div>
          <div style="padding:6px 16px 12px;background:#fff;">
            ${itens.map(i => `<p style="margin:8px 0 0;font-size:13px;color:#334155;line-height:1.5;">${i}</p>`).join('')}
          </div>
        </div>`;

      const html = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
          <div style="background:#1B263B;padding:24px 32px;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
              <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
            </table>
            <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">O que precisa da sua ação</h1>
            <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;">${total} item${total > 1 ? 'ns' : ''} aguardando a ${esc(p.nome)} em ${fmtData(hoje)}</p>
          </div>
          <div style="padding:24px 32px;background:#fff;">
            <p style="color:#1B263B;font-size:14px;margin:0 0 6px;">Prezados <strong>${esc(p.nome)}</strong>,</p>
            <p style="color:#475569;font-size:13px;margin:0 0 20px;line-height:1.6;">
              Estes pontos estão parados do lado de vocês no portal. Resolver cada um leva poucos minutos e evita imóvel sem cobertura na hora de um sinistro.
            </p>
            ${bloco('Documentos da garantia locatícia', '#C69C6D', docs.map(d =>
              `<strong>${esc(d.nome)}</strong>: falta ${d.faltando.map(esc).join(', ')}.`))}
            ${bloco('Renovação sem resposta', '#d97706', renovacoes.map(r =>
              `<strong>${esc(r.nome)}</strong>: ${r.vencida ? 'apólice venceu em' : 'vence em'} ${fmtData(r.vigencia_fim)}. Confirme no portal se vai renovar.`))}
            ${bloco('Inquilino sem cobertura ativa', '#dc2626', semCobertura.map(s =>
              `<strong>${esc(s.nome)}</strong>${s.apolice ? `, apólice ${esc(s.apolice)}` : ''}: imóvel desprotegido. Peça uma nova cotação pelo portal.`))}
            ${bloco('Recado aguardando retorno', '#7c3aed', recados.map(r =>
              `<strong>${esc(r.nome)}</strong>: "${esc(r.texto)}"`))}
            <div style="margin-top:8px;padding:14px 18px;background:#fef9f0;border:1px solid #C69C6D40;border-radius:12px;">
              <p style="margin:0;font-size:12px;color:#78716c;line-height:1.6;">
                Tudo se resolve no portal:<br/>
                <a href="${PORTAL}" style="color:#C69C6D;font-weight:700;">hub.fegsegurogarantia.com/imobiliaria.html</a>
              </p>
            </div>
          </div>
          <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
            <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
          </div>
        </div>`;

      const to = [p.email];
      if (p.email2) to.push(p.email2);

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
          to, bcc: [BCC],
          subject: `${total} pendência${total > 1 ? 's' : ''} no portal F&G, ${p.nome}`,
          html,
        }),
      });
      const envioOk = res.ok;
      const erroEnvio = envioOk ? null : await res.text().catch(() => 'erro desconhecido');

      // Registro do que saiu. Serve de historico e e o que permite conferir
      // depois se a imobiliaria foi avisada antes de cobrar por telefone.
      await supabase.from('imobiliaria_pendencias_envios').insert({
        partner_id: partnerId,
        total,
        resumo,
        destinatarios: to,
        erro: erroEnvio,
      });

      resultados.push({ ...resumo, enviado: envioOk, erro: erroEnvio });
    }

    const enviados = resultados.filter(r => r.enviado).length;
    return new Response(JSON.stringify({ success: true, data: hoje, dry_run: dryRun, enviados, resultados }, null, 2), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
