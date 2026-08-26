import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Estados possíveis do salvamento automático.
 *
 * 'ocioso'   — nada a fazer, o que está na tela é igual ao que está no banco
 * 'pendente' — o usuário mexeu em algo e o salvamento está agendado
 * 'salvando' — requisição em andamento
 * 'salvo'    — gravou com sucesso (some sozinho depois de alguns segundos)
 * 'erro'     — a gravação falhou; o hook tenta de novo sozinho
 */
export type EstadoSalvamento = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro';

export interface OpcoesAutoSave<T> {
  /** Objeto do formulário. Qualquer mudança nele é detectada automaticamente. */
  dados: T;
  /**
   * Só salva quando `true`. Normalmente é `!!editingId` — ou seja, o registro
   * já existe no banco e pode receber UPDATE.
   */
  ativo: boolean;
  /** Função que efetivamente grava. Deve lançar erro se falhar. */
  salvar: (dados: T) => Promise<void>;
  /**
   * Identidade do registro em edição (normalmente o `id`). Quando muda, o hook
   * entende que trocou de registro e recalibra a referência — assim abrir outro
   * cadastro não dispara um salvamento fantasma.
   */
  identidade?: string | number | null;
  /** Tempo de espera após a última tecla, em ms. Padrão: 1200. */
  atraso?: number;
  /**
   * Se informado, guarda rascunho no navegador enquanto `ativo` for `false`
   * (cadastro novo, ainda sem id). Nada é enviado ao banco.
   */
  chaveRascunho?: string;
  /**
   * Campos que NÃO devem entrar na comparação nem no rascunho — arquivos,
   * campos auxiliares de UI, etc.
   */
  ignorar?: string[];
}

export interface RetornoAutoSave<T> {
  estado: EstadoSalvamento;
  /** Grava imediatamente, sem esperar o debounce. */
  salvarAgora: () => Promise<void>;
  /**
   * Diz ao hook que o que está na tela já está no banco. Chame após um
   * salvamento manual, para o autosave não regravar a mesma coisa.
   */
  sincronizar: (dados?: T) => void;
  /** Rascunho encontrado no navegador ao montar o componente, se houver. */
  rascunho: T | null;
  /** Apaga o rascunho do navegador. */
  descartarRascunho: () => void;
}

const PREFIXO_RASCUNHO = 'fg-rascunho:';

function normalizar<T>(dados: T, ignorar?: string[]): string {
  if (!ignorar || ignorar.length === 0) return JSON.stringify(dados ?? null);
  const copia: Record<string, unknown> = { ...(dados as Record<string, unknown>) };
  for (const campo of ignorar) delete copia[campo];
  return JSON.stringify(copia);
}

/**
 * Salvamento automático padrão do hub.
 *
 * Diferença importante em relação à versão antiga espalhada pelos componentes:
 * aqui não existe flag manual de "formulário sujo". O hook compara o conteúdo
 * atual com o último conteúdo confirmado no banco. Por isso qualquer campo
 * conta — inclusive os que gravam direto no estado sem passar pelo
 * `handleInputChange` (CNPJ, telefone, vigência...), que antes eram salvos só
 * por acaso, quando outro campo disparava o salvamento junto.
 */
