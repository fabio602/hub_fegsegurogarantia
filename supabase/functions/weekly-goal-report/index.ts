// weekly-goal-report
//
// Relatório semanal da meta de comissão, por e-mail (Resend), toda sábado às
// 8h de Brasília via .github/workflows/weekly-goal-report.yml. Sábado, e não
// sexta à noite, para a venda lançada no fim da tarde de sexta entrar no
// número fechado.
//
// Referência: vendas com vendeu = 'Sim', pela `data` da venda. Meta e dias
// úteis base vêm de `metas_comissao`; destinatários de `hub_config`
// (chave relatorio_meta_destinatarios). As contas de dias úteis são as
// mesmas da tela "Meta de Comissão" (../_shared/diasUteis.ts).
//
// Corpo aceito (todos opcionais):
//   semana_inicio: 'YYYY-MM-DD'  segunda-feira da semana a relatar
//                                 (padrão: semana de ontem)
//   force: true                   reenvia mesmo que a semana já conste em
//                                 relatorio_meta_envios
//   teste: true, email: '...'     manda só para esse e-mail e não registra
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  hojeBrt, somarDias, inicioDaSemana, fimDaSemana, primeiroDiaDoMes, ultimoDiaDoMes,
  diasUteisDoMes, diasUteisEntre, diasUteisRestantesNoMes, formatarDataBr, nomeDoMes,
  valorBrl, formatarBrl,
} from '../_shared/diasUteis.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const DESTINATARIOS_PADRAO = ['fabio@fegsegurogarantia.com.br'];
const META_PADRAO = 20000;
const DIAS_BASE_PADRAO = 20;
/** Antes deste mês o formulário recalculava a comissão para 20% do prêmio. */
const MES_CONTAGEM_CORRETA = '2026-09-01';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Venda {
  id: number; data: string; nome: string | null; seguradora: string | null; tipo: string | null;
  premio: string | null; comissao: string | null; created_at: string | null; vendeu_at: string | null;
}

