// lead-cotacao
// Recebe o lead dos formularios publicos e grava no Kanban (tabela prospects),
// depois envia o e-mail via Resend.
//
// Origens atendidas:
//   1. formulario de cotacao (cotacao.fegsegurogarantia.com, link da bio)
//   2. landing pages de campanha do site (/lp/licitante/, /lp/execucao/),
//      identificadas pelo campo `lp`. Campos extras sao opcionais.
//
// Secrets em Edge Functions > Secrets:
//   RESEND_API_KEY  chave do Resend (a mesma dos lembretes do HUB)
//   LEAD_EMAIL_TO   e-mail que recebe os leads (um so, texto simples)
//   LEAD_EMAIL_FROM opcional. Remetente. Precisa ser de dominio verificado
//                   no Resend. Padrao: cotacao@fegsegurogarantia.com.br

import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGENS_PERMITIDAS = [
  "https://cotacao.fegsegurogarantia.com",
  "https://fegsegurogarantia.com.br",
  "https://www.fegsegurogarantia.com.br",
];

// landing pages de campanha conhecidas
const LPS: Record<string, { tipo: string; rotulo: string }> = {
  licitante: { tipo: "Licitante (garantia de proposta)", rotulo: "LP Licitante" },
  execucao: { tipo: "Execucao de contrato", rotulo: "LP Execucao" },
};

function cabecalhos(origem: string | null) {
  return {
    "Access-Control-Allow-Origin": ORIGENS_PERMITIDAS.includes(origem ?? "")
      ? origem!
      : ORIGENS_PERMITIDAS[0],
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

const escapar = (v: unknown) =>
  String(v ?? "").replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!),
  );

// limita tamanho de texto livre vindo do formulario
const txt = (v: unknown, max = 200) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

// "R$ 1.234.567,89" -> 1234567.89
const reais = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/[^\d,]/g, "").replace(",", ".");
  const n = Number(s);
  return s && Number.isFinite(n) && n > 0 ? n : null;
};

// "2026-10-15" -> "15/10/2026"
const dataBR = (v: unknown) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(v, 20);
};

