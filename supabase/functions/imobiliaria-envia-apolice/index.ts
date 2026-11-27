import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { bccResidencial } from '../_shared/copiasResidencial.ts';

/**
 * Manda a apólice emitida para a imobiliária, com o arquivo em anexo.
 *
 * Aceita dois tipos no corpo da chamada:
 *   'residencial' (padrão) lê apolice_residencial_url
 *   'garantia'             lê apolice_garantia_url
 *
 * O padrão é residencial de propósito: quem já chamava esta função sem informar
 * o tipo continua funcionando igual.
 *
 * Envio único (migração 146): cada cobertura guarda a hora em que o e-mail
 * saiu. Com a hora preenchida a função NÃO envia de novo, a menos que receba
 * `reenviar: true`, que a tela só manda depois de o corretor confirmar. Antes
 * disso, anexar a apólice no Repasse e depois no Registro de Vendas mandava o
 * mesmo e-mail duas vezes para a imobiliária.
 *
 * `previa: true` não envia nada: devolve destinatários, anexos e dados, para a
 * tela mostrar o que vai sair antes de o corretor confirmar.
 */

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const fmtData = (d: string) => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return dd ? `${dd}/${m}/${y}` : d; };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Extensão do arquivo guardado. O nome do anexo era sempre .pdf, e desde que o
 * hub passou a aceitar Word isso geraria um anexo que não abre.
 */
