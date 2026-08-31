/**
 * Documentos do cliente dentro do card da Carteira.
 *
 * Para que existe: contrato social, balancetes, DRE e certidões viviam em pasta
 * do computador, e cotar virava caça ao arquivo. Aqui eles ficam ao lado dos
 * seguros contratados e do crédito aprovado, que é onde a consulta acontece.
 *
 * Duas decisões que valem lembrar:
 *
 * 1. A amarração é pelo CNPJ, só com os dígitos. A mesma empresa aparece em
 *    mais de um card quando a razão social foi digitada diferente ("LTDA" e
 *    "LTDA EPP"); anexando uma vez, aparece nos dois. Sem CNPJ, cai no nome.
 *
 * 2. O bucket é privado. O download passa por URL assinada, gerada na hora do
 *    clique e válida por poucos minutos, para o link não vazar balancete de
 *    cliente por aí. É o oposto da tela de Formulários, onde o link é aberto de
 *    propósito porque o arquivo é em branco.
 */
import React, { useState } from 'react';
import { FileText, Plus, Download, Trash2, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface DocumentoCliente {
  id: string;
  cnpj_digitos: string;
  cliente_nome: string;
  tipo: string;
  ano: number | null;
  descricao: string | null;
  arquivo_url: string;   // caminho dentro do bucket, não link público
  arquivo_nome: string | null;
}

export const TIPOS_DOCUMENTO = ['Contrato social', 'Balancete', 'DRE', 'Certidão', 'Procuração', 'Outros'];

/** Só os dígitos: 31.132.978/0001-30 e 31132978000130 viram a mesma chave. */
export const soDigitos = (v?: string | null) => (v || '').replace(/\D/g, '');

/**
 * Documentos que pertencem a este cliente. Casa pelo CNPJ quando existe; sem
 * CNPJ, pelo nome, que é o que sobra para identificá-lo.
 */
export function documentosDoCliente(todos: DocumentoCliente[], nome: string, cnpj?: string | null) {
  const chave = soDigitos(cnpj);
  if (chave) return todos.filter(d => d.cnpj_digitos === chave);
  return todos.filter(d => !d.cnpj_digitos && d.cliente_nome.toLowerCase() === nome.toLowerCase());
}

interface Props {
  nome: string;
  cnpj?: string | null;
  documentos: DocumentoCliente[];
  /** Recarrega a lista no componente pai depois de subir ou apagar. */
  aoMudar: () => void;
}

export default function ClienteDocumentos({ nome, cnpj, documentos, aoMudar }: Props) {
  const [abrindoForm, setAbrindoForm] = useState(false);
  const [tipo, setTipo] = useState(TIPOS_DOCUMENTO[0]);
  const [ano, setAno] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [baixando, setBaixando] = useState<string | null>(null);

  const chave = soDigitos(cnpj);

  const subir = async () => {
    if (!arquivo) return setErro('Escolha o arquivo.');
    setErro('');
    setSalvando(true);
    try {
      const ext = (arquivo.name.split('.').pop() || 'pdf').toLowerCase();
      const pasta = chave || nome.replace(/[^\w]+/g, '-').toLowerCase();
      const caminho = `${pasta}/${Date.now()}_${tipo.replace(/[^\w]+/g, '-').toLowerCase()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('cliente-documentos')
        .upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream', upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('cliente_documentos').insert({
        cnpj_digitos: chave,
        cliente_nome: nome,
        tipo,
        ano: ano.trim() ? parseInt(ano, 10) : null,
        arquivo_url: caminho,
        arquivo_nome: arquivo.name,
      });
      if (insErr) throw insErr;

      setAbrindoForm(false);
      setArquivo(null);
      setAno('');
      aoMudar();
    } catch (e: any) {
      setErro(e.message || 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const baixar = async (d: DocumentoCliente) => {
    setBaixando(d.id);
    const { data, error } = await supabase.storage
      .from('cliente-documentos')
      .createSignedUrl(d.arquivo_url, 300);
    setBaixando(null);
    if (error || !data?.signedUrl) return alert('Não consegui abrir o arquivo.');
    window.open(data.signedUrl, '_blank');
  };

  const excluir = async (d: DocumentoCliente) => {
    if (!confirm(`Excluir ${d.tipo}${d.ano ? ` ${d.ano}` : ''} deste cliente?`)) return;
    await supabase.storage.from('cliente-documentos').remove([d.arquivo_url]);
    await supabase.from('cliente_documentos').delete().eq('id', d.id);
    aoMudar();
  };

  // Mais recente em cima: primeiro por ano, depois pelo tipo.
  const ordenados = [...documentos].sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0) || a.tipo.localeCompare(b.tipo));

  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1 flex justify-between items-center">
        <span>Documentos do Cliente</span>
        <button
          onClick={() => { setErro(''); setAbrindoForm(v => !v); }}
          className="text-gold hover:text-gold-hover transition-colors p-1"
          title="Anexar documento"
        >
          {abrindoForm ? <X size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={3} />}
        </button>
      </p>

      {abrindoForm && (
        <div className="mb-2 p-2.5 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
          <div className="flex gap-2">
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value)}
              className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold outline-none focus:border-gold"
            >
              {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={ano}
              onChange={e => setAno(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Ano"
              className="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] outline-none focus:border-gold"
            />
          </div>
          <input
            type="file"
            onChange={e => setArquivo(e.target.files?.[0] ?? null)}
            className="w-full text-[10px] text-slate-600 file:mr-2 file:px-3 file:py-1.5 file:rounded-xl file:border-0 file:bg-navy file:text-gold file:font-bold file:text-[10px] file:cursor-pointer"
          />
          {erro && <p className="text-[10px] font-bold text-rose-600">{erro}</p>}
          <button
            onClick={subir}
            disabled={salvando}
            className="w-full flex items-center justify-center gap-1.5 text-[10px] font-bold text-white bg-gold hover:bg-gold-hover py-2 rounded-xl transition-all disabled:opacity-50"
          >
            {salvando ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} strokeWidth={3} />}
            {salvando ? 'ENVIANDO...' : 'ANEXAR'}
          </button>
        </div>
      )}

      {ordenados.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Nenhum documento anexado.</p>
      ) : (
        <div className="space-y-1.5">
          {ordenados.map(d => (
            <div key={d.id} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-xl">
              <FileText size={13} className="text-gold shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-slate-700 uppercase truncate">
                  {d.tipo}{d.ano ? ` · ${d.ano}` : ''}
                </p>
                {d.arquivo_nome && <p className="text-[10px] text-slate-400 truncate">{d.arquivo_nome}</p>}
              </div>
              <button
                onClick={() => baixar(d)}
                disabled={baixando === d.id}
                className="text-slate-400 hover:text-gold transition-colors p-1"
                title="Baixar"
              >
                {baixando === d.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              </button>
              <button
                onClick={() => excluir(d)}
                className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                title="Excluir"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
