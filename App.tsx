
import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Calculator as CalcIcon,
  FileText,
  Calendar,
  Target,
  ShieldCheck,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  ChevronRight,
  ChevronDown,
  User,
  Loader2,
  Home,
  Landmark,
  Scale,
  Car,
  Users,
  Shield,
  ShieldAlert,
  MessageSquare,
  Mail,
  Search,
  Handshake,
  Radar,
  HeartPulse,
  SquareKanban,
  FileSignature,
  ClipboardList,
  Briefcase,
  Repeat,
  Wrench,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { ADMIN_EMAIL, carregarModulos, viewsDosModulos } from './lib/permissoes.ts';
import Auth from './components/Auth';
import ResultsDashboard from './components/ResultsDashboard';
import ChatWidget from './components/ChatWidget';
import AvisoNovaVersao from './components/AvisoNovaVersao.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { FeatureTip } from './components/FeatureTip.tsx';
import { GlobalSearch } from './components/GlobalSearch.tsx';
import { CommandCenter } from './components/CommandCenter.tsx';

// Vistas carregadas sob demanda: cada uma vira um chunk proprio e so baixa
// quando o usuario abre a aba. ResultsDashboard fica eager porque e a tela
// inicial (goals) e carregaria no primeiro paint de qualquer jeito.
const Calculator = lazy(() => import('./components/Calculator'));
const MeuDia = lazy(() => import('./components/MeuDia.tsx'));
const PropostaGarantia = lazy(() => import('./components/PropostaGarantia.tsx'));
const NominationLetter = lazy(() => import('./components/NominationLetter'));
const InsuranceDirectory = lazy(() => import('./components/InsuranceDirectory'));
const BanksDirectory = lazy(() => import('./components/BanksDirectory'));
const SuretiesDirectory = lazy(() => import('./components/SuretiesDirectory'));
const InternalProcedures = lazy(() => import('./components/InternalProcedures'));
const ResidentialInsurance = lazy(() => import('./components/ResidentialInsurance'));
const AvisoEntrada = lazy(() => import('./components/AvisoEntrada'));
const AutoInsurance = lazy(() => import('./components/AutoInsurance'));
const AgendaHub = lazy(() => import('./components/AgendaHub'));
const ParceiroManager = lazy(() => import('./components/ParceiroManager'));
const UserManager = lazy(() => import('./components/UserManager'));
const EndossoAllseg = lazy(() => import('./components/EndossoAllseg'));
const Formularios = lazy(() => import('./components/Formularios'));
const RCInsurance = lazy(() => import('./components/RCInsurance'));
const WhatsAppHub = lazy(() => import('./components/WhatsAppHub'));
const ImobiliariaRepasse = lazy(() => import('./components/ImobiliariaRepasse'));
const WhatsAppBlast = lazy(() => import('./components/WhatsAppBlast'));
const ProspeccaoEmail = lazy(() => import('./components/ProspeccaoEmail.tsx'));
const ProspeccaoPncpAuto = lazy(() => import('./components/ProspeccaoPncpAuto.tsx'));
const PncpProspection = lazy(() => import('./components/PncpProspection.tsx'));
const RadarView = lazy(() => import('./src/views/Radar/RadarView.tsx'));
const RadarAdvogadosView = lazy(() => import('./src/views/Radar/RadarAdvogadosView.tsx'));
const SaudeFunil = lazy(() => import('./src/views/Saude/Funil.tsx'));
const SaudeSimulador = lazy(() => import('./src/views/Saude/Simulador.tsx'));
const SaudeCartaExclusividade = lazy(() => import('./src/views/Saude/CartaExclusividade.tsx'));
const SaudeProspeccao = lazy(() => import('./src/views/Saude/Prospeccao.tsx'));
const GarimpoAutomatico = lazy(() => import('./components/GarimpoAutomatico.tsx'));
const EmailTrilhas = lazy(() => import('./components/EmailTrilhas.tsx'));
const Carteira = lazy(() => import('./components/Carteira.tsx'));
const EmailFollowUp = lazy(() => import('./components/EmailFollowUp'));
const GarantiaLocaticia = lazy(() => import('./components/GarantiaLocaticia'));
const InadimplentesResidencial = lazy(() => import('./components/InadimplentesResidencial.tsx'));
const MetaComissao = lazy(() => import('./components/MetaComissao.tsx'));

function VistaCarregando() {
  return (
    <div className="flex items-center justify-center py-24 text-slate-400">
      <Loader2 className="animate-spin" size={22} />
    </div>
  );
}

type View =
  | 'dashboard'
  // Mesmo conteúdo do início (dashboard); mantido para o endereço #meu-dia continuar valendo
  | 'meu-dia'
  // Seguro Garantia
  | 'goals' | 'directory' | 'banks' | 'letter' | 'calculator' | 'endosso-allseg' | 'formularios'
  | 'carteira' | 'posvenda' | 'prospeccao' | 'radar' | 'radar-advogados' | 'prospeccao-email' | 'email-trilhas' | 'pncp-prospeccao' | 'pncp-auto' | 'garimpo' | 'pnpc' | 'seg-licitante' | 'seg-contrato' | 'seg-proposta'
  // Seguro AUTO
  | 'auto' | 'auto-seguradoras'
  // Seguro Residencial
  | 'residential' | 'residencial-seguradoras' | 'residencial-garantidoras' | 'inadimplentes'
  // Responsabilidade Civil
  | 'rc' | 'rc-seguradoras'
  // Plano de Saúde
  | 'saude-funil' | 'saude-simulador' | 'saude-prospeccao' | 'saude-materiais' | 'saude-nomeacao'
  // Gestão Financeira
  | 'meta-comissao' | 'metas-mensais' | 'metas-anuais'
  // Outros
  | 'manual' | 'agenda' | 'parceiros' | 'usuarios' | 'sureties' | 'whatsapp' | 'whatsapp-blast' | 'email-followup' | 'imobiliaria-repasse' | 'garantia-locaticia';

