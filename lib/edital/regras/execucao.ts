/** Garantia de execução contratual (arts. 96 a 98 da Lei 14.133/2021). */
import { Documento, ocorrencias, paginaDe, trecho } from '../documento.ts';
import { parsePercentual } from '../numeros.ts';
import type { Evidencia, GarantiaExecucaoState } from '../../editalSchema.ts';

export interface ResultadoExecucao {
  exige: GarantiaExecucaoState;
  percentual: number | null;
  evidencia: Evidencia | null;
}

const RE_ANCORA = /garantia\s+(?:de\s+|da\s+)?(?:execucao|contratual)|garantia\s+do\s+contrato|prestacao\s+de\s+garantia/g;

export function extrairExecucao(doc: Documento): ResultadoExecucao {
  const neg = ocorrencias(doc, /nao\s+(?:sera|e|havera)\s+exigid[ao]\s+(?:a\s+)?(?:prestacao\s+de\s+)?garantia\s+(?:de\s+execucao|contratual)|dispensad[ao]\s+(?:a\s+)?garantia\s+(?:de\s+execucao|contratual)/g)[0];
  if (neg) {
    return { exige: false, percentual: null, evidencia: { trecho: trecho(doc, neg.index, neg.index + neg[0].length), pagina: paginaDe(doc, neg.index) } };
  }

  let condicionada: { ini: number; fim: number } | null = null;
  for (const m of ocorrencias(doc, RE_ANCORA)) {
    const janela = doc.busca.slice(Math.max(0, m.index - 150), m.index + 350);
    const rel = Math.min(150, m.index);
    const pctM = /(\d+(?:,\d+)?)\s*%/.exec(janela.slice(rel));
    const pct = pctM ? parsePercentual(pctM[0]) : null;
    const valido = pct != null && pct > 0 && pct <= 30 && !/multa|inferior\s+a\s+85/.test(janela.slice(rel, rel + (pctM?.index ?? 0)));
    const ini = m.index;
    const fim = m.index + (pctM ? pctM.index + pctM[0].length : m[0].length);
    if (/sera\s+exigid|e\s+exigid|devera\s+prestar|prestara\s+garantia|exigir-se-a|devera\s+apresentar/.test(janela) && valido) {
      return { exige: true, percentual: pct, evidencia: { trecho: trecho(doc, ini, fim), pagina: paginaDe(doc, ini) } };
    }
    if (!condicionada && /podera\s+(?:ser\s+)?exigi|a\s+criterio\s+da\s+administracao|facultad/.test(janela)) condicionada = { ini, fim };
  }
  if (condicionada) {
    return { exige: 'condicionada', percentual: null, evidencia: { trecho: trecho(doc, condicionada.ini, condicionada.fim), pagina: paginaDe(doc, condicionada.ini) } };
  }
  return { exige: null, percentual: null, evidencia: null };
}
