import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * Aviso de "saiu versão nova do hub".
 *
 * O problema que isto resolve: o hub é um site estático, então quem deixa a
 * aba aberta a semana inteira continua rodando o JS que baixou na segunda,
 * mesmo depois de vários deploys. Nada avisa a pessoa — e derrubar o login
 * não ajudaria, porque a versão nova chega quando o navegador baixa o bundle
 * novo, não quando alguém reautentica.
 *
 * Como funciona: o build grava o timestamp em dois lugares — dentro do bundle
 * (`__BUILD_TIME__`) e num `/version.json` avulso (ver vite.config.ts). O
 * bundle em execução nunca muda sozinho; o arquivo avulso, sim, a cada
 * deploy. Quando os dois deixam de bater, é porque tem versão nova no ar.
 *
 * Por que aviso e não recarregar sozinho: recarregar sem pedir joga fora o
 * que a pessoa estava digitando. O botão deixa ela escolher a hora.
 */

/** De quanto em quanto tempo perguntar ao servidor. */
const INTERVALO_MS = 5 * 60 * 1000;

export const AvisoNovaVersao: React.FC = () => {
  const [temNova, setTemNova] = useState(false);
  const [dispensada, setDispensada] = useState<string | null>(null);
  const [novaVersao, setNovaVersao] = useState<string | null>(null);
  const [recarregando, setRecarregando] = useState(false);

  const verificar = useCallback(async () => {
    const atual = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null;
    if (!atual) return;
    try {
      // `no-store` + query única: nem o navegador nem nenhum proxy no caminho
      // pode devolver uma cópia velha justo do arquivo que existe para dizer
      // o que é novo. (O service worker deixa este caminho passar direto.)
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const { buildTime } = await r.json();
      if (typeof buildTime === 'string' && buildTime !== atual) {
        setNovaVersao(buildTime);
        setTemNova(true);
      }
    } catch {
      // Sem rede, ou rodando em dev (onde o version.json não existe). Não é
      // erro que interesse a ninguém: tenta de novo no próximo intervalo.
    }
  }, []);

  useEffect(() => {
    verificar();
    const timer = setInterval(verificar, INTERVALO_MS);

    // Voltar para a aba é o momento mais provável de ter perdido um deploy.
    const aoVoltar = () => { if (document.visibilityState === 'visible') verificar(); };
    document.addEventListener('visibilitychange', aoVoltar);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [verificar]);

  const atualizar = async () => {
    setRecarregando(true);
    try {
      // Limpa o cache do service worker antes de recarregar. Sem isso, quem
      // ainda estiver com o SW antigo — que servia o index.html do cache
      // antes da rede — recarregaria para a mesma versão velha e o aviso
      // voltaria em cinco minutos, num laço sem fim.
      if ('caches' in window) {
        const chaves = await caches.keys();
        await Promise.all(chaves.map(k => caches.delete(k)));
      }
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch {
      // Limpar cache é otimização; se falhar, recarrega assim mesmo.
    }
    location.reload();
  };

  if (!temNova || (novaVersao && dispensada === novaVersao)) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[60] max-w-sm animate-fade-in">
      <div className="bg-navy text-white rounded-2xl shadow-2xl border border-gold/30 p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-gold/15 flex items-center justify-center shrink-0">
          <RefreshCw size={18} className="text-gold" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-black">Nova versão do hub disponível</p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Atualize quando terminar o que está fazendo — a página recarrega e você
            não perde nada que já tenha salvo.
          </p>
          <button
            onClick={atualizar}
            disabled={recarregando}
            className="mt-3 inline-flex items-center gap-2 bg-gold hover:bg-[#b58a5c] disabled:opacity-60 text-navy text-xs font-black px-4 py-2 rounded-xl transition-all"
          >
            <RefreshCw size={13} className={recarregando ? 'animate-spin' : ''} />
            {recarregando ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        </div>

        {/* Dispensar esconde só esta versão: no próximo deploy o aviso volta. */}
        <button
          onClick={() => setDispensada(novaVersao)}
          className="text-slate-500 hover:text-white transition-colors shrink-0"
          title="Agora não"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default AvisoNovaVersao;
