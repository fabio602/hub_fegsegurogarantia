import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Link2, Copy, ExternalLink, Loader2, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';

/**
 * Documentos que o cliente mandou pelo site, dentro da ficha do lead.
 *
 * De onde vem cada coisa, e por quê:
 *
 * - a LISTA do que é exigido vem da Edge Function `saude-documentos`, pelo
 *   mesmo GET que a página do cliente usa. A regra de quem precisa de que
 *   (sócio pede vínculo, cônjuge pede certidão, bebê pede teste do pezinho)
 *   mora só lá. Se eu repetisse aqui, um dia as duas iam divergir e o Fábio
 *   veria uma lista diferente da que o cliente viu;
 *
 * - o CAMINHO de cada arquivo vem da tabela `saude_documentos`, porque a Edge
 *   Function não devolve caminho de propósito: o cliente não precisa dele.
 *
 * O bucket é privado. Cada arquivo abre por URL assinada de cinco minutos,
 * nunca por link público.
 */

const FUNCOES = 'https://hfjvwibucplyhsvnwfor.supabase.co/functions/v1';
const BUCKET = 'saude-documentos';

// Base do site. Se o domínio mudar, muda aqui e na secret SAUDE_SITE_URL da
// Edge Function lead-saude, que monta o mesmo link no e-mail do cliente.
const SITE = 'https://fgsaude.com.br';

interface Doc {
  chave: string;
  rotulo: string;
  enviado: boolean;
  arquivo_nome: string | null;
  enviado_em: string | null;
}

interface Bloco {
  id: string;
  nome: string;
  papel: string;
  parentesco: string | null;
  titular_de: string | null;
  nascimento: string | null;
  cpf: string | null;
  email: string | null;
  telefone: string | null;
  documentos: Doc[];
}

interface Envio {
  id: string;
  token: string;
  expira_em: string;
  concluido_em: string | null;
  empresa_razao: string | null;
  empresa_cnpj: string | null;
}

