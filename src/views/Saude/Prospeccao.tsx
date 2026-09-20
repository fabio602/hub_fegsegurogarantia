import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, Power, ArrowRightCircle, Mail, Info } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import { mascararCnpj } from './funilTipos.ts';

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
      .select('id, nome_empresa, nome_contato, cidade, ativo, data_inicio, bounce_status')
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

      {/* 3. Estoque, com promoção para lead */}
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
