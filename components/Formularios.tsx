/**
 * Biblioteca de formulários em branco.
 *
 * Para que existe: os formulários que a corretora manda para o cliente
 * (cadastro, questionário, procuração) viviam espalhados entre pasta do
 * computador, e-mail antigo e conversa de WhatsApp. Na hora de enviar, sempre
 * faltava lembrar onde estava a última versão.
 *
 * Aqui o arquivo mora no storage e a tela entrega as duas coisas que a operação
 * precisa: copiar o link, para colar na conversa que já está aberta, e baixar,
 * para anexar. Quem sobe e apaga é só o admin; todos os outros usuários apenas
 * usam. Essa divisão também está na política do banco, não só na tela.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Search, Copy, Download, Trash2, Loader2, X, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Formulario {
  id: string;
  nome: string;
  descricao: string | null;
  categoria: string;
  arquivo_url: string;
  arquivo_nome: string | null;
  ordem: number;
}

const CATEGORIAS_SUGERIDAS = ['Cadastro', 'Seguro Garantia', 'Sinistro', 'Endosso', 'Geral'];

const inputCls = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold text-slate-800 bg-slate-50';

export default function Formularios() {
  const [lista, setLista] = useState<Formulario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ehAdmin, setEhAdmin] = useState(false);
  const [busca, setBusca] = useState('');
  const [copiado, setCopiado] = useState<string | null>(null);

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nome: '', descricao: '', categoria: 'Geral' });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) =>
      setEhAdmin(data?.user?.email === 'fabio@fegsegurogarantia.com.br'));
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await supabase
      .from('formularios')
      .select('*')
      .order('categoria')
      .order('ordem')
      .order('nome');
    setLista((data as Formulario[]) ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const copiarLink = async (f: Formulario) => {
    await navigator.clipboard.writeText(f.arquivo_url);
    setCopiado(f.id);
    setTimeout(() => setCopiado(null), 2000);
  };

  const salvar = async () => {
    if (!form.nome.trim()) return setErro('Dê um nome ao formulário.');
    if (!arquivo) return setErro('Escolha o arquivo.');
    setErro('');
    setSalvando(true);
    try {
      // O nome do arquivo no storage leva a hora para nunca colidir com outro
      // envio e para a troca de versão não ficar presa em cache do navegador.
      const ext = arquivo.name.split('.').pop() || 'pdf';
      const caminho = `${Date.now()}_${form.nome.trim().replace(/[^\w]+/g, '-').toLowerCase()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('formularios')
        .upload(caminho, arquivo, { contentType: arquivo.type || 'application/pdf', upsert: false });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('formularios').getPublicUrl(caminho);
      const { error: insErr } = await supabase.from('formularios').insert({
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || null,
        categoria: form.categoria.trim() || 'Geral',
        arquivo_url: pub.publicUrl,
        arquivo_nome: arquivo.name,
      });
      if (insErr) throw insErr;

      setModal(false);
      setForm({ nome: '', descricao: '', categoria: 'Geral' });
      setArquivo(null);
      carregar();
    } catch (e: any) {
      setErro(e.message || 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (f: Formulario) => {
    if (!confirm(`Excluir "${f.nome}"? O arquivo sai do hub e o link para de funcionar.`)) return;
    await supabase.from('formularios').delete().eq('id', f.id);
    // O arquivo em si fica no storage. É de propósito: se algum link antigo já
    // foi mandado para um cliente, ele continua abrindo.
    carregar();
  };

  const filtrados = lista.filter(f => {
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return `${f.nome} ${f.descricao || ''} ${f.categoria}`.toLowerCase().includes(t);
  });

  const categorias = [...new Set(filtrados.map(f => f.categoria))];

  return (
    <div className="space-y-4">
      {/* Barra de busca e inclusão */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar formulário"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold bg-white"
          />
        </div>
        {ehAdmin && (
          <button
            onClick={() => { setErro(''); setModal(true); }}
            className="flex items-center gap-2 bg-navy hover:bg-navy-light text-gold px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
          >
            <Plus size={15} /> Novo formulário
          </button>
        )}
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-sm text-slate-400 font-semibold py-10 justify-center">
          <Loader2 size={15} className="animate-spin" /> Carregando...
        </div>
      )}

      {!carregando && filtrados.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
          <FileText size={26} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-bold text-slate-600">
            {lista.length === 0 ? 'Nenhum formulário guardado ainda.' : 'Nada encontrado com esse termo.'}
          </p>
          {lista.length === 0 && ehAdmin && (
            <p className="text-xs text-slate-400 mt-1">Use o botão acima para subir o primeiro.</p>
          )}
        </div>
      )}

      {categorias.map(cat => (
        <div key={cat} className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50/60 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{cat}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {filtrados.filter(f => f.categoria === cat).map(f => (
              <div key={f.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                <FileText size={16} className="text-gold shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{f.nome}</p>
                  {f.descricao && <p className="text-xs text-slate-500 truncate">{f.descricao}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => copiarLink(f)}
                    className={copiado === f.id
                      ? 'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-50 text-emerald-600'
                      : 'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors'}
                  >
                    {copiado === f.id ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                    {copiado === f.id ? 'Copiado' : 'Copiar link'}
                  </button>
                  <a
                    href={f.arquivo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-gold/10 text-gold-dark hover:bg-gold/20 transition-colors"
                  >
                    <Download size={13} /> Baixar
                  </a>
                  {ehAdmin && (
                    <button
                      onClick={() => excluir(f)}
                      className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Inclusão */}
      {modal && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
                <h3 className="font-black text-slate-800 text-lg">Novo formulário</h3>
                <button onClick={() => setModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X size={18} className="text-slate-400" />
                </button>
              </div>

              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Nome</label>
                  <input
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Ex: Ficha cadastral pessoa jurídica"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Descrição</label>
                  <input
                    value={form.descricao}
                    onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    placeholder="Opcional. Quando usar este formulário."
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Categoria</label>
                  <input
                    list="categorias-formulario"
                    value={form.categoria}
                    onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    className={inputCls}
                  />
                  <datalist id="categorias-formulario">
                    {[...new Set([...CATEGORIAS_SUGERIDAS, ...lista.map(f => f.categoria)])].map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Arquivo</label>
                  <input
                    type="file"
                    onChange={e => setArquivo(e.target.files?.[0] ?? null)}
                    className="w-full text-xs text-slate-600 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-navy file:text-gold file:font-bold file:text-xs file:cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">PDF, Word ou Excel. O link fica aberto para quem receber.</p>
                </div>

                {erro && (
                  <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{erro}</p>
                )}
              </div>

              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="flex-1 py-2.5 bg-navy hover:bg-navy-light text-gold rounded-xl font-bold text-sm transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {salvando && <Loader2 size={14} className="animate-spin" />}
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
