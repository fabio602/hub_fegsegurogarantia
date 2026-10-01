import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Inbox, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Aviso ao abrir o hub: o que chegou das imobiliárias e precisa de alguém.
 *
 * - Solicitações novas: cards ainda em "Solicitado" no kanban do Repasse.
 * - Renovações a fazer: a imobiliária respondeu "vai renovar" e a apólice
 *   vence em até 45 dias (ou já venceu) — a mesma regra da lista do Repasse.
 *
 * Aparece uma vez por sessão do navegador (sessionStorage) e só quando há
 * algo na lista. Quem decide se a pessoa pode ver é o App (módulo Residencial).
 */

type Linha = { id: string; inquilino_nome: string; vigencia_fim?: string | null; partner_id?: number | null };

const CHAVE_SESSAO = 'hub-aviso-entrada-visto';
const ENCERRADOS = ['cancelado', 'saiu_imovel', 'desistiu', 'reprovado'];

const diasAte = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((new Date(a, m - 1, d).getTime() - hoje.getTime()) / 86400000);
};
const fmtData = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

const AvisoEntrada: React.FC<{ onAbrirRepasse: () => void }> = ({ onAbrirRepasse }) => {
  const [aberto, setAberto] = useState(false);
  const [novos, setNovos] = useState<Linha[]>([]);
  const [renovar, setRenovar] = useState<Linha[]>([]);
  const [parceiros, setParceiros] = useState<Record<number, string>>({});

  useEffect(() => {
    try { if (sessionStorage.getItem(CHAVE_SESSAO)) return; } catch { /* segue */ }
    (async () => {
      const [{ data: sol }, { data: ren }, { data: parc }] = await Promise.all([
        supabase.from('imobiliaria_clientes').select('id, inquilino_nome, partner_id')
          .eq('kanban_status', 'solicitado').order('created_at', { ascending: true }),
        supabase.from('imobiliaria_clientes').select('id, inquilino_nome, vigencia_fim, partner_id, status_apolice')
          .eq('renovacao_confirmacao', 'vai_renovar').not('vigencia_fim', 'is', null),
        supabase.from('partners').select('id, name'),
      ]);
      const listaRen = ((ren || []) as any[])
        .filter(r => !ENCERRADOS.includes(r.status_apolice || '') && diasAte(r.vigencia_fim) <= 45)
        .sort((a, b) => String(a.vigencia_fim).localeCompare(String(b.vigencia_fim)));
      setNovos((sol || []) as Linha[]);
      setRenovar(listaRen);
      setParceiros(Object.fromEntries(((parc || []) as any[]).map(p => [p.id, String(p.name || '').replace('Imobiliária ', '')])));
      if ((sol || []).length || listaRen.length) setAberto(true);
    })();
  }, []);

  const fechar = () => {
    try { sessionStorage.setItem(CHAVE_SESSAO, '1'); } catch { /* sem efeito */ }
    setAberto(false);
  };

  if (!aberto) return null;

  const nomeParceiro = (l: Linha) => (l.partner_id && parceiros[l.partner_id]) || '';

  return createPortal(
    <div className="fixed inset-0 z-[9998] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={fechar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <p className="text-[10px] font-bold text-gold-dark uppercase tracking-widest">Repasse Imobiliárias</p>
            <h3 className="font-black text-slate-800 text-lg mt-0.5">O que chegou para você</h3>
          </div>
          <button onClick={fechar} title="Fechar" className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} className="text-slate-400" /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {novos.length > 0 && (
            <section>
              <p className="flex items-center gap-2 text-sm font-black text-navy">
                <Inbox size={16} className="text-gold-dark" />
                {novos.length === 1 ? '1 solicitação nova' : `${novos.length} solicitações novas`}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">Ainda em "Solicitado". Abra o card e comece o atendimento.</p>
              <ul className="space-y-1.5">
                {novos.slice(0, 6).map(l => (
                  <li key={l.id} className="flex justify-between gap-3 text-sm bg-slate-50 rounded-xl px-3 py-2">
                    <span className="font-bold text-slate-700 truncate">{l.inquilino_nome}</span>
                    <span className="text-xs text-slate-400 shrink-0">{nomeParceiro(l)}</span>
                  </li>
                ))}
                {novos.length > 6 && <li className="text-xs text-slate-400 px-3">e mais {novos.length - 6}</li>}
              </ul>
            </section>
          )}

          {renovar.length > 0 && (
            <section>
              <p className="flex items-center gap-2 text-sm font-black text-navy">
                <RefreshCw size={16} className="text-gold-dark" />
                {renovar.length === 1 ? '1 renovação para fazer' : `${renovar.length} renovações para fazer`}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">A imobiliária confirmou que vai renovar. Emita a renovação e atualize a vigência no cadastro.</p>
              <ul className="space-y-1.5">
                {renovar.slice(0, 6).map(l => {
                  const dias = diasAte(String(l.vigencia_fim));
                  return (
                    <li key={l.id} className="flex justify-between gap-3 text-sm bg-slate-50 rounded-xl px-3 py-2">
                      <span className="font-bold text-slate-700 truncate">{l.inquilino_nome}</span>
                      <span className={`text-xs shrink-0 font-bold ${dias < 0 ? 'text-rose-600' : 'text-amber-700'}`}>
                        {dias < 0 ? `venceu em ${fmtData(String(l.vigencia_fim))}` : `vence em ${fmtData(String(l.vigencia_fim))}`}
                      </span>
                    </li>
                  );
                })}
                {renovar.length > 6 && <li className="text-xs text-slate-400 px-3">e mais {renovar.length - 6}</li>}
              </ul>
            </section>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2">
          <button onClick={() => { fechar(); onAbrirRepasse(); }} className="flex-1 py-2.5 bg-navy hover:bg-navy-light text-white rounded-xl font-bold text-sm transition-colors">Abrir Repasse</button>
          <button onClick={fechar} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-colors">Ver depois</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AvisoEntrada;
