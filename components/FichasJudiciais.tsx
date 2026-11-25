import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Printer, Search, Link2, FolderOpen, X, Paperclip, Save, Mail, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase.ts';
import { useToast } from './Toast.tsx';
import {
  imprimirFicha, brl, dataBr, fmtCnpj, fmtDoc, fmtCep, fmtTelefone,
  ROTULO_CAUCAO, ROTULO_EXITO, ROTULO_PAPEL, ROTULO_CATEGORIA,
  type FichaJudicial, type StatusFicha, type AnexoFicha,
} from '../lib/fichaJudicial/template.ts';

// Fichas Judiciais (menu Cotações): o que os clientes enviam pelo formulário
// público judicial.fegsegurogarantia.com (Edge Function ficha-judicial,
// migrações 144 e 145). A equipe lê, muda o status, anota e gera a ficha em PDF
// com a marca da F&G, sem nome de seguradora. Ninguém apaga por aqui: ficha
// indevida vira "Descartada".

const BUCKET = 'fichas-judiciais';
const LINK_FORMULARIO = 'https://judicial.fegsegurogarantia.com';

const STATUS_ROTULO: Record<StatusFicha, string> = {
  recebida: 'Recebida', em_analise: 'Em análise', cotada: 'Cotada', emitida: 'Emitida', cancelada: 'Cancelada', descartada: 'Descartada',
};
// Semântica de cor do HUB: blue informação, amber atenção, emerald sucesso, rose encerrado sem negócio.
const STATUS_COR: Record<StatusFicha, string> = {
  recebida: 'bg-amber-50 text-amber-700 border-amber-200',
  em_analise: 'bg-blue-50 text-blue-700 border-blue-200',
  cotada: 'bg-blue-50 text-blue-700 border-blue-200',
  emitida: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelada: 'bg-rose-50 text-rose-700 border-rose-200',
  descartada: 'bg-slate-100 text-slate-600 border-slate-200',
};
const STATUS_ORDEM = Object.keys(STATUS_ROTULO) as StatusFicha[];
type Filtro = 'abertas' | 'todas' | StatusFicha;

const tamanho = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

const Linha: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div className="min-w-0">
    <dt className="text-xs text-slate-500 font-semibold">{rotulo}</dt>
    <dd className="text-sm text-navy font-medium whitespace-pre-line break-words">{children}</dd>
  </div>
);

const Bloco: React.FC<{ titulo: string; children: React.ReactNode; colunas?: string }> = ({ titulo, children, colunas = 'grid-cols-1 md:grid-cols-2' }) => (
  <section className="border border-linha rounded-xl p-4">
    <h4 className="text-sm font-bold text-navy mb-3">{titulo}</h4>
    <dl className={`grid gap-x-6 gap-y-3 ${colunas}`}>{children}</dl>
  </section>
);

