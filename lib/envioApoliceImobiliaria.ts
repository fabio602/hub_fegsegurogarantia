import { supabase } from './supabase.ts';

/**
 * Envio da apólice para a imobiliária, com conferência antes de sair.
 *
 * Até 27/11/2026 o e-mail saía sozinho no instante em que o PDF era anexado,
 * no Registro de Vendas e no Repasse. Anexar nos dois lugares mandava o mesmo
 * e-mail duas vezes, e um arquivo anexado por engano já tinha ido embora antes
 * de alguém perceber. Agora anexar só guarda o arquivo: o envio é um botão, que
 * mostra para quem vai, com quais anexos, e avisa quando já foi enviado.
 *
 * As duas telas usam esta função para a regra ficar em um lugar só.
 */

export type TipoApolice = 'garantia' | 'residencial';

export interface ResultadoEnvio {
  /** true quando o e-mail saiu agora. */
  enviado: boolean;
  /** Frase pronta para o aviso na tela. Vazia quando o corretor desistiu. */
  mensagem: string;
  erro?: boolean;
  /** Hora do envio, quando saiu. */
  enviadoEm?: string;
}

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Texto do botão conforme já tenha saído ou não.
 *
 * `jaEmitida` cobre os cadastros anteriores à migração 146: a apólice consta
 * como emitida, então o e-mail muito provavelmente já saiu pelo envio
 * automático antigo, só não há hora registrada. O botão não convida a enviar
 * como se fosse a primeira vez.
 */
export const rotuloEnvio = (enviadoEm?: string | null, jaEmitida = false) =>
  enviadoEm ? `Enviado em ${dataHora(enviadoEm)} · Reenviar`
    : jaEmitida ? 'Reenviar para a imobiliária'
    : 'Enviar para a imobiliária';

export async function enviarApoliceParaImobiliaria(
  clientId: string,
  tipo: TipoApolice,
  confirmar: (mensagem: string) => Promise<boolean> | boolean,
): Promise<ResultadoEnvio> {
  const falha = (texto: string): ResultadoEnvio => ({ enviado: false, erro: true, mensagem: texto });

  // 1. Prévia: nada é enviado aqui.
  const { data: previa, error: previaErr } = await supabase.functions.invoke('imobiliaria-envia-apolice', {
    body: { client_id: clientId, tipo, previa: true },
  });
  const p = previa as any;
  if (previaErr || p?.error) return falha(`Não foi possível preparar o e-mail: ${p?.error || previaErr?.message || 'erro'}`);
  // Função antiga, sem prévia, teria enviado direto. Não segue às cegas.
  if (!p?.previa) return falha('A função de e-mail ainda não foi atualizada. Avise o Fábio antes de enviar.');

  const jaEnviado: string | null = p.ja_enviado_em || null;
  const linhas = [
    jaEnviado
      ? `Este e-mail já foi enviado em ${dataHora(jaEnviado)}. Enviar de novo?`
      : `Enviar a apólice para ${p.imobiliaria}? Se ela já recebeu este e-mail antes, vai receber de novo.`,
    '',
    `Para: ${(p.para || []).join(', ')}`,
    `Anexos: ${(p.anexos || []).join(', ')}`,
    `Inquilino: ${p.dados?.inquilino || 'não informado'}`,
    `Nº da apólice: ${p.dados?.numero_apolice || 'não informado'}`,
    `Seguradora: ${p.dados?.seguradora || 'não informada'}`,
    `Vigência: ${p.dados?.vigencia || 'não informada'}`,
  ];
  if (!(await confirmar(linhas.join('\n')))) return { enviado: false, mensagem: '' };

  // 2. Envio. `reenviar` só vai quando o corretor confirmou o aviso acima.
  const { data: envio, error: envioErr } = await supabase.functions.invoke('imobiliaria-envia-apolice', {
    body: { client_id: clientId, tipo, reenviar: Boolean(jaEnviado) },
  });
  const e = envio as any;
  if (envioErr || e?.error) return falha(`O e-mail para a imobiliária não saiu: ${e?.error || envioErr?.message || 'erro'}`);
  if (e?.ja_enviado) {
    return { enviado: false, mensagem: `Outra pessoa já enviou este e-mail em ${dataHora(e.enviado_em)}. Nada foi reenviado.`, enviadoEm: e.enviado_em };
  }
  return {
    enviado: true,
    enviadoEm: e?.enviado_em,
    mensagem: `Apólice enviada para ${(e?.enviado_para || p.para || []).join(', ')}.`,
  };
}