function extensaoDe(url: string): string {
  const ext = url.split('?')[0].split('.').pop() || '';
  return /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : 'pdf';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id, tipo, previa, reenviar } = await req.json();
    if (!client_id) throw new Error('client_id obrigatório');
    const ehGarantia = tipo === 'garantia';
    const produto = ehGarantia ? 'Garantia Locatícia' : 'Seguro Residencial';
    const colEnviada = ehGarantia ? 'apolice_garantia_enviada_em' : 'apolice_residencial_enviada_em';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: c } = await supabase
      .from('imobiliaria_clientes')
      .select('*, partners!inner(name, email, email_2)')
      .eq('id', client_id)
      .single();

    if (!c) throw new Error('Cliente não encontrado');
    const partner = (c as any).partners;
    if (!partner?.email) throw new Error('Parceiro sem email cadastrado');
    const arquivoUrl = ehGarantia ? c.apolice_garantia_url : c.apolice_residencial_url;
    if (!arquivoUrl) throw new Error('Apólice não encontrada');

    const nomeArq = (c.inquilino_nome || '').replace(/\s/g, '_');
    const to = [partner.email];
    if (partner.email_2) to.push(partner.email_2);
    const enviadoEm: string | null = (c as any)[colEnviada] || null;

    // Documentos extras da garantia, na ordem em que vão anexados.
    const extras: { url: string; filename: string; rotulo: string }[] = [];
    if (ehGarantia && c.contrato_fianca_url) extras.push({
      url: c.contrato_fianca_url,
      filename: `Contrato_Fianca_${nomeArq}.${extensaoDe(c.contrato_fianca_url)}`,
      rotulo: 'Contrato de fiança',
    });
    if (ehGarantia && c.termo_clausula_url) extras.push({
      url: c.termo_clausula_url,
      filename: `Termo_Clausula_${nomeArq}.${extensaoDe(c.termo_clausula_url)}`,
      rotulo: 'Termo da cláusula',
    });

    if (previa) {
      return new Response(JSON.stringify({
        previa: true,
        para: to,
        imobiliaria: partner.name,
        anexos: [ehGarantia ? 'Apólice da garantia' : 'Apólice do residencial', ...extras.map(e => e.rotulo)],
        ja_enviado_em: enviadoEm,
        dados: {
          inquilino: c.inquilino_nome || null,
          numero_apolice: c.numero_apolice || null,
          seguradora: c.seguradora && c.seguradora !== 'Importado' ? c.seguradora : null,
          vigencia: `${fmtData(c.data_inicio)} a ${fmtData(c.vigencia_fim)}`,
        },
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Já saiu e ninguém confirmou o reenvio: não manda de novo.
    if (enviadoEm && !reenviar) {
      return new Response(JSON.stringify({ success: false, ja_enviado: true, enviado_em: enviadoEm }),
        { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Reserva o envio antes de mandar: duas chamadas quase juntas (duas telas
    // abertas, clique duplo) disputam esta linha e só uma segue. Se a coluna
    // ainda não existir (migração 146 pendente), segue sem a trava.
    const agora = new Date().toISOString();
    let reservou = false;
    if (!enviadoEm) {
      const { data: reserva, error: reservaErr } = await supabase
        .from('imobiliaria_clientes')
        .update({ [colEnviada]: agora })
        .eq('id', client_id)
        .is(colEnviada, null)
        .select('id');
      if (reservaErr) {
        console.error('[imobiliaria-envia-apolice] Sem trava de envio único:', reservaErr.message);
      } else if (!reserva?.length) {
        return new Response(JSON.stringify({ success: false, ja_enviado: true, enviado_em: agora }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      } else {
        reservou = true;
      }
    }
    // Se o envio falhar depois da reserva, a hora volta a ficar vazia.
    const desfazerReserva = async () => {
      if (reservou) await supabase.from('imobiliaria_clientes').update({ [colEnviada]: null }).eq('id', client_id);
    };

    let qtdAnexos = 0;
    try {
    // Baixa o arquivo em chunks
    const pdfRes = await fetch(arquivoUrl);
    if (!pdfRes.ok) throw new Error('Não foi possível baixar a apólice');
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    const pdfB64 = toBase64(pdfBytes);

    const anexos: { filename: string; content: string }[] = [{
      filename: `${ehGarantia ? 'Apolice_Garantia' : 'Apolice'}_${nomeArq}_${c.numero_apolice||'residencial'}.${extensaoDe(arquivoUrl)}`,
      content: pdfB64,
    }];

    // O contrato de fiança e o termo com a cláusula vão junto da apólice da
    // garantia: o termo é o que a imobiliária precisa incluir no contrato de
    // locação, e mandar em e-mail separado só faria ela procurar. Se um deles
    // sumir do storage, o aviso da apólice ainda sai.
    const extrasAnexados: string[] = [];
    for (const extra of extras) {
      try {
        const r = await fetch(extra.url);
        if (r.ok) {
          anexos.push({ filename: extra.filename, content: toBase64(new Uint8Array(await r.arrayBuffer())) });
          extrasAnexados.push(extra.rotulo);
        }
      } catch (err) {
        console.error(`[imobiliaria-envia-apolice] Falha ao baixar ${extra.rotulo}:`, err);
      }
    }
    const temTermo = extrasAnexados.includes('Termo da cláusula');
    const temContrato = extrasAnexados.includes('Contrato de fiança');

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;text-align:center;">
          <img src="https://hub.fegsegurogarantia.com/marca/fg-logo-horizontal-bege.png" width="150" height="49" alt="F&amp;G Seguro Garantia" style="display:block;border:0;margin:0 auto 12px;" />
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">📤 Apólice Emitida</h1>
          <p style="color:rgba(255,255,255,.5);font-size:12px;margin:5px 0 0;">${produto}</p>
        </div>
        <div style="padding:28px 32px;background:#fff;">
          <p style="color:#1B263B;font-size:15px;margin:0 0 16px;">Prezados <strong>${partner.name}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">A apólice do inquílino abaixo foi emitida com sucesso. Segue o documento em anexo.</p>
          ${temTermo ? `<p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">Vai junto o <strong>termo com a cláusula do seguro</strong>, que precisa ser incluída no contrato de locação.</p>` : ''}
          ${temContrato ? `<p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">Segue também o <strong>contrato de fiança</strong> com as condições gerais da garantia.</p>` : ''}
          <div style="background:#f8f5f0;border:2px solid #C69C6D;border-radius:14px;padding:20px;margin:0 0 20px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Dados da Apólice</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">👤 <strong>Inquílino:</strong> ${c.inquilino_nome || '—'}</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">🛡️ <strong>Cobertura:</strong> ${produto}</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">📝 <strong>Nº Apólice:</strong> ${c.numero_apolice || '—'}</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">🏢 <strong>Seguradora:</strong> ${c.seguradora && c.seguradora !== 'Importado' ? c.seguradora : '—'}</p>
            <p style="margin:0;font-size:14px;color:#1B263B;">📅 <strong>Vigência:</strong> ${fmtData(c.data_inicio)} a ${fmtData(c.vigencia_fim)}</p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:18px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to, bcc: await bccResidencial(BCC),
        subject: `📤 Apólice emitida (${produto}): ${c.inquilino_nome} - ${partner.name}`,
        html,
        attachments: anexos,
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    qtdAnexos = anexos.length;
    } catch (envioErr) {
      await desfazerReserva();
      throw envioErr;
    }

    // Registra a hora do envio e, com a apólice na mão da imobiliária, a
    // cobertura passa a constar como emitida. Falha aqui não desfaz o e-mail.
    const { error: marcaErr } = await supabase.from('imobiliaria_clientes')
      .update({ [colEnviada]: agora, [ehGarantia ? 'status_garantia' : 'status_residencial']: 'emitido' })
      .eq('id', client_id);
    if (marcaErr) {
      console.error('[imobiliaria-envia-apolice] E-mail saiu, mas não registrei o envio:', marcaErr.message);
      await supabase.from('imobiliaria_clientes')
        .update({ [ehGarantia ? 'status_garantia' : 'status_residencial']: 'emitido' }).eq('id', client_id);
    }

    return new Response(JSON.stringify({ success: true, enviado_em: agora, enviado_para: to, anexos: qtdAnexos }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
