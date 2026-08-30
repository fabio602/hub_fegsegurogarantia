import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Aba Carteira (pos-venda).
 * Le public.posvenda_toques + public.sales, grava em public.apolice_contatos.
 * A fila do dia e gerada pelo cron posvenda-toques-daily as 8h.
 */

type Vista = 'foco' | 'lista' | 'revisar';
type Desfecho = 'vai_renovar' | 'nao_renova' | 'sem_retorno' | 'reagendado' | 'encerrada';

const MODALIDADES = ['Licitante', 'Performance', 'Judicial', 'Trabalhista', 'Locatícia', 'Adiantamento'];
const MOTIVOS = ['Contrato encerrado', 'Não venceu a licitação', 'Foi com outro corretor', 'Empresa parou de licitar', 'Outro'];
const ERROS = ['Cadastro duplicado', 'Não é cliente nosso', 'Apólice cancelada'];

const GATILHOS: Record<string, { rot: string; acao: (s: any) => string; perguntar: string }> = {
  entrega: {
    rot: 'Entrega',
    acao: s => `Apólice emitida há 2 dias. Confirmar que ${s.segurado || s.orgaoLicitante || 'o segurado'} recebeu e aceitou.`,
    perguntar: 'A apólice foi aceita sem ressalva? Alguma exigência de cláusula? É melhor descobrir agora do que na sessão.',
  },
  licitacao: {
    rot: 'Resultado da licitação',
    acao: s => `A garantia de proposta ${s.orgaoLicitante ? 'do ' + s.orgaoLicitante : ''} vence hoje. Precisa saber o resultado.`,
    perguntar: 'Saiu o resultado do pregão? Se ganharam, a garantia de execução tem prazo curto. Posso já adiantar a cotação?',
  },
  renovacao: {
    rot: 'Renovação',
    acao: s => `A garantia de execução vence em 30 dias (${fmt(s.vigencia_fim)}). Confirmar se o contrato foi prorrogado.`,
    perguntar: 'O contrato foi prorrogado ou encerra na data? Se prorrogou, preciso do aditivo para o endosso de prazo antes do vencimento.',
  },
  acompanhamento: {
    rot: 'Acompanhamento',
    acao: s => `Checagem trimestral do contrato garantido${s.valorContrato ? ' de ' + s.valorContrato : ''}.`,
    perguntar: 'O contrato segue no valor e no prazo originais? Houve aditivo? Aditivo sem endosso deixa a apólice descasada do contrato.',
  },
  limite: {
    rot: 'Limite',
    acao: () => 'O limite aprovado na seguradora completa um ano. Sem limite válido não dá para emitir em prazo curto.',
    perguntar: 'O balanço já fechou? Com o balanço novo o limite pode subir e a análise sai antes de você precisar.',
  },
  inativo: {
    rot: 'Cliente parado',
    acao: () => 'Sem nenhuma cotação há 60 dias.',
    perguntar: 'Parou de licitar ou está cotando em outro lugar? Se for o segundo, entender o que faltou no nosso atendimento.',
  },
  relacionamento: { rot: 'Relacionamento', acao: () => 'Data de relacionamento.', perguntar: '' },
};

const fmt = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');
const hojeISO = () => new Date().toISOString().slice(0, 10);
const diasDe = (d: string) => Math.round((+new Date(hojeISO()) - +new Date(d)) / 86400000);