const GARANTIA_VIEWS: View[] = ['goals', 'directory', 'banks', 'letter', 'calculator', 'endosso-allseg', 'formularios', 'carteira', 'posvenda', 'prospeccao', 'radar', 'radar-advogados', 'prospeccao-email', 'email-trilhas', 'pncp-prospeccao', 'pncp-auto', 'garimpo', 'pnpc', 'seg-licitante', 'seg-contrato', 'seg-proposta'];
// Telas do subgrupo Prospecção que aparecem no menu. `pncp-prospeccao` e `pnpc`
// continuam no código, mas saíram do menu (ver docs/menu/MENU-PROSPECCAO.md).
const PROSPECCAO_VIEWS: View[] = ['prospeccao', 'pncp-auto', 'radar', 'radar-advogados', 'garimpo', 'email-trilhas', 'prospeccao-email'];
const COTACOES_VIEWS: View[] = ['seg-licitante', 'seg-contrato', 'seg-proposta'];
// Telas de apoio, reunidas no grupo "Ferramentas" do menu (menu curto de 10/11/2026).
const FERRAMENTAS_VIEWS: View[] = ['pncp-auto', 'radar-advogados', 'garimpo', 'email-trilhas', 'prospeccao-email', 'directory', 'banks', 'letter', 'calculator', 'endosso-allseg', 'formularios', 'whatsapp', 'whatsapp-blast', 'email-followup', 'manual', 'usuarios'];
const AUTO_VIEWS: View[] = ['auto', 'auto-seguradoras'];
// Operacao de seguro auto encerrada em 31/08/2026 (indicacao para o parceiro).
// O historico de vendas continua no banco; para reabrir o menu, basta true.
const MODULO_AUTO_ATIVO = false;
const RESIDENCIAL_VIEWS: View[] = ['residential', 'residencial-seguradoras', 'residencial-garantidoras', 'imobiliaria-repasse', 'garantia-locaticia', 'inadimplentes'];
const RC_VIEWS: View[] = ['rc', 'rc-seguradoras'];
const SAUDE_VIEWS: View[] = ['saude-funil', 'saude-simulador', 'saude-prospeccao', 'saude-materiais', 'saude-nomeacao'];
const FINANCEIRO_VIEWS: View[] = ['meta-comissao', 'metas-mensais', 'metas-anuais'];

const VIEW_TITLES: Record<View, string> = {
  dashboard: 'Meu dia',
  'meu-dia': 'Meu dia',
  goals: 'Gestão Comercial · Vendas',
  directory: 'Seguradoras · Garantia',
  banks: 'Bancos Garantidores',
  letter: 'Gerador de Nomeação',
  calculator: 'Calculadora de Seguros',
  'endosso-allseg': 'Pedido de Endosso · Allseg',
  formularios: 'Formulários para Clientes',
  carteira: 'Carteira de Clientes',
  posvenda: 'Pós-venda',
  prospeccao: 'Kanban de Leads',
  radar: 'Radar PGFN',
  'radar-advogados': 'Advogados TRF3',
  'prospeccao-email': 'Contatos nas Trilhas',
  'email-trilhas': 'Trilhas de E-mail',
  'pncp-prospeccao': 'Prospecção PNCP',
  'pncp-auto': 'PNCP Automático',
  garimpo: 'Garimpo Google Maps',
  pnpc: 'PNPC',
  'seg-licitante': 'Seguro Licitante',
  'seg-contrato': 'Seguro de Contrato',
  'seg-proposta': 'Gerar Proposta',
  auto: 'Seguro AUTO',
  'auto-seguradoras': 'Seguradoras AUTO',
  residential: 'Seguro Residencial / Locatícia',
  'residencial-seguradoras': 'Seguradoras Residencial',
  'residencial-garantidoras': 'Garantidoras',
  rc: 'Responsabilidade Civil',
  'rc-seguradoras': 'Seguradoras · RC',
  'saude-funil': 'Funil · Plano de Saúde',
  'saude-simulador': 'Simulador de Cotação · Saúde',
  'saude-prospeccao': 'Prospecção · Plano de Saúde',
  'saude-materiais': 'Materiais · Plano de Saúde',
  'saude-nomeacao': 'Carta de Exclusividade · Saúde',
  'meta-comissao': 'Meta de Comissão',
  'metas-mensais': 'Metas Mensais',
  'metas-anuais': 'Metas Anuais',
  manual: 'Manual de Procedimentos Internos',
  agenda: 'Agenda Semanal',
  parceiros: 'Gestão de Parceiros',
  usuarios: 'Usuários do Hub',
  sureties: 'Afiançadoras',
  whatsapp: 'WhatsApp · Inbox',
  'whatsapp-blast': 'WhatsApp · Prospecção',
  'email-followup': 'Follow-up de Email',
  'imobiliaria-repasse': 'Repasse Imobiliárias',
  'garantia-locaticia': 'Garantia Locatícia',
  'inadimplentes': 'Inadimplentes · Residencial',
};