Deno.serve(async (req) => {
  const cors = cabecalhos(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erro: "metodo nao permitido" }), {
      status: 405,
      headers: cors,
    });
  }

  try {
    const d = await req.json();

    // honeypot anti robo: campo invisivel na LP. Se vier preenchido,
    // responde ok e descarta.
    if (txt(d.website)) {
      console.log("honeypot: descartado");
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    const digitos = String(d.fone ?? "").replace(/\D/g, "");
    if (
      !d.nome ||
      digitos.length < 10 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.mail ?? "")
    ) {
      return new Response(JSON.stringify({ erro: "dados incompletos" }), {
        status: 400,
        headers: cors,
      });
    }

    const lp = LPS[String(d.lp ?? "")] ?? null;
    const tipo = lp ? lp.tipo : d.tipo;

    // rastreio da campanha (so LPs)
    const utm = {
      utm_source: txt(d.utm_source, 80),
      utm_medium: txt(d.utm_medium, 80),
      utm_campaign: txt(d.utm_campaign, 120),
      utm_term: txt(d.utm_term, 120),
      gclid: txt(d.gclid, 200),
    };
    const veioDeAnuncio = !!(utm.gclid || utm.utm_source);

    // campos especificos das LPs
    const extrasLP: [string, unknown][] = lp
      ? (d.lp === "licitante"
        ? [
          ["Edital / pregao", txt(d.edital)],
          ["Data da sessao", dataBR(d.sessao)],
          ["Valor estimado da licitacao", txt(d.valor, 40)],
        ]
        : [
          ["Valor do contrato", txt(d.valor, 40)],
          ["Percentual exigido", txt(d.percent, 20)],
          ["Prazo para entregar a garantia", dataBR(d.prazo)],
        ])
      : [];

    const linhasRastreio: [string, unknown][] = lp
      ? [
        ["Pagina", lp.rotulo],
        ["utm_source", utm.utm_source],
        ["utm_medium", utm.utm_medium],
        ["utm_campaign", utm.utm_campaign],
        ["Palavra-chave (utm_term)", utm.utm_term],
        ["gclid", utm.gclid ? "sim" : null],
      ]
      : [];

    const resumo = lp
      ? [
        `Modalidade: ${tipo}`,
        ...extrasLP.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
        `Origem: ${lp.rotulo}${veioDeAnuncio ? " (anuncio)" : ""}`,
        ...(utm.utm_campaign ? [`Campanha: ${utm.utm_campaign}`] : []),
        ...(utm.utm_term ? [`Palavra-chave: ${utm.utm_term}`] : []),
        ...(utm.gclid ? [`gclid: ${utm.gclid}`] : []),
      ].join("\n")
      : `Modalidade: ${d.tipo ?? "-"}\n` +
        `Faixa de valor: ${d.valor ?? "-"}\n` +
        `Prazo informado: ${d.prazo ?? "-"}`;

    const origemTexto = lp
      ? `${lp.rotulo}${veioDeAnuncio ? " (anuncio)" : ""}`
      : d.origem === "instagram"
      ? "Formulario site (Instagram)"
      : "Formulario site";

    // 1. entra no Kanban (coluna Novos Leads). Nao bloqueia o e-mail se falhar.
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { error } = await sb.from("prospects").insert({
        name: d.nome,
        company: d.empresa || null,
        cnpj: d.cnpj || null,
        email: d.mail,
        phonenumber: d.fone,
        description: resumo,
        source: origemTexto,
        product_type: "Seguro Garantia",
        status: "Novos Leads",
        status_entered_at: new Date().toISOString(),
        tags: lp
          ? ["formulario", "inbound", "lp", `lp-${d.lp}`, ...(veioDeAnuncio ? ["anuncio"] : [])]
          : ["formulario", "inbound"],
        ...(lp && d.lp === "licitante" ? { numero_licitacao: txt(d.edital) } : {}),
        ...(lp && d.lp === "execucao" ? { valor_contrato: reais(d.valor) } : {}),
      });
      if (error) console.error("kanban:", JSON.stringify(error));
      else console.log("kanban: lead gravado");
    } catch (e) {
      console.error("kanban (excecao):", e);
    }

    // 2. e-mail
    const linhas: [string, unknown][] = lp
      ? [
        ["Tipo de garantia", tipo],
        ...extrasLP,
        ["CNPJ", d.cnpj],
        ["Empresa", d.empresa || "nao identificada"],
        ["Nome do contato", d.nome],
        ["WhatsApp", d.fone],
        ["E-mail", d.mail],
        ...linhasRastreio,
      ]
      : [
        ["Tipo de garantia", d.tipo],
        ["Valor da garantia", d.valor],
        ["Prazo necessario", d.prazo],
        ["CNPJ", d.cnpj],
        ["Empresa", d.empresa || "nao identificada"],
        ["Nome do contato", d.nome],
        ["WhatsApp", d.fone],
        ["E-mail", d.mail],
        ["Origem", d.origem || "site"],
      ];

    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;color:#1c3a5e;max-width:560px">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#e8572a;margin:0 0 6px">Novo lead${lp ? " · " + escapar(lp.rotulo) : ""}</p>
        <h2 style="font-size:19px;margin:0 0 18px">${escapar(d.empresa || d.cnpj)}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${
      linhas.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) =>
        `<tr><td style="padding:8px 0;border-top:1px solid #e6e6e6;color:#6b7c8f">${k}</td>` +
        `<td style="padding:8px 0;border-top:1px solid #e6e6e6;text-align:right;font-weight:500">${escapar(v)}</td></tr>`
      ).join("")
    }
        </table>
        <p style="margin:22px 0 0">
          <a href="https://wa.me/55${digitos}" style="background:#e8572a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:3px;display:inline-block;font-size:14px">
            Chamar ${escapar(d.nome)} no WhatsApp
          </a>
        </p>
        <p style="font-size:12px;color:#8a97a5;margin-top:20px">O lead ja entrou na coluna Novos Leads do HUB.</p>
      </div>`;

    const destino = (Deno.env.get("LEAD_EMAIL_TO") ?? "").trim();
    if (!destino) {
      console.error("LEAD_EMAIL_TO nao configurado");
      return new Response(JSON.stringify({ erro: "destino ausente" }), {
        status: 500,
        headers: cors,
      });
    }

    // dominio verificado no Resend e o .com.br
    const remetente = (Deno.env.get("LEAD_EMAIL_FROM") ?? "").trim() ||
      "Formulario F&G <cotacao@fegsegurogarantia.com.br>";

    const assunto = lp
      ? `${lp.rotulo}${veioDeAnuncio ? " (anuncio)" : ""}: ${d.empresa || d.cnpj} | ${d.nome}`
      : `Cotacao: ${d.tipo} | ${d.empresa || d.cnpj} | ${d.prazo}`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: remetente,
        to: destino,
        reply_to: d.mail,
        subject: assunto,
        html,
      }),
    });

    if (!r.ok) {
      console.error("resend:", await r.text());
      return new Response(JSON.stringify({ erro: "falha no envio" }), {
        status: 502,
        headers: cors,
      });
    }

    console.log("resend: e-mail enviado para", destino);
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ erro: "erro interno" }), {
      status: 500,
      headers: cors,
    });
  }
});
