import { supabase } from './supabase';

/**
 * Controle de acesso do hub.
 *
 * A permissão é por MÓDULO, não por tela. São ~30 views mas só 10 módulos, e
 * eles batem exatamente com os grupos do menu lateral — é assim que a decisão
 * é tomada na prática ("fulano não precisa ver o WhatsApp"), não tela a tela.
 *
 * ATENÇÃO ao escopo disto: controla o que a interface mostra, não o que o
 * banco entrega. Esconder o menu impede que um colega navegue até a tela; não
 * impede quem sabe usar a anon key de consultar a tabela direto. Blindagem de
 * verdade dos dados depende de RLS em cada tabela, que é outro trabalho.
 */

export const ADMIN_EMAIL = 'fabio@fegsegurogarantia.com.br';

export interface Modulo {
  key: string;
  label: string;
  /** Views que o módulo libera. Mantido como string para não acoplar ao type View do App. */
  views: string[];
}

export const MODULOS: Modulo[] = [
  { key: 'garantia', label: 'Seguro Garantia', views: ['goals', 'directory', 'banks', 'letter', 'calculator', 'endosso-allseg', 'formularios', 'carteira', 'posvenda', 'prospeccao', 'prospeccao-email', 'email-trilhas', 'pncp-prospeccao', 'pncp-auto', 'garimpo', 'pnpc', 'seg-licitante', 'seg-contrato'] },
  { key: 'auto', label: 'Seguro AUTO', views: ['auto', 'auto-seguradoras'] },
  { key: 'residencial', label: 'Residencial / Locatícia', views: ['residential', 'residencial-seguradoras', 'residencial-garantidoras', 'imobiliaria-repasse', 'garantia-locaticia', 'inadimplentes'] },
  { key: 'rc', label: 'Responsabilidade Civil', views: ['rc', 'rc-seguradoras'] },
  { key: 'financeiro', label: 'Gestão Financeira', views: ['meta-comissao', 'metas-mensais', 'metas-anuais'] },
  { key: 'whatsapp', label: 'WhatsApp', views: ['whatsapp', 'whatsapp-blast'] },
  { key: 'email-followup', label: 'Follow-up de E-mail', views: ['email-followup'] },
  { key: 'parceiros', label: 'Parceiros', views: ['parceiros'] },
  { key: 'agenda', label: 'Agenda', views: ['agenda'] },
  { key: 'manual', label: 'Manual de Procedimentos', views: ['manual'] },
];

/**
 * Telas que ninguém perde, independente do que estiver marcado.
 *
 * Sem a Visão Geral o usuário restrito abriria o hub numa tela em branco, sem
 * nem saber que entrou. `sureties` fica junto por não ter item de menu — só é
 * alcançada por dentro de outras telas.
 */
export const VIEWS_LIVRES = ['dashboard', 'sureties'];

/**
 * Lê os módulos liberados para um e-mail.
 *
 * Retorna `null` quando não há restrição — que é o caso do admin e de quem
 * ainda não tem linha na tabela. Isso é deliberado: no dia do deploy ninguém
 * pode perder acesso ao que já usava. Restringir é um ato explícito.
 */
export async function carregarModulos(email: string | undefined): Promise<string[] | null> {
  if (!email) return null;
  if (email === ADMIN_EMAIL) return null;
  const { data, error } = await supabase
    .from('hub_permissoes')
    .select('modulos')
    .eq('user_email', email)
    .maybeSingle();
  // Falha de rede não pode virar bloqueio: quem já trabalhava continua
  // trabalhando, e o admin percebe pelo que não mudou.
  if (error || !data) return null;
  return (data.modulos as string[]) ?? [];
}

/** Conjunto de views que os módulos liberam, já com as telas livres dentro. */
export function viewsDosModulos(modulos: string[]): Set<string> {
  const set = new Set<string>(VIEWS_LIVRES);
  for (const m of MODULOS) {
    if (modulos.includes(m.key)) m.views.forEach(v => set.add(v));
  }
  return set;
}
