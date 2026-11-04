import React, { useState } from 'react';
import { Paperclip, FileText, Loader2, Handshake } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast.tsx';

/**
 * Demandas que o parceiro envia pelo portal (public/parceiros.html) entram na
 * `sales` como "Em andamento" com o edital ou contrato em `anexos_demanda`
 * (migração 129). Os arquivos ficam no bucket privado parceiro-demandas e só
 * abrem por link assinado, gerado na hora do clique.
 */

export interface AnexoDemanda {
    path: string;
    nome?: string;
    tamanho?: number;
    tipo?: string;
}

const BUCKET = 'parceiro-demandas';

export function anexosDaVenda(sale: unknown): AnexoDemanda[] {
    const lista = (sale as { anexos_demanda?: unknown })?.anexos_demanda;
    return Array.isArray(lista) ? (lista as AnexoDemanda[]).filter((a) => a && typeof a.path === 'string') : [];
}

const tamanhoTexto = (b?: number) => {
    if (!b || b <= 0) return '';
    return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};

/** Abre o anexo numa aba nova. A aba abre antes do await para o navegador não bloquear. */
function useAbrirAnexo() {
    const { toast } = useToast();
    const [abrindo, setAbrindo] = useState<string | null>(null);
    const abrir = async (a: AnexoDemanda) => {
        const aba = window.open('', '_blank');
        setAbrindo(a.path);
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 600);
        setAbrindo(null);
        if (error || !data?.signedUrl) {
            aba?.close();
            toast(`Não consegui abrir "${a.nome || 'o arquivo'}": ${error?.message || 'tente de novo.'}`, 'error');
            return;
        }
        if (aba) aba.location.href = data.signedUrl;
        else window.location.href = data.signedUrl;
    };
    return { abrir, abrindo };
}

function ListaArquivos({ anexos }: { anexos: AnexoDemanda[] }) {
    const { abrir, abrindo } = useAbrirAnexo();
    return (
        <ul className="flex flex-col gap-1.5">
            {anexos.map((a) => (
                <li key={a.path}>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void abrir(a); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-left text-xs font-semibold text-navy hover:border-gold hover:bg-areia-clara transition-colors"
                    >
                        {abrindo === a.path ? <Loader2 size={14} className="animate-spin shrink-0 text-gold-dark" /> : <FileText size={14} className="shrink-0 text-gold-dark" />}
                        <span className="truncate flex-1" title={a.nome}>{a.nome || a.path.split('/').pop()}</span>
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">{tamanhoTexto(a.tamanho)}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Etiqueta na linha do Registro de Vendas: mostra que veio do portal e abre os
 * anexos. A lista abre embaixo da etiqueta, dentro da própria célula, porque a
 * tabela rola na horizontal e um menu flutuante ficaria cortado nas últimas linhas.
 */
export function ChipAnexosParceiro({ sale }: { sale: unknown }) {
    const anexos = anexosDaVenda(sale);
    const [aberto, setAberto] = useState(false);
    if (anexos.length === 0) return null;
    return (
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                onClick={() => setAberto((v) => !v)}
                aria-expanded={aberto}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl border border-gold/40 bg-areia-clara text-[10px] font-bold text-gold-dark hover:border-gold transition-colors"
                title="Demanda enviada pelo portal do parceiro"
            >
                <Paperclip size={11} /> Portal · {anexos.length} {anexos.length === 1 ? 'anexo' : 'anexos'}
            </button>
            {aberto && (
                <div className="mt-1.5 max-w-[260px]">
                    <ListaArquivos anexos={anexos} />
                </div>
            )}
        </div>
    );
}

/** Painel no formulário de edição: dados que o parceiro mandou e os arquivos. */
export function PainelDemandaParceiro({ sale }: { sale: unknown }) {
    const anexos = anexosDaVenda(sale);
    if (anexos.length === 0) return null;
    const s = sale as { parceiro?: string | null; obs?: string | null };
    return (
        <div className="mb-8 p-5 rounded-2xl border border-gold/30 bg-areia-clara">
            <div className="flex items-center gap-2 mb-3">
                <Handshake size={16} className="text-gold-dark" />
                <span className="text-sm font-black text-navy">Demanda enviada pelo portal do parceiro</span>
                {s.parceiro && <span className="text-xs font-semibold text-slate-500">· {s.parceiro}</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {s.obs && (
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{s.obs}</p>
                )}
                <ListaArquivos anexos={anexos} />
            </div>
        </div>
    );
}