export function useAutoSave<T>({
  dados,
  ativo,
  salvar,
  identidade = null,
  atraso = 1200,
  chaveRascunho,
  ignorar,
}: OpcoesAutoSave<T>): RetornoAutoSave<T> {
  const [estado, setEstado] = useState<EstadoSalvamento>('ocioso');
  const [rascunho, setRascunho] = useState<T | null>(null);

  // Última versão que sabemos estar gravada no banco, serializada.
  const referenciaRef = useRef<string | null>(null);
  const dadosRef = useRef(dados);
  const salvarRef = useRef(salvar);
  const ativoRef = useRef(ativo);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const timerOciosoRef = useRef<ReturnType<typeof setTimeout>>();
  const salvandoRef = useRef(false);
  const montadoRef = useRef(true);

  dadosRef.current = dados;
  salvarRef.current = salvar;
  ativoRef.current = ativo;

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // Lê o rascunho guardado no navegador uma única vez, ao montar.
  useEffect(() => {
    if (!chaveRascunho) return;
    try {
      const bruto = localStorage.getItem(PREFIXO_RASCUNHO + chaveRascunho);
      if (bruto) setRascunho(JSON.parse(bruto) as T);
    } catch {
      // Rascunho corrompido não pode quebrar a tela: simplesmente ignora.
    }
  }, [chaveRascunho]);

  const descartarRascunho = useCallback(() => {
    if (!chaveRascunho) return;
    try {
      localStorage.removeItem(PREFIXO_RASCUNHO + chaveRascunho);
    } catch {
      /* armazenamento indisponível (aba anônima, cota cheia) — segue sem rascunho */
    }
    setRascunho(null);
  }, [chaveRascunho]);

  const sincronizar = useCallback(
    (valor?: T) => {
      clearTimeout(timerRef.current);
      referenciaRef.current = normalizar(valor ?? dadosRef.current, ignorar);
      setEstado('ocioso');
    },
    [ignorar],
  );

  // Trocou de registro (ou saiu do modo de edição): a referência passa a ser o
  // conteúdo atual, para não gravar por engano o que acabou de ser carregado.
  useEffect(() => {
    clearTimeout(timerRef.current);
    referenciaRef.current = ativo ? normalizar(dadosRef.current, ignorar) : null;
    setEstado('ocioso');
    // `dados` de propósito fora das dependências: só recalibramos ao trocar de
    // registro, não a cada tecla digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identidade, ativo]);

  const executarSalvamento = useCallback(async () => {
    if (!ativoRef.current || salvandoRef.current) return;
    const instantaneo = normalizar(dadosRef.current, ignorar);
    if (instantaneo === referenciaRef.current) return;

    salvandoRef.current = true;
    setEstado('salvando');
    try {
      await salvarRef.current(dadosRef.current);
      referenciaRef.current = instantaneo;
      if (!montadoRef.current) return;
      setEstado('salvo');
      clearTimeout(timerOciosoRef.current);
      timerOciosoRef.current = setTimeout(() => {
        if (montadoRef.current) setEstado('ocioso');
      }, 2600);
    } catch (erro) {
      console.error('Falha no salvamento automático:', erro);
      if (montadoRef.current) setEstado('erro');
    } finally {
      salvandoRef.current = false;
    }
  }, [ignorar]);

  const salvarAgora = useCallback(async () => {
    clearTimeout(timerRef.current);
    await executarSalvamento();
  }, [executarSalvamento]);

  // Agenda o salvamento a cada mudança de conteúdo.
  useEffect(() => {
    const atual = normalizar(dados, ignorar);

    // Cadastro novo: guarda rascunho no navegador, sem tocar no banco.
    if (!ativo) {
      if (chaveRascunho) {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          try {
            localStorage.setItem(PREFIXO_RASCUNHO + chaveRascunho, atual);
          } catch {
            /* sem espaço ou sem permissão — o formulário continua funcionando */
          }
        }, atraso);
        return () => clearTimeout(timerRef.current);
      }
      return;
    }

    if (referenciaRef.current === null || atual === referenciaRef.current) return;

    setEstado((anterior) => (anterior === 'salvando' ? anterior : 'pendente'));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void executarSalvamento();
    }, atraso);
    return () => clearTimeout(timerRef.current);
  }, [dados, ativo, atraso, chaveRascunho, executarSalvamento, ignorar]);

  // Rede de segurança: ao trocar de aba, minimizar ou fechar, grava na hora em
  // vez de esperar o debounce.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState === 'hidden') void salvarAgora();
    };
    const aoSair = (evento: BeforeUnloadEvent) => {
      if (!ativoRef.current) return;
      const pendente = normalizar(dadosRef.current, ignorar) !== referenciaRef.current;
      if (pendente && referenciaRef.current !== null) {
        evento.preventDefault();
        evento.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', aoEsconder);
    window.addEventListener('beforeunload', aoSair);
    return () => {
      document.removeEventListener('visibilitychange', aoEsconder);
      window.removeEventListener('beforeunload', aoSair);
    };
  }, [salvarAgora, ignorar]);

  // Tenta de novo sozinho quando falhou, para não deixar trabalho perdido.
  useEffect(() => {
    if (estado !== 'erro') return;
    const tentativa = setTimeout(() => {
      void executarSalvamento();
    }, 8000);
    return () => clearTimeout(tentativa);
  }, [estado, executarSalvamento]);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      clearTimeout(timerOciosoRef.current);
    },
    [],
  );

  return { estado, salvarAgora, sincronizar, rascunho, descartarRascunho };
}
