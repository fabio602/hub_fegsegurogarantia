import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

/**
 * Caixa "Nova observacao" da ficha do lead (Kanban de prospecção).
 *
 * Fica num componente à parte, com o texto guardado aqui dentro, de
 * propósito: quando o texto morava no estado do ProspectsKanban, cada letra
 * digitada redesenhava o quadro inteiro por trás da ficha (milhares de leads
 * filtrados, ordenados e montados de novo) e a digitação ficava lenta.
 * Agora digitar só redesenha esta caixa.
 *
 * O pai fala com a caixa pela ref: lê o texto pendente (aviso de saída e
 * "Salvar Alterações"), preenche para editar uma nota e limpa. Quem grava
 * no banco continua sendo o pai, em `onSalvar`.
 */

export interface CaixaObservacaoHandle {
    /** Texto e data/hora (formato do input datetime-local) que estão na caixa agora. */
    ler: () => { texto: string; dataHora: string };
    /** Põe uma nota existente na caixa para editar. */
    preencher: (texto: string, dataHora: string) => void;
    /** Esvazia a caixa e volta a data para agora. */
    limpar: () => void;
}

interface Props {
    /** true quando a caixa está editando uma nota do histórico. */
    editando: boolean;
    salvando: boolean;
    aviso: { tipo: 'ok' | 'erro'; texto: string } | null;
    /** Grava a nota; devolve true quando gravou (aí a caixa se esvazia). */
    onSalvar: (texto: string, dataHora: string) => Promise<boolean>;
    onCancelarEdicao: () => void;
}

const agoraLocal = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const CaixaObservacaoLead = forwardRef<CaixaObservacaoHandle, Props>(
    ({ editando, salvando, aviso, onSalvar, onCancelarEdicao }, ref) => {
        const [texto, setTexto] = useState('');
        const [dataHora, setDataHora] = useState(agoraLocal);
        // Espelho do estado para o pai ler sem esperar um novo render.
        const atual = useRef({ texto: '', dataHora });
        atual.current = { texto, dataHora };

        const limpar = () => {
            setTexto('');
            setDataHora(agoraLocal());
        };

        useImperativeHandle(ref, () => ({
            ler: () => atual.current,
            preencher: (t, dh) => { setTexto(t); setDataHora(dh || agoraLocal()); },
            limpar,
        }), []);

        const salvar = async () => {
            if (salvando) return;
            const ok = await onSalvar(texto, dataHora);
            if (ok) limpar();
        };

        return (
            <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-1 space-y-1.5">
                        <label className="text-xs font-bold text-slate-600">Data da observacao</label>
                        <input
                            type="datetime-local"
                            value={dataHora}
                            onChange={(e) => setDataHora(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
                        />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                        <label className="text-xs font-bold text-slate-600">{editando ? 'Editar observacao' : 'Nova observacao'}</label>
                        <textarea
                            value={texto}
                            onChange={(e) => setTexto(e.target.value)}
                            rows={3}
                            placeholder="Digite a observacao..."
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold resize-none"
                        />
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                    {aviso && (
                        <p
                            role="status"
                            className={aviso.tipo === 'ok'
                                ? 'mr-auto text-xs font-bold text-emerald-700 flex items-center gap-1.5'
                                : 'mr-auto text-xs font-bold text-rose-700 flex items-start gap-1.5'}
                        >
                            {aviso.tipo === 'ok'
                                ? <CheckCircle2 size={14} className="shrink-0" />
                                : <AlertCircle size={14} className="shrink-0 mt-px" />}
                            {aviso.texto}
                        </p>
                    )}
                    {editando && (
                        <button
                            type="button"
                            disabled={salvando}
                            onClick={() => { limpar(); onCancelarEdicao(); }}
                            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
                        >
                            Cancelar Edicao
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={salvar}
                        disabled={salvando}
                        className="px-4 py-2 rounded-xl bg-navy text-white font-bold text-sm hover:bg-navy-light disabled:opacity-60 flex items-center gap-2 shrink-0"
                    >
                        {salvando && <Loader2 size={14} className="animate-spin" />}
                        {salvando ? 'Salvando...' : editando ? 'Salvar Nota' : 'Adicionar Nota'}
                    </button>
                </div>
            </>
        );
    },
);

CaixaObservacaoLead.displayName = 'CaixaObservacaoLead';

export default CaixaObservacaoLead;
