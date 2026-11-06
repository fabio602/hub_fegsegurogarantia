import React, { useEffect, useMemo, useState } from 'react';
import { Phone, MessageCircle, Mail, Loader2, UserPlus, Trophy, XCircle, RotateCcw, CalendarClock, History, NotebookPen } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import { whatsappUrlFromPhone } from '../../../utils/whatsapp.ts';
import {
  DIAS_PADRAO, MOTIVOS_PERDA, RESULTADOS_POR_CANAL, ROTULO_ETAPA, ROTULO_MOTIVO_PERDA, ROTULO_RESULTADO, RESUMO_RESULTADO,
  etapaAposResultado, hojeSaoPaulo, rotuloDia, somarDiasUteis, type CanalContato,
} from '../../../lib/contatoLead.ts';
import type { MotivoPerda, ResultadoContato } from '../../../types.ts';
import {
  ETAPA_CLASSES, FALOU_COM_LABEL, emailEfetivo, formatDataHoraBr, telefoneEfetivo,
  type FalouCom, type RadarEmpresa, type RadarToque,
} from './radarTipos.ts';

interface Membro { email: string; nome: string; gestor: boolean; ativo: boolean }

interface Props {
  empresa: RadarEmpresa;
  /** Relê a linha no banco e devolve para a tela. */
  onRecarregar: () => Promise<void>;
}

const secao = 'text-[10px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-1.5';
const botao = 'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const campo = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white';

const ROTULO_CANAL: Record<CanalContato, string> = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail' };

/**
 * Abordagem do lead dentro do Radar (migração 134): quem assumiu, etapa,
 * próximo passo, registro de cada contato ("Como foi?") e histórico.
 * Etapas e resultados seguem as mesmas regras do Kanban (lib/contatoLead.ts),
 * mas o lead nunca sai do Radar.
 */
