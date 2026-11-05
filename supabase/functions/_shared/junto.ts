// Cliente da API Guarantee v2 da Junto Seguros (desenvolvedor.juntoseguros.com).
//
// Usado pela Edge Function do portal do parceiro (cotação de Licitante) e pela
// emissão aprovada no HUB. As chaves ficam em Edge Functions → Secrets:
//   JUNTO_BASE_URL       https://ms-gateway.juntoseguros.com/guarantee (produção)
//   JUNTO_CLIENT_ID
//   JUNTO_CLIENT_SECRET
// A chave é a da corretora F&G: toda cotação feita aqui sai no nome da F&G.
//
// O token de acesso dura 30 minutos e fica em cache na instância da função.
// Nenhuma função daqui devolve o token nem o segredo para quem chamou.

export const MODALIDADE_LICITANTE = 99;
export const SUBMODALIDADE_CONVENCIONAL = 1;

/** Erro devolvido pela Junto, com o código numérico quando ela informa (ex.: 1013). */
export class ErroJunto extends Error {
  constructor(
    public status: number,
    public codigo: string | null,
    mensagem: string,
    public bruto = '',
  ) { super(mensagem); }
}

function config() {
  const baseUrl = (Deno.env.get('JUNTO_BASE_URL') ?? '').replace(/\/+$/, '');
  const clientId = Deno.env.get('JUNTO_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('JUNTO_CLIENT_SECRET') ?? '';
  if (!baseUrl || !clientId || !clientSecret) {
    throw new ErroJunto(0, null, 'Integração com a Junto sem configuração (segredos JUNTO_*).');
  }
  return { baseUrl, clientId, clientSecret };
}

let tokenCache: { valor: string; expira: number } | null = null;

async function token(): Promise<string> {
  if (tokenCache && tokenCache.expira > Date.now()) return tokenCache.valor;
  const { baseUrl, clientId, clientSecret } = config();
  const r = await fetch(`${baseUrl}/api/v2/authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
    signal: AbortSignal.timeout(15000),
  });
  const texto = await r.text();
  let corpo: Record<string, unknown> = {};
  try { corpo = JSON.parse(texto); } catch { /* resposta não JSON */ }
  if (!r.ok || typeof corpo.accessToken !== 'string') {
    const e = lerErro(r.status, texto);
    throw new ErroJunto(r.status, e.codigo, `Autenticação na Junto falhou: ${e.mensagem}`, texto.slice(0, 500));
  }
  const segundos = Number(corpo.expiresIn) || 1800;
  // Renova um minuto antes de vencer.
  tokenCache = { valor: corpo.accessToken, expira: Date.now() + Math.max(60, segundos - 60) * 1000 };
  return tokenCache.valor;
}

/**
 * Lê a mensagem e o código do corpo de erro da Junto. O formato varia entre
 * endpoints (message, errors[], detail, title), então procura nos mais comuns
 * e cai no texto puro.
 */
export function lerErro(status: number, texto: string): { codigo: string | null; mensagem: string } {
  let corpo: unknown = null;
  try { corpo = JSON.parse(texto); } catch { /* texto puro */ }

  const msgs: string[] = [];
  let codigo: string | null = null;
  const pega = (v: unknown) => { if (typeof v === 'string' && v.trim()) msgs.push(v.trim()); };
  const pegaCodigo = (v: unknown) => {
    if (codigo) return;
    if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) codigo = String(v);
  };

  // Lista solta no corpo: [{ code, message }]
  if (Array.isArray(corpo)) corpo = { errors: corpo };

  if (corpo && typeof corpo === 'object') {
    const c = corpo as Record<string, unknown>;
    pega(c.message); pega(c.mensagem); pega(c.detail); pega(c.error_description);
    if (typeof c.error === 'string') pega(c.error);
    pegaCodigo(c.code); pegaCodigo(c.codigo); pegaCodigo(c.errorCode);
    const lista = c.errors ?? c.erros ?? c.notifications ?? c.messages;
    if (Array.isArray(lista)) {
      for (const it of lista) {
        if (typeof it === 'string') pega(it);
        else if (it && typeof it === 'object') {
          const o = it as Record<string, unknown>;
          pega(o.message); pega(o.mensagem); pega(o.description); pega(o.value);
          pegaCodigo(o.code); pegaCodigo(o.codigo); pegaCodigo(o.key);
        }
      }
    } else if (lista && typeof lista === 'object') {
      // Formato de validação do ASP.NET: { errors: { Campo: ["mensagem"] } }
      for (const v of Object.values(lista as Record<string, unknown>)) {
        if (Array.isArray(v)) v.forEach(pega); else pega(v);
      }
    }
    if (!msgs.length) pega(c.title);
  } else {
    pega(texto.slice(0, 300));
  }

  const mensagem = [...new Set(msgs)].join(' ') || `HTTP ${status}`;
  if (!codigo) {
    const m = /c[óo]digo\s*:?\s*(\d{3,6})/i.exec(mensagem);
    if (m) codigo = m[1];
  }
  return { codigo, mensagem };
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown, renovou = false): Promise<T> {
  const { baseUrl } = config();
  const r = await fetch(`${baseUrl}${caminho}`, {
    method: metodo,
    headers: {
      'Authorization': `Bearer ${await token()}`,
      'Accept': 'application/json',
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (r.status === 401 && !renovou) {
    tokenCache = null;
    return chamar<T>(metodo, caminho, corpo, true);
  }
  const texto = await r.text();
  if (!r.ok) {
    const e = lerErro(r.status, texto);
    throw new ErroJunto(r.status, e.codigo, e.mensagem, texto.slice(0, 1500));
  }
  if (!texto) return null as T;
  try { return JSON.parse(texto) as T; } catch { return texto as unknown as T; }
}

// ── Tipos (só os campos que usamos) ──────────────────────────────────────────

export interface TomadorJunto {
  federalId?: string;
  name?: string;
  dateExpirationRegistration?: string | null;
  [k: string]: unknown;
}

export interface LimiteModalidade {
  id: number;
  description?: string;
  approvedLimit?: number;
  limitAvailable?: number;
  usedLimit?: number;
  rate?: number;
}

export interface GrupoLimite {
  typeModality?: string;
  approvedLimit?: number;
  limitAvailable?: number;
  usedLimit?: number;
  modalities?: LimiteModalidade[];
}

export interface EnderecoSegurado {
  addressId: number;
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface SeguradoJunto {
  id: number;
  name?: string;
  federalId?: string;
  type?: number;
  typeDescription?: string;
  pending?: boolean;
  address?: EnderecoSegurado[];
}

export interface CotacaoJunto {
  id: number;
  netPremiumValue?: number;
  totalPremiumValue?: number;
  selectedNumberOfInstallments?: number;
  numberOfMaxInstallments?: number;
  installmentOptions?: unknown;
  urlQuote?: string;
  pricing?: {
    standardRate?: number;
    quotationRate?: number;
    comissionValue?: number;
    comissionRate?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface MinutaJunto {
  documentNumber?: number | string;
  draftUrl?: string;
  hasHangs?: boolean;
  policyContacts?: string[];
  [k: string]: unknown;
}

export interface EmissaoJunto {
  id?: number;
  documentNumber?: number | string;
  policyNumber?: string;
  isIssued?: boolean;
  issuedAt?: string;
  issueStatus?: { quoteStatusId?: number; quoteStatusDescription?: string; [k: string]: unknown };
  files?: unknown;
  [k: string]: unknown;
}

export interface DetalheCotacaoJunto extends CotacaoJunto {
  documentNumber?: number | string;
  policyNumber?: string;
  isIssued?: boolean;
  issueStatus?: { quoteStatusId?: number; quoteStatusDescription?: string; [k: string]: unknown };
  billUrl?: string;
  documentUrl?: string;
  draftUrl?: string;
  hasHangs?: boolean;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const tomador = (cnpj: string) =>
  chamar<TomadorJunto>('GET', `/api/v2/policyholders/${cnpj}`);

export const limites = (cnpj: string) =>
  chamar<GrupoLimite[]>('GET', `/api/v2/policyholders/${cnpj}/limits`);

/** Só devolve segurados ativos. Um segurado criado agora fica pendente até a Junto liberar. */
export const segurados = (cnpj: string) =>
  chamar<SeguradoJunto[]>('GET', `/api/v2/insured?federalId=${encodeURIComponent(cnpj)}`);

export interface DadosCotacao {
  tomadorCnpj: string;
  valor: number;
  inicio: string;   // YYYY-MM-DD
  dias: number;
}

function corpoCotacao(p: DadosCotacao) {
  return {
    modalityId: MODALIDADE_LICITANTE,
    subModalityId: SUBMODALIDADE_CONVENCIONAL,
    policyholderFederalId: p.tomadorCnpj,
    insuredAmount: p.valor,
    durationStart: `${p.inicio}T00:00:00`,
    durationDays: p.dias,
  };
}

/** Cria a cotação de Licitante. A cotação é informativa: não emite nem compromete nada. */
export const criarCotacaoLicitante = (p: DadosCotacao) =>
  chamar<CotacaoJunto>('POST', '/api/v2/traditional', corpoCotacao(p));

// Não existe atualizarCotacao de propósito. Teste de 05/11/2026: o PUT
// /api/v2/traditional/{id} sem pricing guarda a taxa efetiva da cotação
// anterior. Uma cotação de R$ 5.000 no prêmio mínimo (R$ 190, taxa efetiva de
// 15,41% a.a.) recotada para R$ 60.000 voltou com prêmio de R$ 3.040, quando a
// cotação nova dá o mínimo. Para mudar valor ou vigência, crie outra cotação.

export const detalheCotacao = (id: number) =>
  chamar<DetalheCotacaoJunto>('GET', `/api/v2/traditional/${id}`);

export interface DadosMinuta {
  seguradoCnpj: string;
  seguradoId: number;
  enderecoId: number;
  edital: string;         // número do edital ou do processo
  contatos: string[];     // e-mails que recebem apólice e boleto
}

/** Gera (ou refaz) a minuta. Obrigatória antes da emissão. Não emite. */
export const gerarMinuta = (id: number, p: DadosMinuta) =>
  chamar<MinutaJunto>('PUT', `/api/v2/traditional/${id}/draft`, {
    insured: { federalId: p.seguradoCnpj, insuredId: p.seguradoId, insuredAddressId: p.enderecoId },
    publicNoticeOrContract: p.edital,
    policyContacts: p.contatos,
    isContractualConditions: false,
    isProposalParticularity: false,
    isForceDraftUrl: true,
  });

/**
 * EMITE a apólice. Irreversível: só a função do HUB chama, depois que alguém
 * da F&G aprova aquele documento. Código 80065 (em processamento) é repetido
 * até 3 vezes com 3 s de intervalo; quem chama confere depois com detalheCotacao.
 */
export async function emitir(id: number, condicoesAdicionais = ''): Promise<EmissaoJunto> {
  let ultimo: unknown = null;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      return await chamar<EmissaoJunto>('POST', `/api/v2/traditional/${id}/issue`, {
        additionalConditions: condicoesAdicionais,
      });
    } catch (e) {
      ultimo = e;
      if (!(e instanceof ErroJunto) || e.codigo !== '80065' || tentativa === 3) throw e;
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
  throw ultimo;
}

// ── Regras de leitura ────────────────────────────────────────────────────────

/** Limite disponível do tomador na modalidade Licitante, ou null se ele não tem a modalidade. */
export function limiteLicitante(grupos: GrupoLimite[] | null): { disponivel: number; taxa: number | null } | null {
  for (const g of grupos || []) {
    const m = (g.modalities || []).find((x) => Number(x.id) === MODALIDADE_LICITANTE);
    if (m) {
      const disponivel = Number(m.limitAvailable ?? g.limitAvailable ?? 0);
      return { disponivel: Number.isFinite(disponivel) ? disponivel : 0, taxa: m.rate ?? null };
    }
  }
  return null;
}

/** Primeiro segurado ativo com endereço. */
export function seguradoAtivo(lista: SeguradoJunto[] | null): { segurado: SeguradoJunto; enderecoId: number } | null {
  for (const s of lista || []) {
    if (s.pending) continue;
    const end = (s.address || []).find((a) => a && a.addressId);
    if (s.id && end) return { segurado: s, enderecoId: end.addressId };
  }
  return null;
}
