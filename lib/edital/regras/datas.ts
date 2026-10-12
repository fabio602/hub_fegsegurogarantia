/**
 * Datas e prazos: sessão pública, limite de propostas e validade da proposta (art. 59).
 */
import { Documento, ocorrencias, paginaDe, trecho } from '../documento.ts';
import { acharData, acharHora, formatarDataHora, type DataHora } from '../numeros.ts';
import type { Evidencia } from '../../editalSchema.ts';

export interface ResultadoDatas {
  data_sessao_publica: string | null;
  data_limite_propostas: string | null;
  validade_proposta_dias: number | null;
  validade_proposta_fonte: string | null;
  divergencia_validade_proposta: string | null;
  evidencias: Record<string, Evidencia>;
}

interface Achado { data: DataHora; ini: number; fim: number; peso: number }

/** Para cada rótulo, procura data e hora nos ~230 caracteres seguintes. */
function procurar(doc: Documento, rotulos: { re: RegExp; peso: number }[], ate: number): Achado[] {
  const out: Achado[] = [];
  for (const { re, peso } of rotulos) {
    for (const m of ocorrencias(doc, re, 0, ate)) {
      const ini = m.index;
      const janela = doc.busca.slice(ini, ini + 230);
      const d = acharData(janela);
      if (!d || d.data.ano < 2000) continue;
      // Data longe demais do rótulo provavelmente é de outra coisa
      if (janela.slice(0, d.fim).split('\n').length > 4) continue;
      // Hora: primeiro entre rótulo e data, depois logo após a data
      const h = acharHora(janela.slice(d.fim, d.fim + 120)) ?? acharHora(janela.slice(m[0].length, d.fim - 10));
      out.push({
        data: h ? { ...d.data, hora: h.hora, minuto: h.minuto } : d.data,
        ini, fim: ini + d.fim, peso: peso + (h ? 2 : 0),
      });
    }
  }
  return out.sort((a, b) => b.peso - a.peso || a.ini - b.ini);
}

export function extrairDatas(doc: Documento): ResultadoDatas {
  const ev: Record<string, Evidencia> = {};
  const fim5 = doc.linhas.find(l => l.pagina > 5)?.inicio ?? doc.texto.length;

  const sessao = procurar(doc, [
    { re: /(?:data|dia)\s+(?:e\s+hora(?:rio)?\s+)?d[ae]\s+(?:abertura\s+d[ae]\s+)?sessao(?:\s+publica)?/g, peso: 6 },
    { re: /sessao\s+publica\s*(?:dia|:|sera\s+realizada|virtual\s+sera\s+realizada|de\s+abertura)/g, peso: 5 },
    { re: /(?:data\s+(?:e\s+hora\s+)?(?:da|de)\s+)?abertura\s+(?:das|de)\s+propostas/g, peso: 4 },
    { re: /abertura\s+da\s+(?:sessao|licitacao|disputa)|inicio\s+da\s+sessao|data\s+do\s+certame|data\s+da\s+disputa/g, peso: 3 },
    { re: /as\s+\d{1,2}\s*(?::|h)\s*\d{0,2}\s*(?:horas?|h)?\s+do\s+dia/g, peso: 3 },
  ], fim5)[0];
  let dataSessao: string | null = null;
  if (sessao) {
    dataSessao = formatarDataHora(sessao.data);
    ev.data_sessao_publica = { trecho: trecho(doc, sessao.ini, sessao.fim, 160), pagina: paginaDe(doc, sessao.ini) };
  }

  const limite = procurar(doc, [
    { re: /(?:limite|prazo\s+final|data\s+final)\s+(?:para\s+)?(?:o\s+|a\s+)?(?:entrega|recebimento|envio|cadastramento|apresentacao|acolhimento)\s+(?:das|de)\s+propostas/g, peso: 5 },
    { re: /(?:recebimento|acolhimento|entrega)\s+(?:das|de)\s+propostas\s+ate/g, peso: 4 },
  ], fim5)[0];
  let dataLimite: string | null = null;
  if (limite) {
    dataLimite = formatarDataHora(limite.data);
    ev.data_limite_propostas = { trecho: trecho(doc, limite.ini, limite.fim, 160), pagina: paginaDe(doc, limite.ini) };
  }

  // Validade da proposta (art. 59): todos os valores, para detectar divergência entre corpo e anexos
  const validades: { dias: number; ini: number; fim: number }[] = [];
  for (const m of ocorrencias(doc, /validade\s+(?:minima\s+)?d[ao]s?\s+propostas?(?:\s+de\s+precos?)?[^.\d]{0,90}?(\d{2,3})\s*(?:\([a-z\s-]+\)\s*)?dias/g)) {
    const dias = Number(m[1]);
    if (dias < 10 || dias > 365) continue;
    validades.push({ dias, ini: m.index, fim: m.index + m[0].length });
  }
  let validade: number | null = null, fonte: string | null = null, divergencia: string | null = null;
  if (validades.length) {
    const v = validades[0];
    validade = v.dias;
    fonte = trecho(doc, v.ini, v.fim, 150);
    ev.validade_proposta_dias = { trecho: fonte, pagina: paginaDe(doc, v.ini) };
    const distintos = [...new Map(validades.map(x => [x.dias, x])).values()];
    if (distintos.length > 1) {
      divergencia = distintos.map(x => `${x.dias} dias (p. ${paginaDe(doc, x.ini)})`).join(' x ')
        + '. Vale o prazo do corpo do edital; confira os anexos.';
    }
  }

  return {
    data_sessao_publica: dataSessao,
    data_limite_propostas: dataLimite,
    validade_proposta_dias: validade,
    validade_proposta_fonte: fonte,
    divergencia_validade_proposta: divergencia,
    evidencias: ev,
  };
}
