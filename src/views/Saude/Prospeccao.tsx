import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, Power, ArrowRightCircle, Mail, Info, Upload, PlayCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import { mascararCnpj } from './funilTipos.ts';
import { lerLista, EXEMPLO_LISTA, type LinhaLida } from './importar.ts';

/**
 * Prospecção da linha de saúde.
 *
 * Três painéis de leitura sobre motores que já existem: a campanha de garimpo
 * (`campanhas_garimpo` + `garimpo_estoque`), a trilha de e-mail
 * (`email_cadencia` + `email_envios`) e a promoção de um item do estoque para
 * lead de saúde. Nada de motor novo aqui.
 */

const SLUG = 'saude-pme';

interface Campanha {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  dry_run: boolean;
  fonte: string;
  trilha: string | null;
  limite_diario: number | null;
  ultimo_tique: string | null;
  cidades: string[] | null;
}

interface ItemEstoque {
  id: string;
  nome: string;
  cidade: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  site: string | null;
  socio: string | null;
  estado: string | null;
  enviado_em: string | null;
}

interface Contato {
  id: string;
  nome_empresa: string;
  email: string;
  nome_contato: string;
  cidade: string | null;
  ativo: boolean;
  data_inicio: string;
  bounce_status: string | null;
}

const Prospeccao: React.FC = () => {
  const { toast, confirm } = useToast();
  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [estoque, setEstoque] = useState<ItemEstoque[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [etapaPorContato, setEtapaPorContato] = useState<Record<string, number>>({});
  const [enviados7d, setEnviados7d] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [promovendo, setPromovendo] = useState<string | null>(null);

  /* Inclusão manual de empresas na trilha. Fica aqui, e não na tela de
     prospecção do Seguro Garantia, porque saúde é outra linha de negócio: o
     Fábio não deveria entrar no módulo do garantia para cadastrar um lead de
     plano de saúde. */
  const [lista, setLista] = useState('');
  const [emEspera, setEmEspera] = useState(true);
  const [incluindo, setIncluindo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);

    const { data: camp } = await supabase
      .from('campanhas_garimpo')
      .select('id, slug, nome, ativo, dry_run, fonte, trilha, limite_diario, ultimo_tique, cidades')
      .eq('slug', SLUG).maybeSingle();
    setCampanha((camp ?? null) as Campanha | null);

    if (camp) {
      const { data: est } = await supabase
        .from('garimpo_estoque')
        .select('id, nome, cidade, cnpj, email, telefone, site, socio, estado, enviado_em')
        .eq('campanha_id', (camp as Campanha).id)
        .order('criado_em', { ascending: false })
        .limit(200);
      setEstoque((est ?? []) as ItemEstoque[]);
    } else {
      setEstoque([]);
    }

    const { data: cts } = await supabase
      .from('email_cadencia')
      .select('id, nome_empresa, nome_contato, email, cidade, ativo, data_inicio, bounce_status')
      .eq('trilha', SLUG)
      .order('data_inicio', { ascending: false });
    const lista = (cts ?? []) as Contato[];
    setContatos(lista);

    if (lista.length) {
      const { data: env } = await supabase
        .from('email_envios')
        .select('contato_id, ordem, enviado_em')
        .in('contato_id', lista.map(c => c.id));
      const etapas: Record<string, number> = {};
      const limite = Date.now() - 7 * 86400000;
      let recentes = 0;
      for (const e of (env ?? [])) {
        const id = (e as any).contato_id as string;
        const ordem = Number((e as any).ordem);
        etapas[id] = Math.max(etapas[id] ?? 0, ordem);
        if (Date.parse((e as any).enviado_em) >= limite) recentes++;
      }
      setEtapaPorContato(etapas);
      setEnviados7d(recentes);
    } else {
      setEtapaPorContato({});
      setEnviados7d(0);
    }

    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const porCidade = useMemo(() => {
    const mapa: Record<string, { total: number; enviados: number }> = {};
    for (const i of estoque) {
      const c = i.cidade ?? 'sem cidade';
      mapa[c] = mapa[c] ?? { total: 0, enviados: 0 };
      mapa[c].total++;
      if (i.enviado_em) mapa[c].enviados++;
    }
    return Object.entries(mapa).sort((a, b) => b[1].total - a[1].total);
  }, [estoque]);

  const alternarAtivo = async () => {
    if (!campanha) return;
    if (!campanha.ativo) {
      const ok = await confirm(
        'Ligar a campanha faz o garimpo buscar empresas e inscrever contatos na trilha. ' +
        'A partir daí o cron das 9h dispara os e-mails sozinho. O site fgsaude.com.br ' +
        'precisa estar no ar, porque os botões da trilha levam para lá. Ligar mesmo assim?'
      );
      if (!ok) return;
    }
    const { error } = await supabase
      .from('campanhas_garimpo').update({ ativo: !campanha.ativo }).eq('id', campanha.id);
    if (error) { toast('Não consegui mudar o estado da campanha', 'error'); return; }
    toast(campanha.ativo ? 'Campanha desligada' : 'Campanha ligada', 'success');
    carregar();
  };

  /**
   * Promove um item do estoque a lead de saúde.
   *
   * Idempotente pelo CNPJ: se já existe lead com aquele CNPJ, não duplica,
   * apenas avisa. O CNPJ é gravado só com dígitos, que é como a tabela guarda.
   */
  const promover = async (item: ItemEstoque) => {
    const digitos = (item.cnpj ?? '').replace(/\D/g, '');
    if (!digitos) { toast('Este registro não tem CNPJ, não dá para promover', 'error'); return; }

    setPromovendo(item.id);
    const { data: existente } = await supabase
      .from('unimed_leads').select('id, empresa, status').eq('cnpj', digitos).maybeSingle();

    if (existente) {
      setPromovendo(null);
      toast(`Já existe lead para este CNPJ: ${(existente as any).empresa} (${(existente as any).status})`, 'info');
      return;
    }

    const { error } = await supabase.from('unimed_leads').insert({
      empresa: item.nome,
      cnpj: digitos,
      cidade: item.cidade,
      uf: 'SP',
      contato: item.socio,
      email: item.email,
      telefone: item.telefone,
      site: item.site,
      status: 'Novo',
      origem: `Prospecção ${campanha?.nome ?? 'garimpo'}`,
    });
    setPromovendo(null);
    if (error) { toast('Não consegui criar o lead', 'error'); return; }
    toast(`${item.nome} virou lead de saúde`, 'success');
  };

  const leitura = useMemo(() => lerLista(lista), [lista]);

  const emailsJaNaTrilha = useMemo(
    () => new Set(contatos.map(c => c.email).filter(Boolean)),
    [contatos],
  );

  const novos = useMemo(
    () => leitura.validas.filter(l => !emailsJaNaTrilha.has(l.email)),
    [leitura, emailsJaNaTrilha],
  );
  const repetidos = leitura.validas.length - novos.length;

  const lerArquivo = (arquivo: File) => {
    const leitor = new FileReader();
    leitor.onload = () => setLista(String(leitor.result ?? ''));
    leitor.onerror = () => toast('Não consegui ler o arquivo', 'error');
    leitor.readAsText(arquivo);
  };

  const incluir = async () => {
    if (!novos.length) return;
    if (!emEspera) {
      const ok = await confirm(
        `${novos.length} empresa(s) entram ATIVAS. O cron das 9h começa a mandar a ` +
        'sequência amanhã, sem passar por você. Confirma?'
      );
      if (!ok) return;
    }
    setIncluindo(true);
    const hoje = new Date().toISOString().split('T')[0];
    const linhas = novos.map((l: LinhaLida) => ({
      nome_contato: l.nome_contato,
      nome_empresa: l.nome_empresa,
      email: l.email,
      cidade: l.cidade,
      origem: 'saude_manual',
      trilha: SLUG,
      data_inicio: hoje,
      ativo: !emEspera,
    }));
    let gravadas = 0;
    for (let i = 0; i < linhas.length; i += 50) {
      const { error } = await supabase.from('email_cadencia').insert(linhas.slice(i, i + 50));
      if (error) {
        toast(`Parei em ${gravadas} incluída(s): ${error.message}`, 'error');
        break;
      }
      gravadas += linhas.slice(i, i + 50).length;
    }
    setIncluindo(false);
    if (gravadas) {
      toast(`${gravadas} empresa(s) incluída(s)${emEspera ? ' em espera' : ''}`, 'success');
      setLista('');
      carregar();
    }
  };

  const ativarEmEspera = async () => {
    const espera = contatos.filter(c => !c.ativo);
    if (!espera.length) return;
    const ok = await confirm(
      `Ativar ${espera.length} contato(s) faz a sequência de saúde começar a sair no ` +
      'cron das 9h. O site fgsaude.com.br precisa estar no ar e o patch da cadência ' +
      'aplicado. Ativar?'
    );
    if (!ok) return;
    const { error } = await supabase
      .from('email_cadencia').update({ ativo: true }).in('id', espera.map(c => c.id));
    if (error) { toast('Não consegui ativar', 'error'); return; }
    toast(`${espera.length} contato(s) ativados`, 'success');
    carregar();
  };

  if (carregando) return <p className="text-navy/50 text-sm p-2">Carregando...</p>;

  if (!campanha) {
    return (
      <div className="border border-linha rounded-xl p-8 text-center">
        <p className="text-navy font-semibold">Campanha de saúde não encontrada.</p>
        <p className="text-navy/60 text-sm mt-1">
          Aplique a migração <code>092_campanha_saude_pme.sql</code>.
        </p>
      </div>
    );
  }

  const ativos = contatos.filter(c => c.ativo).length;

  return (
    <div className="space-y-6">

      <div className="flex justify-end">
        <button onClick={carregar}
          className="flex items-center gap-2 border border-linha px-3 py-1.5 rounded-lg text-navy/70 hover:bg-areia transition-colors text-sm">
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {/* 1. Campanha */}
      <section className="bg-white border border-linha rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-navy">{campanha.nome}</h2>
            <p className="text-xs text-navy/60 mt-0.5">
              Fonte {campanha.fonte} · trilha {campanha.trilha} · até {campanha.limite_diario} por dia
            </p>
          </div>
          <button onClick={alternarAtivo}
            className={campanha.ativo
              ? 'flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700 transition-colors'
              : 'flex items-center gap-2 border border-linha text-navy px-4 py-2 rounded-lg text-sm hover:bg-areia transition-colors'}>
            <Power size={15} /> {campanha.ativo ? 'Ligada' : 'Desligada'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">Modo</p>
            <p className="font-semibold text-navy">{campanha.dry_run ? 'Ensaio' : 'Valendo'}</p>
          </div>
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">Último tique</p>
            <p className="font-semibold text-navy">
              {campanha.ultimo_tique
                ? new Date(campanha.ultimo_tique).toLocaleDateString('pt-BR')
                : 'nunca rodou'}
            </p>
          </div>
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">No estoque</p>
            <p className="font-semibold text-navy tabular-nums">{estoque.length}</p>
          </div>
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">Já enviados</p>
            <p className="font-semibold text-navy tabular-nums">
              {estoque.filter(i => i.enviado_em).length}
            </p>
          </div>
        </div>

        {porCidade.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {porCidade.map(([cidade, n]) => (
              <span key={cidade} className="text-xs border border-linha rounded-full px-3 py-1 text-navy/70">
                {cidade}: <span className="tabular-nums font-semibold text-navy">{n.total}</span>
                {n.enviados > 0 && <span className="text-navy/50"> ({n.enviados} enviados)</span>}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-navy/80 leading-relaxed">
            Ligar esta campanha é começar a mandar e-mail. O cron das 9h dispara todas as
            trilhas ativas, então assim que o garimpo inscrever o primeiro contato a
            sequência de saúde começa a sair sozinha. Confirme antes que o site
            fgsaude.com.br está no ar, porque quatro dos cinco botões da trilha levam
            para lá, e que o patch da cadência foi aplicado, senão os e-mails saem
            assinados como Seguro Garantia.
          </p>
        </div>
      </section>

      {/* 2. Trilha */}
      <section className="bg-white border border-linha rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-gold-dark" />
          <h2 className="font-semibold text-navy">Trilha de e-mail</h2>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">Contatos ativos</p>
            <p className="font-semibold text-navy tabular-nums">{ativos}</p>
          </div>
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">Total inscritos</p>
            <p className="font-semibold text-navy tabular-nums">{contatos.length}</p>
          </div>
          <div className="border border-linha rounded-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-navy/50">E-mails em 7 dias</p>
            <p className="font-semibold text-navy tabular-nums">{enviados7d}</p>
          </div>
        </div>

        {contatos.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-navy/50">
            <Info size={14} /> Nenhum contato inscrito ainda. Eles entram quando a campanha rodar.
          </p>
        )}

        {contatos.slice(0, 20).map(c => (
          <div key={c.id} className="flex items-center justify-between gap-3 border-b border-linha pb-2 last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-navy truncate">{c.nome_empresa}</p>
              <p className="text-[11px] text-navy/50">
                {[c.nome_contato, c.cidade].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-navy/70">
                etapa {etapaPorContato[c.id] ?? 0} de 5
              </p>
              {c.bounce_status && (
                <p className="text-[11px] text-rose-600">{c.bounce_status}</p>
              )}
              {!c.ativo && <p className="text-[11px] text-navy/40">inativo</p>}
            </div>
          </div>
        ))}
      </section>

      {/* 3. Inclusão manual de empresas na trilha */}
      <section className="bg-white border border-linha rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-gold-dark" />
          <h2 className="font-semibold text-navy">Incluir empresas na trilha</h2>
        </div>
        <p className="text-sm text-navy/60">
          Uma empresa por linha, separada por ponto e vírgula, vírgula ou tabulação:
          contato, empresa, e-mail e cidade. O campo com arroba é reconhecido como
          e-mail esteja ele em qualquer posição. A cidade alimenta o assunto do
          e-mail do dia 7, então vale preencher.
        </p>

        <textarea
          rows={5}
          value={lista}
          onChange={e => setLista(e.target.value)}
          placeholder={EXEMPLO_LISTA}
          className="w-full border border-linha rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gold"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-navy/70 border border-linha rounded-lg px-3 py-1.5 cursor-pointer hover:bg-areia transition-colors">
            Carregar de um arquivo
            <input type="file" accept=".csv,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) lerArquivo(f); e.target.value = ''; }} />
          </label>

          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" checked={emEspera} onChange={e => setEmEspera(e.target.checked)} />
            Deixar em espera, sem enviar nada
          </label>
        </div>

        {lista.trim() !== '' && (
          <div className="text-sm border border-linha rounded-lg p-3 space-y-1">
            <p className="text-navy">
              <span className="font-semibold tabular-nums">{novos.length}</span> para incluir
              {repetidos > 0 && <span className="text-navy/60"> · {repetidos} já está na trilha</span>}
              {leitura.ignoradas.length > 0 && (
                <span className="text-amber-700"> · {leitura.ignoradas.length} ignorada(s)</span>
              )}
            </p>
            {leitura.ignoradas.slice(0, 5).map((i, n) => (
              <p key={n} className="text-[11px] text-navy/50 truncate">
                {i.motivo}: {i.linha}
              </p>
            ))}
          </div>
        )}

        <button onClick={incluir} disabled={!novos.length || incluindo}
          className="bg-navy text-white px-4 py-2 rounded-lg text-sm hover:bg-navy-light disabled:opacity-40 transition-colors">
          {incluindo ? 'Incluindo...' : `Incluir ${novos.length || ''} empresa(s)`}
        </button>

        {contatos.some(c => !c.ativo) && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-xs text-navy/80">
              {contatos.filter(c => !c.ativo).length} contato(s) em espera. Nenhum e-mail
              sai enquanto estiverem assim.
            </p>
            <button onClick={ativarEmEspera}
              className="flex items-center gap-1.5 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors">
              <PlayCircle size={13} /> Ativar todos
            </button>
          </div>
        )}
      </section>

      {/* 4. Estoque, com promoção para lead */}
      <section className="bg-white border border-linha rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-navy">Empresas garimpadas</h2>
        {estoque.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-navy/50">
            <Info size={14} /> Estoque vazio. A campanha ainda não rodou.
          </p>
        )}
        {estoque.slice(0, 50).map(i => (
          <div key={i.id} className="flex items-center justify-between gap-3 border-b border-linha pb-2 last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-navy truncate">{i.nome}</p>
              <p className="text-[11px] text-navy/50">
                {[i.cidade, mascararCnpj(i.cnpj) || null, i.email].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={() => promover(i)} disabled={promovendo === i.id || !i.cnpj}
              className="flex items-center gap-1.5 text-xs border border-linha rounded-lg px-2.5 py-1.5 text-navy hover:bg-areia disabled:opacity-40 transition-colors shrink-0">
              <ArrowRightCircle size={13} />
              {promovendo === i.id ? 'Criando...' : 'Virar lead'}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
};

export default Prospeccao;
