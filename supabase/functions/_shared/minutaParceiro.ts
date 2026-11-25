// Validação da minuta com o parceiro do portal (tabela demanda_minutas,
// migração 146). Usado pelas duas pontas:
//   demanda-minuta   a F&G envia a minuta pelo HUB
//   parceiro-portal  o parceiro abre a minuta e responde no portal

export const BUCKET_MINUTAS = 'demanda-minutas';
export const PORTAL_URL = 'https://hub.fegsegurogarantia.com/parceiros-login.html';
export const HUB_URL = 'https://hub.fegsegurogarantia.com';
export const REMETENTE = 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>';

export type StatusMinuta = 'aguardando' | 'aprovada' | 'ajuste_solicitado' | 'substituida';

export interface RodadaMinuta {
  id: number;
  sale_id: number;
  partner_id: number;
  versao: number;
  arquivo_path: string;
  arquivo_nome: string;
  arquivo_tamanho: number | null;
  observacao_fg: string | null;
  enviada_por: string;
  enviada_em: string;
  status: StatusMinuta;
  resposta_parceiro: string | null;
  respondida_em: string | null;
}

/** O que o portal recebe de cada rodada: nada de caminho no bucket nem de quem enviou. */
export function rodadaParaPortal(r: RodadaMinuta) {
  return {
    id: r.id,
    versao: r.versao,
    status: r.status,
    arquivo_nome: r.arquivo_nome,
    observacao_fg: r.observacao_fg,
    enviada_em: r.enviada_em,
    resposta_parceiro: r.resposta_parceiro,
    respondida_em: r.respondida_em,
  };
}

export const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Data e hora de agora em Brasília, para o texto dos e-mails. */
export function agoraBrasiliaTexto(): string {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} às ${v('hour')}:${v('minute')}`;
}

export const linhaEmail = (rotulo: string, valor: string, destaque = false) => `
    <tr>
      <td style="padding:9px 0;font-size:12px;color:#94a3b8;width:150px;vertical-align:top;">${rotulo}</td>
      <td style="padding:9px 0;font-size:14px;color:#1B263B;${destaque ? 'font-weight:700;' : ''}">${valor}</td>
    </tr>`;

/** Moldura dos e-mails do portal do parceiro (a mesma do aviso de nova demanda). */
export function molduraEmail(p: { titulo: string; subtitulo: string; linhas: string; aviso: string; botao?: { texto: string; url: string } }): string {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
    <div style="background:#1B263B;padding:24px 32px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr></table>
      <h1 style="color:#fff;font-size:18px;font-weight:900;margin:0;">${esc(p.titulo)}</h1>
      <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">${esc(p.subtitulo)}</p>
    </div>
    <div style="padding:24px 32px;background:#fff;">
      <table style="width:100%;border-collapse:collapse;">${p.linhas}</table>
      <div style="margin-top:20px;padding:14px 18px;background:#fef9f0;border:1px solid #C69C6D40;border-radius:12px;">
        <p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">${p.aviso}</p>
        ${p.botao ? `<p style="margin:12px 0 0;"><a href="${esc(p.botao.url)}" style="display:inline-block;background:#1B263B;color:#fff;font-weight:700;font-size:13px;text-decoration:none;padding:10px 18px;border-radius:10px;">${esc(p.botao.texto)}</a></p>` : ''}
      </div>
    </div>
    <div style="background:#f8f5f0;padding:14px 32px;border-top:1px solid #e8e4dc;text-align:center;">
      <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal do Parceiro · F&amp;G Seguro Garantia</p>
    </div>
  </div>`;
}

/** Envia pelo Resend. Devolve true se o Resend aceitou; nunca lança. */
export async function enviarEmail(chave: string, corpo: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${chave}` },
      body: JSON.stringify({ from: REMETENTE, ...corpo }),
    });
    if (!r.ok) { console.error('[resend]', r.status, await r.text()); return false; }
    return true;
  } catch (e) {
    console.error('[resend]', String(e));
    return false;
  }
}