export default function Carteira() {
  const [vista, setVista] = useState<Vista>('foco');
  const [toques, setToques] = useState<any[]>([]);
  const [revisar, setRevisar] = useState<any[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [painel, setPainel] = useState<null | 'motivo' | 'erro'>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [hist, setHist] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [feitos, setFeitos] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  const atual = toques[i];

  const notificar = (t: string) => { setAviso(t); setTimeout(() => setAviso(null), 2800); };

  const carregar = useCallback(async () => {
    setCarregando(true);
    // O staff é o usuário logado, vinculado pela coluna unique agenda_staff.email.
    // Sem vínculo, staffId fica null e o contato é registrado sem identificação.
    const { data: auth } = await supabase.auth.getUser();
    const email = auth.user?.email ?? '';
    const [{ data: t }, { data: r }, { data: st }] = await Promise.all([
      supabase.from('posvenda_toques')
        .select('id, gatilho, vence_em, sale_id, sales(*)')
        .eq('status', 'aberto').lte('vence_em', hojeISO())
        .order('vence_em', { ascending: true }),
      supabase.from('vw_posvenda_revisar').select('*').order('dias', { ascending: false }),
      supabase.from('agenda_staff').select('id').eq('email', email).maybeSingle(),
    ]);
    setToques(t || []);
    setRevisar(r || []);
    setStaffId(st?.id ?? null);
    setI(0);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!atual) { setHist([]); return; }
    supabase.from('apolice_contatos')
      .select('created_at, canal, tipo, desfecho, motivo, observacao, agenda_staff(name)')
      .eq('sale_id', atual.sale_id).order('created_at', { ascending: false }).limit(12)
      .then(({ data }) => setHist(data || []));
  }, [atual?.sale_id]);

  async function registrarToque(canal: 'whatsapp' | 'telefone') {
    if (!atual) return;
    await supabase.from('apolice_contatos').insert({
      sale_id: atual.sale_id, toque_id: atual.id, staff_id: staffId, canal, tipo: 'tentativa',
    });
    const s = atual.sales;
    if (canal === 'whatsapp' && s.telefone) {
      window.open(`https://wa.me/55${String(s.telefone).replace(/\D/g, '')}`, '_blank');
    }
    notificar('Contato registrado.');
  }

  async function concluir(desfecho: Desfecho, motivo?: string) {
    if (!atual) return;
    const s = atual.sales;
    await supabase.from('apolice_contatos').insert({
      sale_id: atual.sale_id, toque_id: atual.id, staff_id: staffId,
      canal: 'whatsapp', tipo: 'contato_efetivo', desfecho, motivo: motivo ?? null,
    });
    await supabase.from('posvenda_toques')
      .update({ status: 'concluido', concluido_em: new Date().toISOString(), staff_id: staffId })
      .eq('id', atual.id);

    if (desfecho === 'sem_retorno') {
      await supabase.from('posvenda_toques').insert({
        sale_id: atual.sale_id, gatilho: atual.gatilho,
        vence_em: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
      });
    }
    if (desfecho === 'nao_renova' || desfecho === 'encerrada') {
      await supabase.from('sales')
        .update({ posvenda_status: desfecho === 'encerrada' ? 'encerrada' : 'nao_renova' })
        .eq('id', atual.sale_id);
    }
    if (desfecho === 'vai_renovar' && s.tipo === 'Licitante') {
      notificar('Marcado. Vale abrir a cotação da garantia de execução.');
    }

    setPainel(null);
    setFeitos(f => f + 1);
    setToques(ts => ts.filter(x => x.id !== atual.id));
    setI(0);
  }

  async function salvarCampo(campo: string, valor: string) {
    if (!atual) return;
    const antes = atual.sales[campo];
    if (!valor || valor === antes) { setEditando(null); return; }
    await supabase.from('sales').update({ [campo]: valor }).eq('id', atual.sale_id);
    await supabase.from('apolice_contatos').insert({
      sale_id: atual.sale_id, staff_id: staffId, canal: 'whatsapp', tipo: 'edicao',
      observacao: `Corrigiu ${campo}: ${antes ?? 'vazio'} para ${valor}`,
    });
    setToques(ts => ts.map(t => t.id === atual.id ? { ...t, sales: { ...t.sales, [campo]: valor } } : t));
    setEditando(null);
    notificar('Corrigido. Registrado no histórico.');
  }

  async function salvarRevisao(r: any, tipo: string, ini: string, fim: string) {
    const dias = Math.round((+new Date(fim) - +new Date(ini)) / 86400000);
    if (dias < 0) return notificar('O fim não pode ser antes do início.');
    if (tipo === 'Licitante' && dias > 180) return notificar(`Garantia de proposta com ${dias} dias. Confira na apólice.`);
    await supabase.from('sales').update({ tipo, vigencia_inicio: ini, vigencia_fim: fim }).eq('id', r.id);
    await supabase.from('apolice_contatos').insert({
      sale_id: r.id, staff_id: staffId, canal: 'whatsapp', tipo: 'edicao',
      observacao: `Revisão de cadastro: ${r.tipo} ${fmt(r.vigencia_inicio)} a ${fmt(r.vigencia_fim)} para ${tipo} ${fmt(ini)} a ${fmt(fim)}`,
    });
    setRevisar(rs => rs.filter(x => x.id !== r.id));
    notificar('Corrigido.');
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/input|select|textarea/i.test((e.target as HTMLElement).tagName)) return;
      if (e.key.toLowerCase() === 'l') return setVista(v => (v === 'foco' ? 'lista' : 'foco'));
      if (vista !== 'foco' || !atual || painel) return;
      const m: Record<string, Desfecho> = { '1': 'vai_renovar', '2': 'nao_renova', '3': 'sem_retorno', '4': 'reagendado' };
      if (m[e.key]) { e.preventDefault(); e.key === '2' ? setPainel('motivo') : concluir(m[e.key]); }
      if (e.key.toLowerCase() === 'w') registrarToque('whatsapp');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [vista, atual, painel]);

  if (carregando) return <div className="p-8 text-sm text-navy/50">Carregando a carteira...</div>;

  const atrasados = toques.filter(t => t.vence_em < hojeISO()).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-7 pb-20">
      <header className="flex items-end justify-between gap-6 flex-wrap mb-8">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-6 h-[3px] bg-gold rounded-sm" />
            <span className="text-[10px] font-black tracking-widest uppercase text-navy/60">Carteira</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-navy">
            {toques.length ? 'Fila de hoje' : 'Fila zerada'}
          </h1>
          <p className="mt-2 text-sm text-navy/50">
            {toques.length
              ? <><b className="text-navy font-bold">{toques.length}</b> {toques.length === 1 ? 'contato' : 'contatos'}
                {atrasados > 0 && <> · <b className="text-navy font-bold">{atrasados}</b> atrasados</>}</>
              : 'Os próximos contatos entram amanhã de manhã.'}
          </p>
        </div>
        <div className="inline-flex bg-areia-escura rounded-[10px] p-[3px]">
          {(['foco', 'lista', 'revisar'] as Vista[]).map(v => (
            <button key={v} onClick={() => setVista(v)}
              className={`px-4 py-2.5 rounded-lg text-[11px] font-black tracking-wider uppercase transition
                ${vista === v ? 'bg-white text-navy shadow-sm' : 'text-navy/60'}`}>
              {v === 'revisar' ? <>Revisar {revisar.length > 0 &&
                <span className="ml-1.5 bg-amber-100 text-amber-700 rounded-full px-1.5 text-[10px]">{revisar.length}</span>}</> : v}
            </button>
          ))}
        </div>
      </header>

      {vista === 'foco' && (atual ? (
        <CardFoco t={atual} hist={hist} semStaff={!staffId} editando={editando} setEditando={setEditando}
          onSalvarCampo={salvarCampo} onToque={registrarToque} onDesfecho={d => d === 'nao_renova' ? setPainel('motivo') : concluir(d)}
          painel={painel} setPainel={setPainel} onEscolher={(m: string) =>
            painel === 'erro' ? concluir('encerrada', m) : concluir('nao_renova', m)} />
      ) : <Fim feitos={feitos} />)}

      {vista === 'lista' && (
        <div className="space-y-1.5">
          {toques.map((t, idx) => (
            <button key={t.id} onClick={() => { setI(idx); setVista('foco'); }}
              className="w-full flex items-center gap-4 bg-white rounded-xl px-5 py-4 text-left hover:translate-x-1 transition border border-transparent hover:border-navy/15">
              <span className={`w-[3px] h-8 rounded-sm ${t.vence_em < hojeISO() ? 'bg-amber-600' : 'bg-navy/15'}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-navy truncate">{t.sales?.nome}</span>
                <span className="block text-[13px] text-navy/50 truncate">{GATILHOS[t.gatilho]?.acao(t.sales)}</span>
              </span>
              <span className="text-[10px] font-black tracking-wider uppercase text-navy/40 whitespace-nowrap">
                {GATILHOS[t.gatilho]?.rot}
              </span>
            </button>
          ))}
        </div>
      )}

      {vista === 'revisar' && <Revisar itens={revisar} onSalvar={salvarRevisao} />}

      {aviso && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 bg-navy text-white px-5 py-3 rounded-[10px] text-[13px] font-semibold shadow-xl z-50">
          {aviso}
        </div>
      )}
    </div>
  );
}

function CardFoco({ t, hist, semStaff, editando, setEditando, onSalvarCampo, onToque, onDesfecho, painel, setPainel, onEscolher }: any) {
  const s = t.sales, g = GATILHOS[t.gatilho];
  const atraso = diasDe(t.vence_em);
  const campos = [
    { k: 'decisor', rot: 'Falar com', tipo: 'text' },
    { k: 'tipo', rot: 'Modalidade', tipo: 'select' },
    { k: 'seguradora', rot: 'Seguradora', tipo: 'text' },
    { k: 'segurado', rot: 'Segurado', tipo: 'text' },
    { k: 'vigencia_fim', rot: 'Vigência', tipo: 'date' },
  ];

  return (
    <article className="bg-white rounded-2xl p-9 shadow-[0_12px_32px_rgba(27,38,59,.07)]">
      <div className="flex items-center gap-2 flex-wrap mb-4 text-[10px] font-black tracking-widest uppercase">
        {atraso > 0
          ? <span className="bg-amber-100 text-amber-700 px-2.5 py-1.5 rounded-md">Atrasado há {atraso} {atraso === 1 ? 'dia' : 'dias'}</span>
          : <span className="bg-navy text-white px-2.5 py-1.5 rounded-md">Hoje</span>}
        <span className="bg-areia-escura text-navy/60 px-2.5 py-1.5 rounded-md">{g?.rot}</span>
      </div>

      <h2 className="text-[27px] font-black tracking-tight leading-tight text-navy mb-3">{s.nome}</h2>
      <p className="text-[17px] leading-relaxed text-navy max-w-[60ch]">{g?.acao(s)}</p>

      {g?.perguntar && (
        <div className="mt-5 p-5 bg-areia border-l-[3px] border-gold rounded-r-[10px]">
          <div className="text-[10px] font-black tracking-widest uppercase text-navy/60 mb-2">O que perguntar</div>
          <p className="text-[15px] leading-relaxed text-navy">{g.perguntar}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-7 gap-y-2.5 mt-6 pt-5 border-t border-navy/10">
        {campos.map(c => (
          <div key={c.k} className="group -mx-2 px-2 py-1 rounded-md hover:bg-areia cursor-pointer"
            onClick={() => setEditando(c.k)}>
            <div className="text-[10px] font-black tracking-widest uppercase text-navy/40 mb-1">
              {c.rot}<span className="ml-1.5 opacity-0 group-hover:opacity-100 normal-case tracking-normal font-semibold">editar</span>
            </div>
            {editando === c.k ? (
              c.tipo === 'select' ? (
                <select autoFocus defaultValue={s[c.k] || ''} className="text-[13px] font-semibold border border-navy rounded-md px-2 py-1"
                  onBlur={e => onSalvarCampo(c.k, e.target.value)}>
                  {MODALIDADES.map(m => <option key={m}>{m}</option>)}
                </select>
              ) : (
                <input autoFocus type={c.tipo} defaultValue={s[c.k] || ''}
                  className="text-[13px] font-semibold border border-navy rounded-md px-2 py-1 min-w-[150px]"
                  onBlur={e => onSalvarCampo(c.k, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditando(null); }} />
              )
            ) : (
              <div className="text-[13px] font-semibold text-navy max-w-[34ch]">
                {c.tipo === 'date' ? fmt(s[c.k]) : (s[c.k] || <span className="text-navy/30">não informado</span>)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2.5 mt-6">
        <button onClick={() => onToque('whatsapp')}
          className="inline-flex items-center gap-2 border border-navy/15 rounded-[9px] px-4 py-2.5 text-[13px] font-bold text-navy hover:border-navy transition">
          <span className="w-[7px] h-[7px] rounded-full bg-whatsapp" />
          WhatsApp {s.telefone ? `· ${s.telefone}` : '· sem telefone'}
        </button>
        <button onClick={() => onToque('telefone')}
          className="inline-flex items-center gap-2 border border-navy/15 rounded-[9px] px-4 py-2.5 text-[13px] font-bold text-navy hover:border-navy transition">
          <span className="w-[7px] h-[7px] rounded-full bg-navy/60" />Ligar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-6">
        {([['1', 'Vai renovar', 'vai_renovar', 'emerald'], ['2', 'Não vai renovar', 'nao_renova', 'rose'],
           ['3', 'Sem retorno', 'sem_retorno', ''], ['4', 'Reagendar', 'reagendado', '']] as const).map(([k, rot, d, cor]) => (
          <button key={d} onClick={() => onDesfecho(d)}
            className={`border border-navy/15 rounded-xl p-4 text-left hover:-translate-y-0.5 hover:shadow-md transition
              ${cor === 'emerald' ? 'hover:border-emerald-600' : cor === 'rose' ? 'hover:border-rose-600' : ''}`}>
            <span className={`inline-flex items-center justify-center w-[17px] h-[17px] rounded text-[10px] font-black mb-2
              ${cor === 'emerald' ? 'bg-emerald-100 text-emerald-700' : cor === 'rose' ? 'bg-rose-100 text-rose-700' : 'bg-areia-escura text-navy/60'}`}>{k}</span>
            <span className="block text-[13px] font-bold text-navy leading-tight">{rot}</span>
          </button>
        ))}
      </div>

      {painel && (
        <div className="mt-6 p-5 bg-areia rounded-xl">
          <div className="text-sm font-black text-navy mb-1.5">
            {painel === 'erro' ? 'O que está errado neste registro?' : 'Por que não vai renovar?'}
          </div>
          {painel === 'erro' && <div className="text-[13px] text-navy/50 mb-3.5">Isso tira da fila sem contar como perda de renovação.</div>}
          <div className="flex flex-wrap gap-2">
            {(painel === 'erro' ? ERROS : MOTIVOS).map(m => (
              <button key={m} onClick={() => onEscolher(m)}
                className="border border-navy/15 bg-white rounded-lg px-4 py-2.5 text-[13px] font-semibold text-navy hover:bg-navy hover:text-white transition">
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-5 flex-wrap mt-5 pt-4 border-t border-navy/10">
        <button onClick={() => setPainel('erro')} className="text-xs font-semibold text-navy/50 underline underline-offset-4 hover:text-navy">
          Este registro está errado
        </button>
        {s.apolice_url && (
          <a href={s.apolice_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-navy/50 underline underline-offset-4 hover:text-navy">
            Abrir apólice
          </a>
        )}
      </div>

      <details className="mt-5 pt-4 border-t border-navy/10">
        <summary className="cursor-pointer text-[11px] font-black tracking-widest uppercase text-navy/40 hover:text-navy list-none">
          Histórico deste cliente
        </summary>
        {hist.length ? hist.map((h: any, n: number) => (
          <div key={n} className="flex gap-3.5 py-2.5 text-[13px] border-b border-navy/10 last:border-0">
            <time className="text-navy/40 text-xs tabular-nums whitespace-nowrap">
              {new Date(h.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </time>
            <span className={h.tipo === 'edicao' ? 'text-amber-700' : 'text-navy'}>
              {h.agenda_staff?.name || 'Sistema'} · {h.observacao || `${h.canal}${h.desfecho ? ', ' + h.desfecho.replace('_', ' ') : ', sem retorno'}`}
            </span>
          </div>
        )) : <p className="text-[13px] text-navy/40 py-3">Nenhum contato registrado ainda.</p>}
      </details>

      {semStaff && (
        <p className="mt-4 pt-3 border-t border-navy/10 text-[11px] text-navy/40">
          Seu login não está vinculado a um usuário da equipe. Os contatos serão registrados sem identificação.
        </p>
      )}
    </article>
  );
}

function Revisar({ itens, onSalvar }: any) {
  const [aberto, setAberto] = useState<number | null>(null);
  if (!itens.length) return (
    <div className="bg-white rounded-2xl p-12 text-center">
      <h2 className="text-xl font-black text-navy mb-2">Nenhum cadastro pendente de revisão</h2>
      <p className="text-sm text-navy/50">Novos cadastros suspeitos aparecem aqui automaticamente.</p>
    </div>
  );
  const grupos = [
    { k: 'modalidade', rot: 'Modalidade provavelmente errada', n: 'Prêmio alto demais para garantia de proposta. Parecem ser garantia de execução cadastrada como Licitante.' },
    { k: 'vigencia', rot: 'Vigência provavelmente errada', n: 'Garantia de proposta acima de 180 dias. O prêmio bate com proposta, então o que entrou no campo foi provavelmente a vigência do contrato.' },
  ];
  return (
    <>
      <p className="text-[13px] text-navy/50 mb-6 max-w-[70ch] leading-relaxed">
        Estes registros ficam fora da fila até serem conferidos, para não gerar contato em data errada.
      </p>
      {grupos.map(g => {
        const lista = itens.filter((x: any) => x.suspeita === g.k);
        if (!lista.length) return null;
        return (
          <section key={g.k} className="mb-8">
            <div className="flex items-center gap-3 mb-1.5">
              <h3 className="text-[11px] font-black tracking-widest uppercase text-amber-700">{g.rot}</h3>
              <span className="text-[11px] font-black text-navy/40">{lista.length}</span>
              <span className="flex-1 h-px bg-navy/10" />
            </div>
            <p className="text-[13px] text-navy/50 mb-3.5 max-w-[70ch] leading-relaxed">{g.n}</p>
            {lista.map((r: any) => <LinhaRev key={r.id} r={r} aberto={aberto === r.id}
              onToggle={() => setAberto(aberto === r.id ? null : r.id)} onSalvar={onSalvar} />)}
          </section>
        );
      })}
    </>
  );
}

function LinhaRev({ r, aberto, onToggle, onSalvar }: any) {
  const [tipo, setTipo] = useState(r.tipo);
  const [ini, setIni] = useState(r.vigencia_inicio);
  const [fim, setFim] = useState(r.vigencia_fim);
  return (
    <div className={`bg-white rounded-xl mb-1.5 overflow-hidden border ${aberto ? 'border-navy/15' : 'border-transparent'}`}>
      <div onClick={onToggle} className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-areia">
        <span className="flex-1 min-w-0 text-sm font-bold text-navy truncate">{r.nome}</span>
        <span className="text-xs text-navy/40 tabular-nums whitespace-nowrap hidden sm:block">{r.premio}</span>
        <span className="text-xs font-bold text-amber-700 tabular-nums whitespace-nowrap">{r.dias} dias</span>
      </div>
      {aberto && (
        <div className="px-5 pb-5 pt-1 border-t border-navy/10">
          <div className="flex gap-5 flex-wrap mt-4">
            <label className="flex-1 min-w-[170px]">
              <span className="block text-[10px] font-black tracking-widest uppercase text-navy/40 mb-1.5">Modalidade</span>
              <select value={tipo} onChange={e => setTipo(e.target.value)}
                className="w-full text-sm font-semibold border border-navy/15 rounded-lg px-3 py-2.5">
                {MODALIDADES.map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex-1 min-w-[170px]">
              <span className="block text-[10px] font-black tracking-widest uppercase text-navy/40 mb-1.5">Início</span>
              <input type="date" value={ini || ''} onChange={e => setIni(e.target.value)}
                className="w-full text-sm font-semibold border border-navy/15 rounded-lg px-3 py-2.5" />
            </label>
            <label className="flex-1 min-w-[170px]">
              <span className="block text-[10px] font-black tracking-widest uppercase text-navy/40 mb-1.5">Fim</span>
              <input type="date" value={fim || ''} onChange={e => setFim(e.target.value)}
                className="w-full text-sm font-semibold border border-navy/15 rounded-lg px-3 py-2.5" />
            </label>
          </div>
          <p className="text-xs text-navy/50 mt-3.5 leading-relaxed">
            Confira na apólice antes de salvar. {r.orgao || 'Órgão não informado'} · {r.premio}
            {r.apolice_url && <> · <a href={r.apolice_url} target="_blank" rel="noreferrer" className="text-navy font-semibold underline">abrir apólice</a></>}
          </p>
          <div className="flex gap-2.5 mt-4 flex-wrap">
            <button onClick={() => onSalvar(r, tipo, ini, fim)}
              className="bg-navy text-white rounded-[9px] px-5 py-2.5 text-[13px] font-bold hover:bg-navy-dark transition">
              Salvar correção
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Fim({ feitos }: { feitos: number }) {
  return (
    <div className="bg-white rounded-2xl p-14 text-center shadow-[0_12px_32px_rgba(27,38,59,.07)]">
      <div className="w-11 h-[3px] bg-gold rounded-sm mx-auto mb-6" />
      <h2 className="text-[28px] font-black tracking-tight text-navy mb-2.5">Você falou com todo mundo hoje</h2>
      <p className="text-navy/50 text-[15px]">
        {feitos > 0 ? `${feitos} ${feitos === 1 ? 'contato registrado' : 'contatos registrados'}. ` : ''}
        Os próximos entram automaticamente amanhã de manhã.
      </p>
    </div>
  );
}