export default function RadarAbordagem({ empresa, onRecarregar }: Props) {
  const { toast } = useToast();
  const [meuEmail, setMeuEmail] = useState('');
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [toques, setToques] = useState<RadarToque[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // "Como foi?"
  const [canal, setCanal] = useState<CanalContato | null>(null);
  const [resultado, setResultado] = useState<ResultadoContato | ''>('');
  const [falouCom, setFalouCom] = useState<FalouCom>('empresa');
  const [nota, setNota] = useState('');
  const [proximo, setProximo] = useState('');
  // Encerrar como perdido
  const [pedindoPerda, setPedindoPerda] = useState(false);
  const [motivoPerda, setMotivoPerda] = useState<MotivoPerda>('sem_interesse');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeuEmail((data.user?.email || '').toLowerCase()));
    supabase.from('prospeccao_equipe').select('email, nome, gestor, ativo').then(({ data }) => setEquipe((data ?? []) as Membro[]));
  }, []);

  const carregarToques = async () => {
    const { data, error } = await supabase.from('radar_toques')
      .select('id, cnpj, canal, resultado, falou_com, nota, proximo_passo, autor_email, created_at')
      .eq('cnpj', empresa.cnpj)
      .order('created_at', { ascending: false });
    if (error) { toast('Não foi possível carregar os contatos.', 'error'); setToques([]); return; }
    setToques((data ?? []) as RadarToque[]);
  };

  useEffect(() => {
    setToques(null);
    setCanal(null);
    setPedindoPerda(false);
    carregarToques();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.cnpj]);

  const nomeDe = (email: string | null | undefined) =>
    !email ? '' : equipe.find(m => m.email === email.toLowerCase())?.nome ?? email.split('@')[0];
  const souGestor = useMemo(() => equipe.some(m => m.email === meuEmail && m.gestor), [equipe, meuEmail]);
  const naEquipe = useMemo(() => equipe.some(m => m.email === meuEmail && m.ativo), [equipe, meuEmail]);

  const telefone = telefoneEfetivo(empresa);
  const email = emailEfetivo(empresa);
  const urlWhats = whatsappUrlFromPhone(telefone);
  const etapa = empresa.etapa ?? null;
  const encerrado = etapa === 'ganho' || etapa === 'perdido';
  const hoje = hojeSaoPaulo();
  const atrasado = !!empresa.proximo_passo && empresa.proximo_passo <= hoje && !encerrado;

  const atualizar = async (campos: Record<string, unknown>, msg: string): Promise<boolean> => {
    setOcupado(true);
    const { error } = await supabase.from('radar_empresas')
      .update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq('cnpj', empresa.cnpj);
    setOcupado(false);
    if (error) { toast(`Não foi possível salvar: ${error.message}`, 'error'); return false; }
    await onRecarregar();
    toast(msg, 'success');
    return true;
  };

  const assumir = (para: string) => {
    if (!para) return;
    const agora = new Date().toISOString();
    return atualizar({
      responsavel_email: para,
      responsavel_em: agora,
      etapa: etapa ?? 'contatar',
    }, para === meuEmail ? 'Lead assumido. Ele aparece em "Meus".' : `Lead passado para ${nomeDe(para)}.`);
  };

  const soltar = () => atualizar({
    responsavel_email: null, responsavel_em: null,
    // Sem contato registrado, volta a "não iniciada"; com contato, mantém a etapa.
    etapa: (toques?.length ?? 0) > 0 ? etapa : null,
    proximo_passo: (toques?.length ?? 0) > 0 ? empresa.proximo_passo : null,
  }, 'Lead liberado.');

  /** Abre o canal (telefone, WhatsApp, e-mail) e já mostra o "Como foi?". */
  const abrirCanal = (c: CanalContato) => {
    if (c === 'ligacao' && telefone) window.location.href = `tel:${telefone.replace(/\D/g, '')}`;
    if (c === 'whatsapp' && urlWhats) window.open(urlWhats, '_blank', 'noopener');
    if (c === 'email' && email) window.location.href = `mailto:${email}`;
    iniciarRegistro(c);
  };

  const iniciarRegistro = (c: CanalContato) => {
    setCanal(c);
    setResultado('');
    setNota('');
    setProximo('');
    setFalouCom('empresa');
  };

  const escolherResultado = (r: ResultadoContato) => {
    setResultado(r);
    const dias = DIAS_PADRAO[r];
    setProximo(dias == null ? '' : somarDiasUteis(hoje, dias));
  };

  const salvarContato = async () => {
    if (!canal || !resultado) { toast('Escolha como foi o contato.', 'warning'); return; }
    setOcupado(true);
    const { error } = await supabase.from('radar_toques').insert({
      cnpj: empresa.cnpj,
      canal,
      resultado,
      falou_com: falouCom,
      nota: nota.trim().slice(0, 1000) || null,
      proximo_passo: proximo || null,
    });
    if (error) { setOcupado(false); toast(`Falha ao registrar: ${error.message}`, 'error'); return; }
    const novaEtapa = etapaAposResultado(etapa, resultado);
    const agora = new Date().toISOString();
    const campos: Record<string, unknown> = {
      etapa: novaEtapa,
      proximo_passo: novaEtapa === 'perdido' ? null : (proximo || null),
      motivo_perda: novaEtapa === 'perdido' ? 'sem_interesse' : null,
      encerrado_em: novaEtapa === 'perdido' ? agora : null,
    };
    // Quem registra o contato num lead sem dono passa a ser o responsável.
    if (!empresa.responsavel_email && naEquipe) { campos.responsavel_email = meuEmail; campos.responsavel_em = agora; }
    setOcupado(false);
    const ok = await atualizar(campos, novaEtapa === 'perdido' ? 'Contato registrado. Lead encerrado como perdido.' : 'Contato registrado.');
    if (ok) { setCanal(null); await carregarToques(); }
  };

  const ganhar = () => atualizar({ etapa: 'ganho', proximo_passo: null, motivo_perda: null, encerrado_em: new Date().toISOString() }, 'Lead marcado como ganho.');

  const perder = async () => {
    const ok = await atualizar({ etapa: 'perdido', proximo_passo: null, motivo_perda: motivoPerda, encerrado_em: new Date().toISOString() }, 'Lead encerrado como perdido.');
    if (ok) setPedindoPerda(false);
  };

  const reabrir = () => atualizar({
    etapa: (toques?.length ?? 0) > 0 ? 'tentando' : 'contatar', motivo_perda: null, encerrado_em: null,
  }, 'Lead reaberto.');

  const mudarProximo = (dia: string) => atualizar({ proximo_passo: dia || null }, dia ? `Próximo contato em ${rotuloDia(dia)}.` : 'Próximo contato removido.');

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4" aria-labelledby="radar-abordagem-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="radar-abordagem-titulo" className={secao}><NotebookPen size={12} aria-hidden="true" /> Abordagem</h3>
          {etapa ? (
            <span className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${ETAPA_CLASSES[etapa]}`}>{ROTULO_ETAPA[etapa]}</span>
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider bg-slate-50 text-slate-600 border-slate-200">Não iniciada</span>
          )}
          {empresa.responsavel_email && (
            <span className="text-[12px] text-slate-700">com <strong className="text-navy">{nomeDe(empresa.responsavel_email)}</strong></span>
          )}
          {etapa === 'perdido' && empresa.motivo_perda && (
            <span className="text-[11px] text-slate-600">({ROTULO_MOTIVO_PERDA[empresa.motivo_perda]})</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!empresa.responsavel_email && naEquipe && (
            <button type="button" onClick={() => assumir(meuEmail)} disabled={ocupado}
              className={`${botao} bg-navy hover:bg-navy-light text-areia border-gold/35`}>
              <UserPlus size={13} aria-hidden="true" /> Assumir
            </button>
          )}
          {souGestor && (
            <select aria-label="Passar o lead para" value="" disabled={ocupado}
              onChange={e => assumir(e.target.value)}
              className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold uppercase tracking-wider text-slate-700 cursor-pointer hover:border-gold">
              <option value="">Passar para...</option>
              {equipe.filter(m => m.ativo && m.email !== empresa.responsavel_email).map(m => <option key={m.email} value={m.email}>{m.nome}</option>)}
            </select>
          )}
          {empresa.responsavel_email && (empresa.responsavel_email === meuEmail || souGestor) && !encerrado && (
            <button type="button" onClick={soltar} disabled={ocupado}
              className={`${botao} bg-white border-slate-200 text-slate-700 hover:border-gold hover:text-navy`}>Liberar</button>
          )}
        </div>
      </div>

      {/* Próximo passo */}
      {etapa && !encerrado && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 border text-[12px] ${atrasado ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
          <CalendarClock size={14} aria-hidden="true" />
          <label htmlFor="radar-proximo" className="font-bold">Próximo contato</label>
          <input id="radar-proximo" type="date" value={empresa.proximo_passo ?? ''} disabled={ocupado}
            onChange={e => mudarProximo(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[12px] outline-none focus:border-gold" />
          {empresa.proximo_passo && <span>{rotuloDia(empresa.proximo_passo)}{atrasado ? (empresa.proximo_passo < hoje ? ', atrasado' : ', hoje') : ''}</span>}
          {!empresa.proximo_passo && <span>sem data marcada</span>}
        </div>
      )}

      {/* Canais */}
      {!encerrado && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => abrirCanal('ligacao')} disabled={ocupado || !telefone}
            title={telefone ? `Ligar para ${telefone}` : 'Sem telefone cadastrado'}
            className={`${botao} bg-white border-slate-200 text-slate-700 hover:border-gold hover:text-navy`}>
            <Phone size={13} aria-hidden="true" /> Ligação
          </button>
          <button type="button" onClick={() => abrirCanal('whatsapp')} disabled={ocupado || !urlWhats}
            title={urlWhats ? 'Abre o WhatsApp' : 'Sem celular válido'}
            className={`${botao} bg-white border-slate-200 text-slate-700 hover:border-gold hover:text-navy`}>
            <MessageCircle size={13} aria-hidden="true" /> WhatsApp
          </button>
          <button type="button" onClick={() => abrirCanal('email')} disabled={ocupado || !email}
            title={email ? `Escrever para ${email}` : 'Sem e-mail cadastrado'}
            className={`${botao} bg-white border-slate-200 text-slate-700 hover:border-gold hover:text-navy`}>
            <Mail size={13} aria-hidden="true" /> E-mail
          </button>
          <span className="text-[11px] text-slate-500">ou registre um contato feito por fora:</span>
          {(['ligacao', 'whatsapp', 'email'] as CanalContato[]).map(c => (
            <button key={c} type="button" onClick={() => iniciarRegistro(c)} disabled={ocupado}
              className="text-[11px] font-bold text-navy underline-offset-2 hover:underline disabled:opacity-50">{ROTULO_CANAL[c]}</button>
          ))}
        </div>
      )}

      {/* Como foi? */}
      {canal && (
        <form onSubmit={e => { e.preventDefault(); salvarContato(); }}
          className="rounded-xl border border-linha bg-areia-clara px-4 py-4 space-y-3 animate-in fade-in duration-200">
          <p className="text-[12px] font-bold text-navy">Como foi? <span className="font-medium text-slate-600">({ROTULO_CANAL[canal]})</span></p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Resultado do contato">
            {RESULTADOS_POR_CANAL[canal].map(r => (
              <button key={r} type="button" role="radio" aria-checked={resultado === r} onClick={() => escolherResultado(r)}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${
                  resultado === r ? 'bg-navy text-areia border-navy' : 'bg-white text-slate-700 border-slate-200 hover:border-gold'
                }`}>{ROTULO_RESULTADO[r]}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[10rem_10rem_1fr] gap-2">
            <div>
              <label htmlFor="radar-falou" className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Falou com</label>
              <select id="radar-falou" value={falouCom} onChange={e => setFalouCom(e.target.value as FalouCom)} className={`${campo} cursor-pointer`}>
                {(Object.keys(FALOU_COM_LABEL) as FalouCom[]).map(f => <option key={f} value={f}>{FALOU_COM_LABEL[f]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="radar-prox-toque" className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Próximo contato</label>
              <input id="radar-prox-toque" type="date" value={proximo} onChange={e => setProximo(e.target.value)}
                disabled={resultado === 'sem_interesse'} className={campo} />
            </div>
            <div>
              <label htmlFor="radar-nota" className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Anotação</label>
              <input id="radar-nota" maxLength={1000} value={nota} onChange={e => setNota(e.target.value)}
                placeholder="Ex.: falei com o financeiro, pediu para mandar material" className={campo} />
            </div>
          </div>
          {resultado === 'sem_interesse' && (
            <p className="text-[11px] text-amber-800">Ao salvar, o lead é encerrado como perdido (sem interesse).</p>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={ocupado || !resultado}
              className={`${botao} bg-navy hover:bg-navy-light text-areia border-gold/35`}>
              {ocupado ? <Loader2 size={13} className="animate-spin" aria-label="Salvando" /> : 'Salvar contato'}
            </button>
            <button type="button" onClick={() => setCanal(null)} disabled={ocupado}
              className={`${botao} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>Cancelar</button>
          </div>
        </form>
      )}

      {/* Encerrar / reabrir */}
      {etapa && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!encerrado && !pedindoPerda && (
            <>
              <button type="button" onClick={ganhar} disabled={ocupado}
                className={`${botao} bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100`}>
                <Trophy size={13} aria-hidden="true" /> Ganho
              </button>
              <button type="button" onClick={() => setPedindoPerda(true)} disabled={ocupado}
                className={`${botao} bg-white border-slate-200 text-slate-700 hover:border-amber-300 hover:text-amber-800`}>
                <XCircle size={13} aria-hidden="true" /> Perdido
              </button>
            </>
          )}
          {pedindoPerda && (
            <form onSubmit={e => { e.preventDefault(); perder(); }} className="flex flex-wrap items-center gap-2">
              <label htmlFor="radar-motivo-perda" className="text-[11px] font-bold text-slate-700">Motivo</label>
              <select id="radar-motivo-perda" value={motivoPerda} onChange={e => setMotivoPerda(e.target.value as MotivoPerda)}
                className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-[12px] cursor-pointer">
                {MOTIVOS_PERDA.map(m => <option key={m} value={m}>{ROTULO_MOTIVO_PERDA[m]}</option>)}
              </select>
              <button type="submit" disabled={ocupado} className={`${botao} bg-amber-500 hover:bg-amber-600 text-white border-amber-500`}>Encerrar</button>
              <button type="button" onClick={() => setPedindoPerda(false)} disabled={ocupado}
                className={`${botao} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>Cancelar</button>
            </form>
          )}
          {encerrado && (
            <button type="button" onClick={reabrir} disabled={ocupado}
              className={`${botao} bg-white border-slate-200 text-slate-700 hover:border-gold hover:text-navy`}>
              <RotateCcw size={13} aria-hidden="true" /> Reabrir
            </button>
          )}
        </div>
      )}

      {/* Histórico */}
      <div className="pt-3 border-t border-slate-100">
        <h4 className={secao}><History size={12} aria-hidden="true" /> Contatos ({toques?.length ?? '...'})</h4>
        {toques === null ? (
          <p className="text-[12px] text-slate-600 mt-2"><Loader2 size={12} className="inline animate-spin mr-1" aria-hidden="true" /> Carregando...</p>
        ) : toques.length === 0 ? (
          <p className="text-[12px] text-slate-600 mt-2">Nenhum contato registrado ainda.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {toques.map(t => (
              <li key={t.id} className="text-[12px] text-slate-800 flex gap-3">
                <span className="tabular-nums text-slate-500 whitespace-nowrap">{formatDataHoraBr(t.created_at)}</span>
                <span className="min-w-0">
                  <strong className="text-navy">{ROTULO_CANAL[t.canal]}</strong>
                  {t.resultado && <> · {RESUMO_RESULTADO[t.resultado]}</>}
                  {t.falou_com && <> · com {FALOU_COM_LABEL[t.falou_com].toLowerCase()}</>}
                  {t.autor_email && <span className="text-slate-500"> · {nomeDe(t.autor_email)}</span>}
                  {t.nota && <span className="block text-slate-700">{t.nota}</span>}
                  {t.proximo_passo && <span className="block text-[11px] text-slate-500">Próximo: {rotuloDia(t.proximo_passo)}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