const BadgeDot = ({ count }: { count: number }) => {
    if (count <= 0) return null;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: '18px', height: '18px', padding: '0 4px',
            background: '#ef4444', color: '#fff', borderRadius: '9px',
            fontSize: '10px', fontWeight: 900, lineHeight: 1, marginLeft: 'auto',
        }}>
            {count > 99 ? '99+' : count}
        </span>
    );
};

// Telas que saíram do menu: quem tinha uma delas no endereço (F5, favorito)
// cai no Kanban de Leads em vez de numa tela sem item no menu.
const VIEWS_FORA_DO_MENU: Partial<Record<View, View>> = {
  'pncp-prospeccao': 'prospeccao',
  pnpc: 'prospeccao',
};

/** Lê a tela do endereço (#prospeccao). Valor desconhecido ou vazio = Visão Geral. */
const viewDaUrl = (): View => {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (!h || !Object.prototype.hasOwnProperty.call(VIEW_TITLES, h)) return 'dashboard';
  const destino = VIEWS_FORA_DO_MENU[h as View];
  if (destino) {
    // replaceState: o endereço antigo não fica no histórico (o Voltar não cai nele de novo).
    window.history.replaceState(null, '', window.location.pathname + window.location.search + `#${destino}`);
    return destino;
  }
  return h as View;
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // A tela aberta fica no endereço (ex.: hub.fegsegurogarantia.com/#prospeccao),
  // para que atualizar a página (F5) volte para a mesma tela e não para a Visão Geral.
  const [activeView, setActiveView] = useState<View>(viewDaUrl);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [unreadWhatsApp, setUnreadWhatsApp] = useState(0);
  // Módulos liberados para quem está logado. `null` = vê tudo.
  const [modulos, setModulos] = useState<string[] | null>(null);
  // As permissões chegam depois do login. O aviso de entrada espera por elas,
  // senão quem não tem o Residencial veria o aviso no intervalo.
  const [modulosProntos, setModulosProntos] = useState(false);
  const [badges, setBadges] = useState<{
    whatsapp: number;
    imobiliaria: number;
    vencimentos: number;
  }>({ whatsapp: 0, imobiliaria: 0, vencimentos: 0 });

  const loadBadges = useCallback(async () => {
    try {
      const { count: wppCount } = await supabase
        .from('whatsapp_leads')
        .select('*', { count: 'exact', head: true })
        .eq('bot_active', false);

      const { count: imobCount } = await supabase
        .from('imobiliaria_clientes')
        .select('*', { count: 'exact', head: true })
        .in('kanban_status', ['solicitado', 'atendimento_iniciado']);

      const hoje = new Date().toISOString().slice(0, 10);
      const em30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      // Mesma regra do aviso amarelo do Registro de Vendas: vence em até 30
      // dias, sem "não renovar" e fora do Repasse (cliente de imobiliária tem
      // a renovação decidida lá, no portal). Antes contava todo mundo.
      const [{ data: vencendo }, { data: noRepasse }] = await Promise.all([
        supabase.from('residential_clients').select('nome, cpf, nao_renovar')
          .eq('situacao', 'Ativo').gte('fim_vigencia', hoje).lte('fim_vigencia', em30),
        supabase.from('imobiliaria_clientes').select('inquilino_nome, cpf'),
      ]);
      const nomeChave = (n: string | null) => (n || '').trim().toUpperCase();
      const cpfChave = (c: string | null) => (c || '').replace(/\D/g, '');
      const nomesRepasse = new Set((noRepasse || []).map(r => nomeChave(r.inquilino_nome)).filter(Boolean));
      const cpfsRepasse = new Set((noRepasse || []).map(r => cpfChave(r.cpf)).filter(c => c.length >= 11));
      const vencCount = (vencendo || []).filter(r =>
        !r.nao_renovar && !nomesRepasse.has(nomeChave(r.nome)) && !(cpfChave(r.cpf).length >= 11 && cpfsRepasse.has(cpfChave(r.cpf)))
      ).length;

      setBadges({
        whatsapp: wppCount || 0,
        imobiliaria: imobCount || 0,
        vencimentos: vencCount || 0,
      });
    } catch (e) { /* silent fail */ }
  }, []);
  // Atalhos de teclado globais (Ctrl+1..4)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, string> = { '1': 'dashboard', '2': 'goals', '3': 'residential', '4': 'whatsapp' };
        const alvo = map[e.key];
        if (!alvo) return;
        e.preventDefault();
        // O atalho não pode furar a permissão: quem não vê o WhatsApp no menu
        // também não chega nele por Ctrl+4.
        if (modulos && !viewsDosModulos(modulos).has(alvo)) return;
        setActiveView(alvo as View);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modulos]);

  const [pendingSale, setPendingSale] = useState<{ nome: string; telefone: string } | null>(null);
  const activeViewRef = React.useRef<View>('dashboard');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    garantia: false,
    prospeccao: false,
    cotacoes: false,
    ferramentas: false,
    financeiro: false,
    auto: false,
    residencial: false,
    rc: false,
    saude: false,
    whatsapp: false,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadBadges();
    const interval = setInterval(loadBadges, 120000);
    return () => clearInterval(interval);
  }, [loadBadges, session]);

  // Permissões do usuário logado. `null` = sem restrição (admin, ou quem
  // ainda não tem linha na tabela) — ver lib/permissoes.ts.
  useEffect(() => {
    if (!session) { setModulos(null); setModulosProntos(false); return; }
    carregarModulos(session.user?.email).then(m => { setModulos(m); setModulosProntos(true); });
  }, [session]);

  // Reagir a mudança de permissão sem esperar o próximo login: o admin marca
  // ou desmarca um módulo e a tela da pessoa se ajusta na hora.
  useEffect(() => {
    const email = session?.user?.email;
    if (!email || email === ADMIN_EMAIL) return;
    const canal = supabase
      .channel('hub-permissoes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_permissoes', filter: `user_email=eq.${email}` },
        () => { carregarModulos(email).then(setModulos); })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [session]);

  // Se a view aberta deixou de ser permitida (o admin acabou de tirar o
  // acesso), volta para a Visão Geral em vez de deixar a tela renderizada.
  useEffect(() => {
    if (!modulos) return;
    if (!viewsDosModulos(modulos).has(activeView)) setActiveView('dashboard');
  }, [modulos, activeView]);

  // Keep ref in sync so realtime callback can read current view
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);

  // Grava a tela aberta no endereço. Cada troca de tela vira uma entrada do
  // histórico, então o botão Voltar do navegador volta para a tela anterior do HUB.
  useEffect(() => {
    // Trava: link de login/convite do Supabase traz o token depois do # (tem "=").
    // Esse endereço nunca é sobrescrito; o Supabase lê e limpa sozinho.
    if (window.location.hash.includes('=')) return;
    const alvo = activeView === 'dashboard' ? '' : `#${activeView}`;
    if (window.location.hash !== alvo) {
      window.history.pushState(null, '', window.location.pathname + window.location.search + alvo);
    }
  }, [activeView]);

  // Botões Voltar/Avançar do navegador: segue o endereço. Se a pessoa não tiver
  // acesso à tela do endereço, o useEffect de permissões devolve para a Visão Geral.
  useEffect(() => {
    const aoNavegar = () => setActiveView(viewDaUrl());
    window.addEventListener('popstate', aoNavegar);
    return () => window.removeEventListener('popstate', aoNavegar);
  }, []);

  // Realtime: listen for new inbound WhatsApp messages
  useEffect(() => {
    if (!session) return;

    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const channel = supabase
      .channel('whatsapp-new-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: 'direction=eq.inbound' },
        (payload: any) => {
          if (activeViewRef.current !== 'whatsapp') {
            setUnreadWhatsApp(prev => prev + 1);
          }
          // Browser notification when tab is not focused
          if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            const msg = payload.new?.message ?? 'Nova mensagem recebida';
            const name = payload.new?.name ?? payload.new?.phone ?? 'Contato';
            new Notification(`WhatsApp · ${name}`, {
              body: msg.length > 80 ? msg.substring(0, 80) + '…' : msg,
              icon: '/icons/icon-192.png',
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session]);

  // Auto-expand the group that contains the active view
  useEffect(() => {
    if (COTACOES_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, cotacoes: true }));
    if (FERRAMENTAS_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, ferramentas: true }));
    if (FINANCEIRO_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, financeiro: true }));
    if (AUTO_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, auto: true }));
    if (RESIDENCIAL_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, residencial: true }));
    if (RC_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, rc: true }));
    if (SAUDE_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, saude: true }));
  }, [activeView]);

  const toggleGroup = (key: string) =>
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Checagens de permissão ────────────────────────────────────────
  // `modulos === null` significa sem restrição, então tudo passa.
  const podeModulo = (key: string) => !modulos || modulos.includes(key);
  const podeVer = (view: View) => !modulos || viewsDosModulos(modulos).has(view);

  // View efetivamente renderizada. É `null` quando a pessoa não tem acesso à
  // tela aberta — o useEffect acima devolve para a Visão Geral, mas sem esta
  // barreira o componente ainda montaria e buscaria dados no quadro anterior
  // ao redirecionamento. Todo o bloco de render abaixo compara com `vista`.
  const vista: View | null = podeVer(activeView) ? activeView : null;

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const navigate = (view: View) => {
    // Barreira única de navegação: o menu já esconde o que a pessoa não pode
    // ver, mas atalho de teclado, busca global e botões de atalho da Visão
    // Geral entram por aqui também.
    if (!podeVer(view)) return;
    setActiveView(view);
    if (view === 'whatsapp') setUnreadWhatsApp(0);
    if (view !== 'goals') setPendingSale(null);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="relative">
          <div className="w-24 h-24 border-4 border-gold/20 border-t-gold rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center text-gold font-black text-xl">FG</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Auth onSessionUpdate={() => { }} />;
  }

  const Logo = () => (
    <div className="flex items-center justify-center">
      <img src="/marca/fg-logo-horizontal-bege.svg" alt="F&G Seguro Garantia" className="h-14 w-auto object-contain" />
    </div>
  );

  // ── Plain top-level nav item ────────────────────────────────────
  // Item ativo: fundo navy-light e barra dourada à esquerda (o dourado marca
  // onde a pessoa está, sem virar um botão cheio).
  const NavItem: React.FC<{ view: View; icon: React.ReactNode; label: string; badge?: number }> = ({ view, icon, label, badge }) => (
    <button
      onClick={() => navigate(view)}
      aria-current={activeView === view ? 'page' : undefined}
      className={`flex items-center justify-between w-full pl-3 pr-3.5 py-2.5 rounded-lg border-l-[3px] transition-colors group ${
        activeView === view
          ? 'bg-navy-light text-white border-gold'
          : 'text-slate-300 border-transparent hover:bg-navy-light hover:text-white'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`${activeView === view ? 'text-gold' : 'text-slate-400 group-hover:text-gold'} transition-colors shrink-0`}>{icon}</span>
        <span className={`text-sm truncate ${activeView === view ? 'font-bold' : 'font-medium'}`}>{label}</span>
      </div>
      {badge != null && badge > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 bg-emerald-500 text-white text-[10px] font-bold rounded-xl flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );

  // ── Collapsible group header ────────────────────────────────────
  const NavGroup: React.FC<{
    groupKey: string;
    icon: React.ReactNode;
    label: string;
    isGroupActive: boolean;
    children: React.ReactNode;
  }> = ({ groupKey, icon, label, isGroupActive, children }) => {
    const isOpen = openGroups[groupKey];
    return (
      <div>
        <button
          onClick={() => toggleGroup(groupKey)}
          aria-expanded={!!isOpen}
          className={`flex items-center justify-between w-full pl-3 pr-3.5 py-2.5 rounded-lg border-l-[3px] border-transparent transition-colors group ${
            isGroupActive ? 'text-white' : 'text-slate-300 hover:bg-navy-light hover:text-white'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={`${isGroupActive ? 'text-gold' : 'text-slate-400 group-hover:text-gold'} transition-colors shrink-0`}>{icon}</span>
            <span className={`text-sm truncate ${isGroupActive ? 'font-bold' : 'font-medium'}`}>{label}</span>
          </div>
          <ChevronDown
            size={12}
            className={`text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {isOpen && (
          <div className="mt-0.5 ml-5 pl-2 border-l border-white/10 space-y-0.5 py-0.5">
            {children}
          </div>
        )}
      </div>
    );
  };

  // ── Sub-item inside a group ──────────────────────────────────────
  const NavSubItem: React.FC<{ view: View; label: string; badge?: number; icon?: React.ReactNode }> = ({ view, label, badge, icon }) => (
    <button
      onClick={() => navigate(view)}
      aria-current={activeView === view ? 'page' : undefined}
      className={`flex items-center justify-between w-full px-3 py-2 rounded-lg transition-colors text-[13px] ${
        activeView === view
          ? 'bg-navy-light text-white font-bold'
          : 'text-slate-400 font-medium hover:text-white hover:bg-navy-light'
      }`}
    >
      <span className="flex items-center gap-1.5 min-w-0 truncate">{icon}{label}</span>
      {badge != null && badge > 0 && <BadgeDot count={badge} />}
    </button>
  );

  // ── Rótulo de seção (só texto, não clicável) ─────────────────────
  const NavSectionLabel: React.FC<{ label: string }> = ({ label }) => (
    <div className="px-3.5 pt-5 pb-1.5 text-[11px] font-semibold text-slate-500 select-none">
      {label}
    </div>
  );

  return (
    <ToastProvider>
    {/* Passa por navigate() para a busca global respeitar a permissão. */}
    <GlobalSearch onNavigate={(view) => navigate(view as View)} />
    {/* Aviso ao abrir: solicitações novas e renovações confirmadas pela imobiliária */}
    {modulosProntos && podeVer('imobiliaria-repasse') && (
      <Suspense fallback={null}><AvisoEntrada onAbrirRepasse={() => navigate('imobiliaria-repasse')} /></Suspense>
    )}
    <div className="min-h-screen flex bg-areia font-sans selection:bg-gold/30">
      {/* Overlay mobile — fecha sidebar ao clicar fora */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-navy transform transition-transform duration-500 ease-in-out lg:relative lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } no-print shadow-2xl border-r border-gold/20 h-screen`}
      >
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 custom-scroll">
            <div className="mb-8 flex justify-center">
              <Logo />
            </div>

            <nav className="space-y-0.5" aria-label="Menu principal">
              <NavItem view="dashboard" icon={<LayoutDashboard size={16} />} label="Meu dia" />

              {/* ── Dia a dia do Seguro Garantia ─────────── */}
              {podeModulo('garantia') && (
              <>
                <NavSectionLabel label="Seguro Garantia" />
                <NavItem view="prospeccao" icon={<SquareKanban size={16} />} label="Prospecção" />
                <NavGroup
                  groupKey="cotacoes"
                  icon={<FileSignature size={16} />}
                  label="Cotações"
                  isGroupActive={COTACOES_VIEWS.includes(activeView)}
                >
                  <NavSubItem view="seg-licitante" label="Seguro Licitante" />
                  <NavSubItem view="seg-contrato" label="Seguro de Contrato" />
                  <NavSubItem view="seg-proposta" label="Gerar Proposta" />
                </NavGroup>
                <NavItem view="goals" icon={<ClipboardList size={16} />} label="Registro de Vendas" />
                <NavItem view="carteira" icon={<Briefcase size={16} />} label="Carteira de Clientes" />
                <NavItem view="posvenda" icon={<Repeat size={16} />} label="Pós-venda" />
                <NavItem view="radar" icon={<Radar size={16} />} label="Radar fiscal" />
              </>
              )}

              {/* ── Outras linhas ─────────────────────────── */}
              {(podeModulo('residencial') || podeModulo('saude') || podeModulo('rc') || (MODULO_AUTO_ATIVO && podeModulo('auto'))) && (
                <NavSectionLabel label="Outras linhas" />
              )}

              {podeModulo('residencial') && (
              <NavGroup
                groupKey="residencial"
                icon={<Home size={16} />}
                label="Residencial"
                isGroupActive={RESIDENCIAL_VIEWS.includes(activeView)}
              >
                <NavSubItem view="residential" label="Registro de Vendas" badge={badges.vencimentos} />
                <NavSubItem view="imobiliaria-repasse" label="Repasse Imobiliárias" badge={badges.imobiliaria} />
                <FeatureTip
                  id="garantia-calc-2026"
                  title="Calculadora de Garantia"
                  description="Simule o valor da garantia locatícia em segundos e gere a mensagem pronta para o cliente."
                  position="right"
                >
                  <NavSubItem view="garantia-locaticia" label="Garantia Locatícia" />
                </FeatureTip>
              </NavGroup>
              )}

              {podeModulo('saude') && (
              <NavGroup
                groupKey="saude"
                icon={<HeartPulse size={16} />}
                label="Plano de Saúde"
                isGroupActive={SAUDE_VIEWS.includes(activeView)}
              >
                <NavSubItem view="saude-funil" label="Funil de Leads" />
                <NavSubItem view="saude-simulador" label="Simulador de Cotação" />
                <NavSubItem view="saude-prospeccao" label="Prospecção" />
                <NavSubItem view="saude-materiais" label="Materiais" />
                <NavSubItem view="saude-nomeacao" label="Carta de Exclusividade" />
              </NavGroup>
              )}

              {podeModulo('rc') && (
              <NavGroup
                groupKey="rc"
                icon={<ShieldAlert size={16} />}
                label="Resp. Civil"
                isGroupActive={RC_VIEWS.includes(activeView)}
              >
                <NavSubItem view="rc" label="Registro de Vendas" />
                <NavSubItem view="rc-seguradoras" label="Seguradoras" />
              </NavGroup>
              )}

              {MODULO_AUTO_ATIVO && podeModulo('auto') && (
              <NavGroup
                groupKey="auto"
                icon={<Car size={16} />}
                label="Seguro AUTO"
                isGroupActive={AUTO_VIEWS.includes(activeView)}
              >
                <NavSubItem view="auto" label="Registro de Vendas" />
                <NavSubItem view="auto-seguradoras" label="Seguradoras" />
              </NavGroup>
              )}

              {/* ── Gestão ────────────────────────────────── */}
              {(podeModulo('financeiro') || podeModulo('parceiros') || podeModulo('agenda')) && (
                <NavSectionLabel label="Gestão" />
              )}

              {podeModulo('financeiro') && (
              <NavGroup
                groupKey="financeiro"
                icon={<Target size={16} />}
                label="Metas"
                isGroupActive={FINANCEIRO_VIEWS.includes(activeView)}
              >
                <NavSubItem view="meta-comissao" label="Meta de Comissão" />
                <NavSubItem view="metas-mensais" label="Metas Mensais" />
                <NavSubItem view="metas-anuais" label="Metas Anuais" />
              </NavGroup>
              )}
              {podeModulo('parceiros') && (
              <FeatureTip
                id="parceiros-portal-2026"
                title="Portal de Parceiros"
                description="Envie e-mail de boas-vindas, acompanhe comissões e registre repasses mensais para cada parceiro."
                position="right"
              >
                <NavItem view="parceiros" icon={<Users size={16} />} label="Parceiros" />
              </FeatureTip>
              )}
              {podeModulo('agenda') && <NavItem view="agenda" icon={<Calendar size={16} />} label="Agenda" />}

              {/* ── Ferramentas: telas de apoio, fora do dia a dia ── */}
              {(podeModulo('garantia') || podeModulo('whatsapp') || podeModulo('email-followup') || podeModulo('manual') || session?.user?.email === ADMIN_EMAIL) && (
              <>
                <NavSectionLabel label="Apoio" />
                <NavGroup
                  groupKey="ferramentas"
                  icon={<Wrench size={16} />}
                  label="Ferramentas"
                  isGroupActive={FERRAMENTAS_VIEWS.includes(activeView)}
                >
                  {podeModulo('garantia') && (
                  <>
                    <NavSubItem view="pncp-auto" label="PNCP Automático" />
                    <NavSubItem view="radar-advogados" label="Advogados TRF3" />
                    <NavSubItem view="garimpo" label="Garimpo Google Maps" />
                    <NavSubItem view="email-trilhas" label="Trilhas de E-mail" />
                    <NavSubItem view="prospeccao-email" label="Contatos nas Trilhas" />
                    <NavSubItem view="directory" label="Seguradoras" />
                    <NavSubItem view="banks" label="Bancos Garantidores" />
                    <NavSubItem view="letter" label="Carta de Nomeação" />
                    <NavSubItem view="calculator" label="Cálculo de Garantia" />
                    <NavSubItem view="endosso-allseg" label="Endosso Allseg" />
                    <NavSubItem view="formularios" label="Formulários" />
                  </>
                  )}
                  {podeModulo('whatsapp') && (
                  <>
                    <NavSubItem view="whatsapp" label={`WhatsApp: Inbox${unreadWhatsApp > 0 ? ` (${unreadWhatsApp})` : ''}`} />
                    <NavSubItem view="whatsapp-blast" label="WhatsApp: Prospecção" />
                  </>
                  )}
                  {podeModulo('email-followup') && <NavSubItem view="email-followup" label="Follow-up de Email" />}
                  {podeModulo('manual') && <NavSubItem view="manual" label="Manual de Procedimentos" />}
                  {session?.user?.email === ADMIN_EMAIL && <NavSubItem view="usuarios" label="Usuários do Hub" />}
                </NavGroup>
              </>
              )}
            </nav>
          </div>

          <div className="shrink-0 mt-auto p-6 bg-navy-dark space-y-3">
            {/* Indicador de versão do build — confirma qual deploy está rodando */}
            {(() => {
              const buildTime: string | null = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null;
              if (!buildTime) return null;
              const d = new Date(buildTime);
              const fmt = d.toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit',
              });
              return (
                <div className="px-2">
                  <span className="text-[10px] text-slate-500 font-mono">build {fmt}</span>
                </div>
              );
            })()}
            <button
              onClick={handleLogout}
              className="group flex items-center gap-3 text-slate-300 hover:text-gold transition-all text-sm font-bold w-full px-5 py-3 rounded-2xl hover:bg-navy-light"
            >
              <LogOut size={14} className="group-hover:rotate-12 transition-transform" />
              <span>Encerrar Acesso</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="bg-areia-clara/95 backdrop-blur-md border-b border-gold/25 flex items-center justify-between px-3 lg:px-8 no-print shrink-0 z-30" style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 'calc(3.5rem + env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2 lg:gap-4 min-w-0">
            <button
              className="lg:hidden p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-all shrink-0"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="min-w-0">
              <h2 className="text-navy font-black text-base lg:text-xl tracking-tight truncate">
                {VIEW_TITLES[activeView]}
              </h2>
              <p className="hidden sm:block text-[10px] text-slate-500 font-bold mt-0.5 truncate">
                Sessão Ativa: {session?.user?.email?.split('@')[0]}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4 shrink-0">
            {/* Busca: ícone no mobile, botão completo no desktop */}
            <button
              onMouseDown={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              className="flex items-center gap-2 p-2 sm:px-4 sm:py-2 bg-areia border border-linha rounded-xl cursor-pointer text-stone-500 hover:bg-areia-escura transition-all"
            >
              <Search size={15} />
              <span className="hidden sm:inline text-sm font-semibold">Buscar</span>
              <kbd className="hidden sm:inline text-[10px] bg-linha rounded-xl px-1 text-slate-400">⌘K</kbd>
            </button>
            <div className="hidden sm:block h-8 w-[1px] bg-gold/30"></div>
            <div className="hidden sm:flex items-center gap-3 group cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-navy flex items-center justify-center text-gold shadow-md group-hover:scale-105 transition-transform">
                <User size={18} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8 custom-scroll bg-areia/80">
          {/* Limite largo para aproveitar monitores grandes, sem esticar ao infinito em ultrawide */}
          <div className="max-w-[1800px] mx-auto pb-20 lg:pb-16">

            {/* ── Início: Meu dia ──────────────────────────────── */}
            {activeView === 'dashboard' && (
              <div className="space-y-8 animate-fade-in">
                {/* Início por função (10/11/2026): substituiu o hero e os atalhos da antiga Visão Geral. */}
                <Suspense fallback={<VistaCarregando />}>
                  <MeuDia email={session?.user?.email} onAbrir={(v) => navigate(v as View)} />
                </Suspense>

                <div className="pt-4 border-t border-linha">
                  <div className="flex items-center justify-between mb-6 px-2">
                    <h3 className="text-xl font-extrabold text-navy tracking-tight">Portais públicos</h3>
                    <p className="text-xs font-bold text-slate-400">Links para enviar aos clientes/parceiros</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Portal do Parceiro', desc: 'Acesso dos parceiros comerciais ao relatório de comissões', url: 'https://hub.fegsegurogarantia.com/parceiros-login.html', icon: <Handshake size={20} className="text-gold" /> },
                      { label: 'Portal da Imobiliária', desc: 'Acesso das imobiliárias parceiras ao portal de clientes', url: 'https://hub.fegsegurogarantia.com/imobiliaria.html', icon: <Home size={20} className="text-gold" /> },
                    ].map((portal, idx) => (
                      <div key={idx} className="bg-white rounded-2xl border border-slate-100 p-4 lg:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="text-xl shrink-0">{portal.icon}</div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm">{portal.label}</p>
                            <p className="text-xs text-slate-400 font-medium mt-0.5 hidden sm:block">{portal.desc}</p>
                            <a href={portal.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gold font-bold hover:underline mt-0.5 block truncate max-w-[220px]">
                              {portal.url.replace('https://', '')}
                            </a>
                          </div>
                        </div>
                        <button onClick={() => navigator.clipboard.writeText(portal.url)} className="shrink-0 text-xs font-bold px-4 py-2.5 min-h-[40px] bg-navy hover:bg-navy-light text-white rounded-xl transition-all">
                          Copiar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Views ──────────────────────────────────────────── */}
            <div className="animate-fade-in">
              <Suspense fallback={<VistaCarregando />}>
              {/* Seguro Garantia */}
              {vista === 'goals' && <ResultsDashboard key="goals" initialSection="sales" initialSaleData={pendingSale ?? undefined} />}
              {vista === 'carteira' && <ResultsDashboard key="carteira" initialSection="carteira" hideTabs />}
              {vista === 'posvenda' && <Carteira />}
              {vista === 'meu-dia' && <MeuDia email={session?.user?.email} onAbrir={(v) => navigate(v as View)} />}
              {vista === 'prospeccao' && <ResultsDashboard key="prospeccao" initialSection="prospects" hideTabs />}
              {vista === 'radar' && <RadarView />}
              {vista === 'radar-advogados' && <RadarAdvogadosView />}
              {vista === 'prospeccao-email' && <ProspeccaoEmail />}
              {vista === 'email-trilhas' && <EmailTrilhas />}
              {vista === 'pncp-prospeccao' && <PncpProspection />}
              {vista === 'pncp-auto' && <ProspeccaoPncpAuto />}
              {vista === 'garimpo' && <GarimpoAutomatico />}
              {vista === 'pnpc' && <ResultsDashboard key="pnpc" initialSection="pnpc" hideTabs />}
              {vista === 'seg-licitante' && <ResultsDashboard key="seg-licitante" initialSection="licitante" hideTabs onVerVendas={() => navigate('goals')} />}
              {vista === 'seg-contrato' && <ResultsDashboard key="seg-contrato" initialSection="contrato" hideTabs onVerVendas={() => navigate('goals')} />}
              {vista === 'meta-comissao' && <MetaComissao key="meta-comissao" />}
              {vista === 'metas-mensais' && <ResultsDashboard key="metas-mensais" initialSection="goals" hideTabs />}
              {vista === 'metas-anuais' && <ResultsDashboard key="metas-anuais" initialSection="annualGoals" hideTabs />}
              {vista === 'directory' && (
                <InsuranceDirectory
                  tableName="insurers"
                  title="Seguradoras · Garantia"
                  subtitle="Gerenciamento centralizado de acessos e condições comerciais."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}
              {vista === 'banks' && <BanksDirectory />}
              {vista === 'letter' && <NominationLetter />}
              {vista === 'calculator' && <Calculator />}
              {vista === 'seg-proposta' && <PropostaGarantia />}
              {vista === 'endosso-allseg' && <EndossoAllseg />}
              {vista === 'formularios' && <Formularios />}

              {/* Seguro AUTO */}
              {vista === 'auto' && <AutoInsurance />}
              {vista === 'auto-seguradoras' && (
                <InsuranceDirectory
                  tableName="seguradoras_auto"
                  title="Seguradoras AUTO"
                  subtitle="Portais, acessos e condições comerciais para o ramo auto."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}

              {/* Seguro Residencial */}
              {vista === 'residential' && <ResidentialInsurance onAbrirRepasse={() => navigate('imobiliaria-repasse')} />}
              {vista === 'residencial-seguradoras' && (
                <InsuranceDirectory
                  tableName="seguradoras_residencial"
                  title="Seguradoras Residencial"
                  subtitle="Portais, acessos e condições para residencial e locatícia."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}
              {vista === 'residencial-garantidoras' && (
                <InsuranceDirectory
                  tableName="garantidoras_residencial"
                  title="Garantidoras"
                  subtitle="Empresas fiançadoras para seguro locatício."
                  itemName="Garantidora"
                  emptyStateText="Adicionar Garantidora"
                />
              )}

              {/* Responsabilidade Civil */}
              {vista === 'imobiliaria-repasse' && <ImobiliariaRepasse />}
              {vista === 'garantia-locaticia' && <GarantiaLocaticia />}
              {vista === 'inadimplentes' && <InadimplentesResidencial />}
              {vista === 'rc' && <RCInsurance />}
              {vista === 'rc-seguradoras' && (
                <InsuranceDirectory
                  tableName="seguradoras_rc"
                  title="Seguradoras · RC"
                  subtitle="Portais, acessos e condições para responsabilidade civil."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}

              {/* Plano de Saúde */}
              {vista === 'saude-funil' && <SaudeFunil />}
              {vista === 'saude-simulador' && <SaudeSimulador />}
              {vista === 'saude-prospeccao' && <SaudeProspeccao />}
              {vista === 'saude-materiais' && <Formularios modulo="saude" />}
              {vista === 'saude-nomeacao' && <SaudeCartaExclusividade />}

              {/* Outros */}
              {vista === 'whatsapp' && <WhatsAppHub onGoToSale={(data) => { setPendingSale(data); navigate('goals'); }} />}
              {vista === 'whatsapp-blast' && <WhatsAppBlast />}
              {vista === 'email-followup' && <EmailFollowUp />}
              {vista === 'sureties' && <SuretiesDirectory />}
              {vista === 'manual' && <InternalProcedures />}
              {vista === 'agenda' && <AgendaHub />}
              {vista === 'parceiros' && <ParceiroManager />}
              {vista === 'usuarios' && <UserManager />}
              </Suspense>
            </div>
          </div>
        </div>
      </main>

      <ChatWidget activeView={activeView} />
      {/* Avisa quando sai deploy novo, para ninguém passar a semana na versão
          antiga só por deixar a aba aberta. */}
      <AvisoNovaVersao />
    </div>
    </ToastProvider>
  );
};

export default App;