const FichasJudiciais: React.FC = () => {
  const { toast } = useToast();
  const [lista, setLista] = useState<FichaJudicial[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [notas, setNotas] = useState('');
  const [salvandoNotas, setSalvandoNotas] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('fichas_judiciais').select('*').order('created_at', { ascending: false }).limit(500);
    setCarregando(false);
    if (error) { toast('Não foi possível carregar as fichas judiciais.', 'error'); return; }
    setLista((data || []) as FichaJudicial[]);
  };
  useEffect(() => { carregar(); }, []);

  const aberta = useMemo(() => lista.find(f => f.id === abertaId) || null, [lista, abertaId]);
  useEffect(() => { setNotas(aberta?.notas_internas || ''); }, [abertaId]);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    return lista.filter(f => {
      if (filtro === 'abertas' ? (f.status === 'descartada' || f.status === 'cancelada' || f.status === 'emitida') : (filtro !== 'todas' && f.status !== filtro)) return false;
      if (!q) return true;
      return [f.protocolo, f.tomador_razao_social, f.contato_nome, f.reclamante_nome, f.processo_numero].some(t => t.toLowerCase().includes(q))
        || (digitos.length >= 4 && (f.tomador_cnpj.includes(digitos) || f.processo_numero.replace(/\D/g, '').includes(digitos)));
    });
  }, [lista, busca, filtro]);

  const novas = useMemo(() => lista.filter(f => f.status === 'recebida').length, [lista]);

  const mudarStatus = async (f: FichaJudicial, status: StatusFicha) => {
    const anterior = f.status;
    setLista(l => l.map(x => (x.id === f.id ? { ...x, status } : x)));
    const { error } = await supabase.from('fichas_judiciais').update({ status }).eq('id', f.id);
    if (error) {
      setLista(l => l.map(x => (x.id === f.id ? { ...x, status: anterior } : x)));
      toast('Não foi possível mudar o status. Tente de novo.', 'error');
      return;
    }
    toast(`${f.protocolo}: ${STATUS_ROTULO[status]}.`, 'success');
  };

  const salvarNotas = async () => {
    if (!aberta) return;
    setSalvandoNotas(true);
    const valor = notas.trim() || null;
    const { error } = await supabase.from('fichas_judiciais').update({ notas_internas: valor }).eq('id', aberta.id);
    setSalvandoNotas(false);
    if (error) { toast('Não foi possível salvar a anotação.', 'error'); return; }
    setLista(l => l.map(x => (x.id === aberta.id ? { ...x, notas_internas: valor } : x)));
    toast('Anotação salva.', 'success');
  };

  /** Abre o anexo numa aba nova. A aba abre antes do await para o navegador não bloquear. */
  const abrirAnexo = async (a: AnexoFicha) => {
    const aba = window.open('', '_blank');
    setAbrindo(a.path);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 600);
    setAbrindo(null);
    if (error || !data?.signedUrl) {
      aba?.close();
      toast(`Não consegui abrir "${a.nome}": ${error?.message || 'tente de novo.'}`, 'error');
      return;
    }
    if (aba) aba.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(LINK_FORMULARIO);
      toast('Link do formulário copiado. É só colar na conversa com o cliente.', 'success');
    } catch {
      toast(`Copie o link: ${LINK_FORMULARIO}`, 'info');
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-linha rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-black text-navy">Fichas de Garantia Judicial</h3>
          <p className="text-sm text-slate-500">
            O que os clientes enviam pelo formulário de depósito recursal.
            {novas > 0 && <span className="ml-2 font-bold text-amber-700">{novas === 1 ? '1 ficha nova para analisar.' : `${novas} fichas novas para analisar.`}</span>}
          </p>
        </div>
        <button type="button" onClick={copiarLink} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-white text-sm font-bold hover:bg-navy-light">
          <Link2 size={16} aria-hidden="true" /> Copiar link do formulário
        </button>
      </section>

      {aberta && (
        <section className="bg-white border border-linha rounded-2xl p-5 space-y-4" aria-label={`Ficha ${aberta.protocolo}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-gold-dark">{aberta.protocolo} · recebida em {new Date(aberta.created_at).toLocaleDateString('pt-BR')} às {new Date(aberta.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
              <h3 className="text-xl font-black text-navy break-words">{aberta.tomador_razao_social}</h3>
              <div className="text-sm text-slate-600">Garantia a cotar: <strong className="text-navy">{brl(aberta.valor_garantia)}</strong> ({aberta.recurso})</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Status da ficha ${aberta.protocolo}`} value={aberta.status} onChange={e => mudarStatus(aberta, e.target.value as StatusFicha)}
                className={`text-sm font-semibold border rounded-full px-3 py-2 ${STATUS_COR[aberta.status]}`}>
                {STATUS_ORDEM.map(s => <option key={s} value={s}>{STATUS_ROTULO[s]}</option>)}
              </select>
              <button type="button" onClick={() => imprimirFicha(aberta)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-white text-sm font-bold hover:bg-navy-light">
                <Printer size={16} aria-hidden="true" /> Gerar ficha em PDF
              </button>
              <button type="button" onClick={() => setAbertaId(null)} aria-label="Fechar a ficha" title="Fechar" className="p-2.5 rounded-xl text-navy hover:bg-areia"><X size={18} /></button>
            </div>
          </div>

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            <Bloco titulo="Contato">
              <Linha rotulo="Quem preencheu">{aberta.contato_nome} ({ROTULO_PAPEL[aberta.contato_papel]})</Linha>
              <Linha rotulo="E-mail"><a href={`mailto:${aberta.contato_email}`} className="inline-flex items-center gap-1.5 text-navy underline"><Mail size={14} aria-hidden="true" />{aberta.contato_email}</a></Linha>
              <Linha rotulo="Celular"><a href={`tel:+55${aberta.contato_telefone}`} className="inline-flex items-center gap-1.5 text-navy underline"><Phone size={14} aria-hidden="true" />{fmtTelefone(aberta.contato_telefone)}</a></Linha>
              <Linha rotulo="E-mail de confirmação ao cliente">{aberta.email_cliente_em ? 'Enviado' : <span className="text-amber-700 font-bold">Não saiu. Avise o cliente que a ficha chegou.</span>}</Linha>
            </Bloco>
            <Bloco titulo="Empresa (reclamada, tomadora)">
              <Linha rotulo="Razão social">{aberta.tomador_razao_social}</Linha>
              <Linha rotulo="CNPJ">{fmtCnpj(aberta.tomador_cnpj)}</Linha>
              <Linha rotulo="Endereço">{aberta.tomador_endereco}, {aberta.tomador_cidade}/{aberta.tomador_uf}, CEP {fmtCep(aberta.tomador_cep)}</Linha>
            </Bloco>
            <Bloco titulo="Processo">
              <Linha rotulo="Número">{aberta.processo_numero}</Linha>
              <Linha rotulo="Vara">{aberta.processo_juizo}</Linha>
              <Linha rotulo="Valor da causa">{brl(aberta.valor_causa)}</Linha>
              <Linha rotulo="Distribuição">{dataBr(aberta.data_distribuicao)}</Linha>
              <Linha rotulo="Recurso">{aberta.recurso}</Linha>
              <Linha rotulo="Tipo de garantia">{ROTULO_CAUCAO[aberta.tipo_caucao]}</Linha>
            </Bloco>
            <Bloco titulo="Reclamante">
              <Linha rotulo="Nome">{aberta.reclamante_nome}</Linha>
              <Linha rotulo="CPF ou CNPJ">{fmtDoc(aberta.reclamante_documento)}</Linha>
              <Linha rotulo="Endereço">{aberta.reclamante_endereco || 'Não informado'}</Linha>
            </Bloco>
            <Bloco titulo="Parecer do advogado" colunas="grid-cols-1">
              <Linha rotulo="Objeto do processo">{aberta.objeto}</Linha>
              <Linha rotulo="Histórico">{aberta.historico}</Linha>
              <Linha rotulo="Linha de defesa">{aberta.linha_defesa}</Linha>
              <Linha rotulo="Probabilidade de êxito">{ROTULO_EXITO[aberta.probabilidade_exito]}</Linha>
              <Linha rotulo="Advogado">{aberta.advogado_nome}, OAB {aberta.advogado_oab_uf} {aberta.advogado_oab}</Linha>
            </Bloco>
            <Bloco titulo="Valor">
              <Linha rotulo="Valor informado">{brl(aberta.valor_base)}</Linha>
              <Linha rotulo="Com acréscimo de 30%"><strong>{brl(aberta.valor_garantia)}</strong></Linha>
              <Linha rotulo="Data base">{dataBr(aberta.data_base)}</Linha>
              <Linha rotulo="Índice de reajuste">{aberta.indice_reajuste}</Linha>
              <Linha rotulo="Segurado">{aberta.segurado || <span className="text-amber-700 font-bold">A confirmar</span>}</Linha>
              <Linha rotulo="Objetivo da garantia">{aberta.objetivo}</Linha>
              {aberta.observacoes && <Linha rotulo="Observações do cliente">{aberta.observacoes}</Linha>}
            </Bloco>
          </div>

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            <section className="border border-linha rounded-xl p-4">
              <h4 className="text-sm font-bold text-navy mb-3">Documentos</h4>
              {aberta.anexos.length === 0 ? <p className="text-sm text-slate-500">Nenhum documento anexado.</p> : (
                <ul className="space-y-2">
                  {aberta.anexos.map(a => (
                    <li key={a.path}>
                      <button type="button" onClick={() => abrirAnexo(a)} disabled={abrindo === a.path}
                        className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border border-linha hover:bg-areia-clara disabled:opacity-60">
                        <Paperclip size={16} className="text-gold-dark shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-navy truncate">{ROTULO_CATEGORIA[a.categoria]}</span>
                          <span className="block text-xs text-slate-500 truncate">{a.nome} ({tamanho(a.tamanho)})</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="border border-linha rounded-xl p-4">
              <label htmlFor="fj-notas" className="block text-sm font-bold text-navy mb-1">Anotações internas</label>
              <p className="text-xs text-slate-500 mb-2">Só a equipe vê. O cliente não recebe este texto.</p>
              <textarea id="fj-notas" value={notas} onChange={e => setNotas(e.target.value)} rows={4}
                className="w-full border border-linha rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold" />
              <button type="button" onClick={salvarNotas} disabled={salvandoNotas || notas.trim() === (aberta.notas_internas || '')}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-navy text-navy text-sm font-bold hover:bg-areia disabled:opacity-50">
                <Save size={15} aria-hidden="true" /> {salvandoNotas ? 'Salvando...' : 'Salvar anotação'}
              </button>
            </section>
          </div>
        </section>
      )}

      <section className="bg-white border border-linha rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[14rem]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input aria-label="Buscar ficha" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por protocolo, empresa, CNPJ, processo ou reclamante"
              className="w-full border border-linha rounded-lg pl-9 pr-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold" />
          </div>
          <select aria-label="Filtrar por status" value={filtro} onChange={e => setFiltro(e.target.value as Filtro)}
            className="border border-linha rounded-lg px-3 py-2 text-sm font-semibold text-navy">
            <option value="abertas">Em aberto</option>
            <option value="todas">Todas</option>
            {STATUS_ORDEM.map(s => <option key={s} value={s}>{STATUS_ROTULO[s]}</option>)}
          </select>
        </div>

        {carregando ? (
          <p className="text-sm text-slate-500 py-6">Carregando...</p>
        ) : filtrada.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-slate-500 py-6">
            <FileText size={18} aria-hidden="true" />
            {lista.length === 0 ? 'Nenhuma ficha recebida ainda. Copie o link do formulário e envie a quem pedir cotação de garantia judicial.' : 'Nenhuma ficha neste filtro.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead><tr className="text-xs text-slate-500 border-b-2 border-linha text-left">
                <th className="py-2 px-3">Protocolo</th><th className="py-2 px-3">Recebida</th><th className="py-2 px-3">Empresa</th>
                <th className="py-2 px-3">Processo</th><th className="py-2 px-3">Recurso</th><th className="py-2 px-3 text-right">Garantia</th>
                <th className="py-2 px-3">Status</th><th className="py-2 px-3 text-right">Ações</th>
              </tr></thead>
              <tbody>
                {filtrada.map(f => (
                  <tr key={f.id} className={`border-b border-linha ${abertaId === f.id ? 'bg-areia-clara' : ''}`}>
                    <td className="py-2 px-3 font-semibold text-navy whitespace-nowrap">{f.protocolo}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{new Date(f.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2 px-3 min-w-[12rem]"><div className="font-medium text-navy">{f.tomador_razao_social}</div>
                      <div className="text-xs text-slate-500">{fmtCnpj(f.tomador_cnpj)} · {f.contato_nome}</div></td>
                    <td className="py-2 px-3 whitespace-nowrap">{f.processo_numero}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{f.recurso}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-semibold">{brl(f.valor_garantia)}</td>
                    <td className="py-2 px-3">
                      <select aria-label={`Status da ficha ${f.protocolo}`} value={f.status} onChange={e => mudarStatus(f, e.target.value as StatusFicha)}
                        className={`text-xs font-semibold border rounded-full px-2 py-1 ${STATUS_COR[f.status]}`}>
                        {STATUS_ORDEM.map(s => <option key={s} value={s}>{STATUS_ROTULO[s]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" title="Abrir a ficha" aria-label={`Abrir ${f.protocolo}`} onClick={() => { setAbertaId(f.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          className="p-2 rounded-lg text-navy hover:bg-areia"><FolderOpen size={15} /></button>
                        <button type="button" title="Gerar ficha em PDF" aria-label={`Gerar PDF de ${f.protocolo}`} onClick={() => imprimirFicha(f)}
                          className="p-2 rounded-lg text-gold-dark hover:bg-areia"><Printer size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default FichasJudiciais;