const Documentos: React.FC<{ leadId: string }> = ({ leadId }) => {
  const { toast } = useToast();
  const [envio, setEnvio] = useState<Envio | null>(null);
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [faltando, setFaltando] = useState(0);
  const [caminhos, setCaminhos] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data: e } = await supabase
        .from('saude_envios')
        .select('id, token, expira_em, concluido_em, empresa_razao, empresa_cnpj')
        .eq('lead_id', leadId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!e) { setEnvio(null); setBlocos([]); return; }
      setEnvio(e as Envio);

      const [estado, docs] = await Promise.all([
        fetch(`${FUNCOES}/saude-documentos?t=${encodeURIComponent((e as Envio).token)}`)
          .then(r => r.json())
          .catch(() => null),
        supabase.from('saude_documentos')
          .select('pessoa_id, slot, caminho')
          .eq('envio_id', (e as Envio).id),
      ]);

      if (estado?.ok) {
        setBlocos(estado.blocos as Bloco[]);
        setFaltando(estado.faltando as number);
      }
      const mapa: Record<string, string> = {};
      (docs.data ?? []).forEach((d: any) => { mapa[`${d.pessoa_id}/${d.slot}`] = d.caminho; });
      setCaminhos(mapa);
    } finally {
      setCarregando(false);
    }
  }, [leadId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const link = envio ? `${SITE}/enviar.html?t=${envio.token}` : '';

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado. É pessoal deste cliente, não repasse para outro.', 'success');
    } catch {
      toast('Não consegui copiar. Selecione o link e copie na mão.', 'error');
    }
  };

  const abrirArquivo = async (chave: string) => {
    const caminho = caminhos[chave];
    if (!caminho) return;
    setAbrindo(chave);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300);
      if (error || !data) throw error ?? new Error('sem url');
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch {
      toast('Não consegui abrir o arquivo.', 'error');
    } finally {
      setAbrindo(null);
    }
  };

  const abrirEnvio = async () => {
    setCriando(true);
    try {
      const { error } = await supabase.from('saude_envios').insert({ lead_id: leadId });
      if (error) throw error;
      await carregar();
      toast('Link criado. Copie e mande para o cliente.', 'success');
    } catch {
      toast('Não consegui criar o link.', 'error');
    } finally {
      setCriando(false);
    }
  };

  if (carregando) {
    return (
      <p className="flex items-center gap-2 text-sm text-navy/50">
        <Loader2 size={14} className="animate-spin" /> Carregando os documentos...
      </p>
    );
  }

  if (!envio) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-navy/50">
          Nenhum link de envio aberto para este lead. Quem simula pelo site recebe um
          automaticamente; para quem chegou por outro caminho, crie aqui.
        </p>
        <button
          onClick={abrirEnvio}
          disabled={criando}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-linha text-sm font-medium text-navy hover:bg-areia-clara disabled:opacity-50">
          {criando ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          Abrir link de envio
        </button>
      </div>
    );
  }

  const vencido = new Date(envio.expira_em).getTime() < Date.now();

  return (
    <div className="space-y-3">
      <div className={`rounded-lg px-3 py-2 text-sm ${
        envio.concluido_em && faltando === 0 ? 'bg-emerald-50 text-emerald-800'
        : vencido ? 'bg-rose-50 text-rose-800'
        : faltando > 0 ? 'bg-amber-50 text-amber-800'
        : 'bg-blue-50 text-blue-800'}`}>
        {vencido
          ? 'O link venceu. Crie um novo para o cliente continuar.'
          : envio.concluido_em
            ? (faltando === 0
                ? `O cliente finalizou em ${new Date(envio.concluido_em).toLocaleDateString('pt-BR')} com tudo enviado.`
                : `O cliente finalizou, mas ainda faltam ${faltando} documentos.`)
            : faltando > 0
              ? `Faltam ${faltando} documentos. O cliente ainda não finalizou.`
              : 'Tudo enviado, aguardando o cliente finalizar.'}
      </div>

      {(envio.empresa_razao || envio.empresa_cnpj) && (
        <p className="text-sm text-navy">
          <span className="text-navy/50">Declarado pelo cliente: </span>
          {envio.empresa_razao ?? 'sem razão social'}
          {envio.empresa_cnpj ? ` · ${envio.empresa_cnpj}` : ''}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={copiarLink}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-linha text-xs font-medium text-navy hover:bg-areia-clara">
          <Copy size={13} /> Copiar link do cliente
        </button>
        <span className="text-[11px] text-navy/40">
          vale até {new Date(envio.expira_em).toLocaleDateString('pt-BR')}
        </span>
      </div>

      {blocos.map(b => (
        <div key={b.id} className="border border-linha rounded-lg px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <p className="text-sm font-medium text-navy">{b.nome}</p>
            <p className="text-[11px] text-navy/45">
              {b.papel === 'empresa' ? '' : b.papel}
              {b.parentesco ? ` · ${b.parentesco}` : ''}
              {b.titular_de ? ` de ${b.titular_de}` : ''}
            </p>
          </div>

          {b.papel !== 'empresa' && (b.nascimento || b.cpf || b.email) && (
            <p className="text-[11px] text-navy/50 mb-2">
              {[
                b.nascimento ? new Date(b.nascimento + 'T12:00:00').toLocaleDateString('pt-BR') : null,
                b.cpf, b.email, b.telefone,
              ].filter(Boolean).join(' · ')}
            </p>
          )}

          <div className="space-y-1">
            {b.documentos.map(d => {
              const chave = `${b.id}/${d.chave}`;
              return (
                <div key={d.chave} className="flex items-center justify-between gap-2">
                  <span className={`text-xs ${d.enviado ? 'text-navy' : 'text-navy/40'}`}>
                    {d.enviado && <Check size={12} className="inline mr-1 text-emerald-600" />}
                    {d.rotulo}
                  </span>
                  {d.enviado ? (
                    <button
                      onClick={() => abrirArquivo(chave)}
                      disabled={abrindo === chave || !caminhos[chave]}
                      className="flex items-center gap-1 text-xs text-navy/70 hover:text-navy disabled:opacity-40">
                      {abrindo === chave
                        ? <Loader2 size={12} className="animate-spin" />
                        : <ExternalLink size={12} />}
                      abrir
                    </button>
                  ) : (
                    <span className="text-[11px] text-amber-700">falta</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="flex items-start gap-2 text-[11px] text-navy/45">
        <FileText size={12} className="mt-0.5 shrink-0" />
        Os arquivos ficam num bucket privado e abrem por link assinado de cinco minutos.
        São apagados 90 dias depois de o plano entrar em vigor.
      </p>
    </div>
  );
};

export default Documentos;