const soma = (v: Venda[]) => v.reduce((s, x) => s + valorBrl(x.comissao), 0);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const P = 'margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#1B263B;font-family:Arial,sans-serif;';
const ROTULO = 'font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#64748b;font-family:Arial,sans-serif;margin:0 0 4px 0;';
const VALOR = 'font-size:22px;font-weight:bold;color:#1B263B;font-family:Georgia,serif;margin:0;';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Faltam variáveis de ambiente (RESEND_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const hoje = hojeBrt();
    const semIni = typeof body.semana_inicio === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.semana_inicio)
      ? inicioDaSemana(body.semana_inicio)
      : inicioDaSemana(somarDias(hoje, -1));
    const semFim = fimDaSemana(semIni);
    const antIni = somarDias(semIni, -7);
    const antFim = somarDias(semIni, -1);
    // Mês de referência: o da sexta-feira da semana relatada.
    const sexta = somarDias(semIni, 4);
    const mesIni = primeiroDiaDoMes(sexta);
    const mesFim = ultimoDiaDoMes(sexta);
    // Corte do acumulado do mês: hoje, ou o fim da semana se for reenvio de semana antiga.
    const corteMes = hoje < semFim ? hoje : semFim;
    const teste = body.teste === true;

    // Envio já feito?
    if (!teste && body.force !== true) {
      const { data: ja } = await supabase.from('relatorio_meta_envios').select('semana_inicio').eq('semana_inicio', semIni).maybeSingle();
      if (ja) return json({ success: true, skipped: 'ja_enviado', semana_inicio: semIni });
    }

    // Dados
    const [{ data: vendasRaw, error: ev }, { data: metas }, { data: cfg }] = await Promise.all([
      supabase.from('sales').select('id, data, nome, seguradora, tipo, premio, comissao, created_at, vendeu_at')
        .eq('vendeu', 'Sim').gte('data', antIni < mesIni ? antIni : mesIni).lte('data', semFim > mesFim ? semFim : mesFim).order('data'),
      supabase.from('metas_comissao').select('mes, meta_mensal, dias_uteis_base').lte('mes', mesIni).order('mes', { ascending: false }).limit(1),
      supabase.from('hub_config').select('valor').eq('chave', 'relatorio_meta_destinatarios').maybeSingle(),
    ]);
    if (ev) throw ev;
    const vendas = (vendasRaw || []) as Venda[];
    const meta = metas?.[0] ? Number(metas[0].meta_mensal) : META_PADRAO;
    const diasBase = metas?.[0] ? Number(metas[0].dias_uteis_base) : DIAS_BASE_PADRAO;
    const metaDiaria = meta / Math.max(1, diasBase);
    const metaSemanal = metaDiaria * 5;

    const destinatarios: string[] = teste && typeof body.email === 'string'
      ? [body.email]
      : (Array.isArray(cfg?.valor) && cfg!.valor.length ? cfg!.valor as string[] : DESTINATARIOS_PADRAO);

    // Semana
    const daSemana = vendas.filter(v => v.data >= semIni && v.data <= semFim);
    const daAnterior = vendas.filter(v => v.data >= antIni && v.data <= antFim);
    const comSemana = soma(daSemana);
    const comAnterior = soma(daAnterior);
    const varSemana = comSemana - comAnterior;

    // Mês
    const doMes = vendas.filter(v => v.data >= mesIni && v.data <= corteMes);
    const comMes = soma(doMes);
    const faltaMes = Math.max(0, meta - comMes);
    const uteisMes = diasUteisDoMes(mesIni);
    const uteisPassados = diasUteisEntre(mesIni, corteMes);
    const uteisRestantes = diasUteisRestantesNoMes(corteMes);
    const esperado = metaDiaria * uteisPassados;
    const projecao = uteisPassados > 0 ? (comMes / uteisPassados) * uteisMes : 0;

    // Conversão: vendas novas cadastradas na semana e vendas que estavam em
    // andamento e fecharam na semana (vendeu_at gravado por trigger desde 03/09/2026).
    const iniTs = `${semIni}T00:00:00-03:00`;
    const fimTs = `${somarDias(semFim, 1)}T00:00:00-03:00`;
    const [{ count: novas }, { data: fechadas }] = await Promise.all([
      supabase.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', iniTs).lt('created_at', fimTs),
      supabase.from('sales').select('id, created_at, vendeu_at').eq('vendeu', 'Sim').gte('vendeu_at', iniTs).lt('vendeu_at', fimTs),
    ]);
    const convertidas = (fechadas || []).filter(f => f.created_at && f.vendeu_at && String(f.created_at).slice(0, 10) < String(f.vendeu_at).slice(0, 10)).length;
    const { count: temVendeuAt } = await supabase.from('sales').select('id', { count: 'exact', head: true }).not('vendeu_at', 'is', null);

    // HTML
    const corSemana = comSemana >= metaSemanal ? '#059669' : '#b45309';
    const corRitmo = comMes >= esperado ? '#059669' : '#b45309';
    const linhas = daSemana.length
      ? daSemana.map(v => `<tr>
          <td style="padding:8px 6px;border-bottom:1px solid #EFE7DB;font-size:12px;color:#64748b;white-space:nowrap;">${formatarDataBr(v.data)}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #EFE7DB;font-size:12px;color:#1B263B;font-weight:bold;">${esc(v.nome || '-')}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #EFE7DB;font-size:12px;color:#334155;">${esc(v.seguradora || '-')}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #EFE7DB;font-size:12px;color:#334155;">${esc(v.tipo || '-')}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #EFE7DB;font-size:12px;color:#334155;text-align:right;white-space:nowrap;">${esc(v.premio || '-')}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #EFE7DB;font-size:12px;color:#8B6C3E;font-weight:bold;text-align:right;white-space:nowrap;">${esc(v.comissao || '-')}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" style="padding:14px 6px;font-size:13px;color:#64748b;text-align:center;">Nenhuma venda com "Vendeu = Sim" nesta semana.</td></tr>`;

    const bloco = (rotulo: string, valor: string, cor = '#1B263B', sub = '') =>
      `<td width="50%" style="padding:14px 16px;border:1px solid #EFE7DB;border-radius:8px;vertical-align:top;">
        <p style="${ROTULO}">${rotulo}</p><p style="${VALOR}color:${cor};">${valor}</p>${sub ? `<p style="margin:4px 0 0 0;font-size:12px;color:#64748b;font-family:Arial,sans-serif;">${sub}</p>` : ''}
      </td>`;

    const notaHistorico = antIni < MES_CONTAGEM_CORRETA
      ? `<p style="margin:10px 0 0 0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;">Dados anteriores a setembro de 2026 podem ter comissão subestimada.</p>` : '';

    const conversao = temVendeuAt && temVendeuAt > 0
      ? `${convertidas} ${convertidas === 1 ? 'venda que estava' : 'vendas que estavam'} em andamento ${convertidas === 1 ? 'fechou' : 'fecharam'} nesta semana.`
      : 'Conversão de "Em andamento" para "Sim": sem dados ainda (o registro começou em 03/09/2026).';

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:640px;margin:0 auto;border:1px solid #eee;padding:30px;border-radius:16px;background-color:#ffffff;">
        <div style="text-align:center;margin-bottom:22px;">
          <p style="margin:0 0 6px 0;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#C69C6D;font-family:Arial,sans-serif;">Meta de comissão</p>
          <h2 style="color:#1B263B;margin:0;font-size:20px;font-family:Georgia,serif;border-bottom:3px solid #C69C6D;display:inline-block;padding-bottom:6px;">Relatório da semana de ${formatarDataBr(semIni).slice(0, 5)} a ${formatarDataBr(semFim).slice(0, 5)}</h2>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 18px;"><tr>
          ${bloco('Comissão da semana', formatarBrl(comSemana), corSemana, `${pct(metaSemanal > 0 ? comSemana / metaSemanal : 0)} da meta semanal de ${formatarBrl(metaSemanal)} · ${daSemana.length} ${daSemana.length === 1 ? 'venda' : 'vendas'}`)}
          ${bloco('Semana anterior', formatarBrl(comAnterior), '#1B263B', `${varSemana >= 0 ? '+' : ''}${formatarBrl(varSemana)} nesta semana · ${daAnterior.length} ${daAnterior.length === 1 ? 'venda' : 'vendas'} (${formatarDataBr(antIni).slice(0, 5)} a ${formatarDataBr(antFim).slice(0, 5)})`)}
        </tr></table>

        <div style="margin:0 0 20px 0;border:2px solid #C69C6D;border-radius:12px;overflow:hidden;">
          <div style="background-color:#1B263B;color:#C69C6D;padding:10px 14px;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Vendas da semana</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              ${['Data', 'Cliente', 'Seguradora', 'Modalidade', 'Prêmio', 'Comissão'].map((h, i) => `<th style="padding:8px 6px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;text-align:${i >= 4 ? 'right' : 'left'};border-bottom:1px solid #C69C6D;">${h}</th>`).join('')}
            </tr>
            ${linhas}
          </table>
        </div>

        <p style="${ROTULO}margin-bottom:8px;">${nomeDoMes(mesIni)} até ${formatarDataBr(corteMes)}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 8px;"><tr>
          ${bloco('Acumulado no mês', formatarBrl(comMes), '#1B263B', `${pct(meta > 0 ? comMes / meta : 0)} da meta de ${formatarBrl(meta)}${faltaMes > 0 ? ` · faltam ${formatarBrl(faltaMes)}` : ' · meta batida'}`)}
          ${bloco('Ritmo', `${comMes - esperado >= 0 ? '+' : ''}${formatarBrl(comMes - esperado)}`, corRitmo, `esperado ${formatarBrl(esperado)} em ${uteisPassados} de ${uteisMes} dias úteis`)}
        </tr></table>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 18px;"><tr>
          ${bloco('Projeção de fechamento', formatarBrl(projecao), projecao >= meta ? '#059669' : '#1B263B', `no ritmo atual, ${pct(meta > 0 ? projecao / meta : 0)} da meta`)}
          ${bloco('Dias úteis restantes', String(uteisRestantes), '#1B263B', faltaMes > 0 && uteisRestantes > 0 ? `${formatarBrl(faltaMes / uteisRestantes)} por dia para fechar` : 'meta diária de ' + formatarBrl(metaDiaria))}
        </tr></table>

        <p style="${P}">${novas ?? 0} ${novas === 1 ? 'venda nova cadastrada' : 'vendas novas cadastradas'} na semana. ${conversao}</p>
        ${notaHistorico}

        <div style="margin-top:30px;border-top:1px solid #e2e8f0;padding-top:18px;text-align:center;">
          <p style="margin-bottom:4px;font-weight:900;color:#1B263B;font-size:15px;text-transform:uppercase;letter-spacing:1px;">F&amp;G Seguro Garantia</p>
          <p style="font-size:12px;color:#64748b;margin:0;">Relatório automático semanal · Meta de Comissão no hub</p>
        </div>
      </div>`;

    const assunto = `${teste ? '[TESTE] ' : ''}Meta de comissão · semana ${formatarDataBr(semIni).slice(0, 5)} a ${formatarDataBr(semFim).slice(0, 5)}: ${formatarBrl(comSemana)} de ${formatarBrl(metaSemanal)}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: 'F&G Corretora <contato@fegsegurogarantia.com.br>', to: destinatarios, subject: assunto, html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);

    if (!teste) {
      await supabase.from('relatorio_meta_envios').upsert(
        { semana_inicio: semIni, enviado_em: new Date().toISOString(), destinatarios, comissao_semana: comSemana, comissao_mes: comMes },
        { onConflict: 'semana_inicio' },
      );
    }

    return json({ success: true, semana_inicio: semIni, semana_fim: semFim, para: destinatarios, comissao_semana: comSemana, comissao_mes: comMes, vendas_semana: daSemana.length, teste });
  } catch (e) {
    console.error('[weekly-goal-report]', e);
    return json({ success: false, error: String((e as Error)?.message || e) }, 500);
  }
});
