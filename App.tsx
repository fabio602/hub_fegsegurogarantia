
import React, { useState, useEffect, useCallback } from 'react';
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
  Bell,
  Loader2,
  Zap,
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
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { ADMIN_EMAIL, carregarModulos, viewsDosModulos } from './lib/permissoes.ts';
import Auth from './components/Auth';
import Calculator from './components/Calculator';
import NominationLetter from './components/NominationLetter';
import ResultsDashboard from './components/ResultsDashboard';
import InsuranceDirectory from './components/InsuranceDirectory';
import BanksDirectory from './components/BanksDirectory';
import SuretiesDirectory from './components/SuretiesDirectory';
import InternalProcedures from './components/InternalProcedures';
import ResidentialInsurance from './components/ResidentialInsurance';
import AutoInsurance from './components/AutoInsurance';
import AgendaHub from './components/AgendaHub';
import ParceiroManager from './components/ParceiroManager';
import UserManager from './components/UserManager';
import EndossoAllseg from './components/EndossoAllseg';
import RCInsurance from './components/RCInsurance';
import ChatWidget from './components/ChatWidget';
import AvisoNovaVersao from './components/AvisoNovaVersao.tsx';
import WhatsAppHub from './components/WhatsAppHub';
import ImobiliariaRepasse from './components/ImobiliariaRepasse';
import WhatsAppBlast from './components/WhatsAppBlast';
import ProspeccaoEmail from './components/ProspeccaoEmail.tsx';
import ProspeccaoPncpAuto from './components/ProspeccaoPncpAuto.tsx';
import PncpProspection from './components/PncpProspection.tsx';
import GarimpoAutomatico from './components/GarimpoAutomatico.tsx';
import EmailTrilhas from './components/EmailTrilhas.tsx';
import EmailFollowUp from './components/EmailFollowUp';
import GarantiaLocaticia from './components/GarantiaLocaticia';
import InadimplentesResidencial from './components/InadimplentesResidencial.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { FeatureTip } from './components/FeatureTip.tsx';
import { GlobalSearch } from './components/GlobalSearch.tsx';
import { CommandCenter } from './components/CommandCenter.tsx';

type View =
  | 'dashboard'
  // Seguro Garantia
  | 'goals' | 'directory' | 'banks' | 'letter' | 'calculator' | 'endosso-allseg'
  | 'carteira' | 'prospeccao' | 'prospeccao-email' | 'email-trilhas' | 'pncp-prospeccao' | 'pncp-auto' | 'garimpo' | 'pnpc' | 'seg-licitante' | 'seg-contrato'
  // Seguro AUTO
  | 'auto' | 'auto-seguradoras'
  // Seguro Residencial
  | 'residential' | 'residencial-seguradoras' | 'residencial-garantidoras' | 'inadimplentes'
  // Responsabilidade Civil
  | 'rc' | 'rc-seguradoras'
  // Gestão Financeira
  | 'metas-mensais' | 'metas-anuais'
  // Outros
  | 'manual' | 'agenda' | 'parceiros' | 'usuarios' | 'sureties' | 'whatsapp' | 'whatsapp-blast' | 'email-followup' | 'imobiliaria-repasse' | 'garantia-locaticia';

const GARANTIA_VIEWS: View[] = ['goals', 'directory', 'banks', 'letter', 'calculator', 'endosso-allseg', 'carteira', 'prospeccao', 'prospeccao-email', 'email-trilhas', 'pncp-prospeccao', 'pncp-auto', 'garimpo', 'pnpc', 'seg-licitante', 'seg-contrato'];
const AUTO_VIEWS: View[] = ['auto', 'auto-seguradoras'];
const RESIDENCIAL_VIEWS: View[] = ['residential', 'residencial-seguradoras', 'residencial-garantidoras', 'imobiliaria-repasse', 'garantia-locaticia', 'inadimplentes'];
const RC_VIEWS: View[] = ['rc', 'rc-seguradoras'];
const FINANCEIRO_VIEWS: View[] = ['metas-mensais', 'metas-anuais'];

const VIEW_TITLES: Record<View, string> = {
  dashboard: 'Bem-vindo ao Hub F&G',
  goals: 'Gestão Comercial — Vendas',
  directory: 'Seguradoras — Garantia',
  banks: 'Bancos Garantidores',
  letter: 'Gerador de Nomeação',
  calculator: 'Calculadora de Seguros',
  'endosso-allseg': 'Pedido de Endosso — Allseg',
  carteira: 'Carteira de Clientes',
  prospeccao: 'Prospecção',
  'prospeccao-email': 'Prospecção Email',
  'email-trilhas': 'Trilhas de E-mail',
  'pncp-prospeccao': 'Prospecção PNCP',
  'pncp-auto': 'Prospecção Automática',
  garimpo: 'Garimpo Automático',
  pnpc: 'PNPC',
  'seg-licitante': 'Seguro Licitante',
  'seg-contrato': 'Seguro de Contrato',
  auto: 'Seguro AUTO',
  'auto-seguradoras': 'Seguradoras AUTO',
  residential: 'Seguro Residencial / Locatícia',
  'residencial-seguradoras': 'Seguradoras Residencial',
  'residencial-garantidoras': 'Garantidoras',
  rc: 'Responsabilidade Civil',
  'rc-seguradoras': 'Seguradoras — RC',
  'metas-mensais': 'Metas Mensais',
  'metas-anuais': 'Metas Anuais',
  manual: 'Manual de Procedimentos Internos',
  agenda: 'Agenda Semanal',
  parceiros: 'Gestão de Parceiros',
  usuarios: 'Usuários do Hub',
  sureties: 'Afiançadoras',
  whatsapp: 'WhatsApp — Inbox',
  'whatsapp-blast': 'WhatsApp — Prospecção',
  'email-followup': 'Follow-up de Email',
  'imobiliaria-repasse': 'Repasse Imobiliárias',
  'garantia-locaticia': 'Garantia Locatícia',
  'inadimplentes': 'Inadimplentes — Residencial',
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

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [unreadWhatsApp, setUnreadWhatsApp] = useState(0);
  // Módulos liberados para quem está logado. `null` = vê tudo.
  const [modulos, setModulos] = useState<string[] | null>(null);
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
      const { count: vencCount } = await supabase
        .from('residential_clients')
        .select('*', { count: 'exact', head: true })
        .eq('situacao', 'Ativo')
        .gte('fim_vigencia', hoje)
        .lte('fim_vigencia', em30);

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
  // Cliente vindo do Repasse Imobiliárias para o cadastro Residencial / Locatícia.
  // Estado separado de pendingSale de propósito: aquele alimenta a tela de
  // Garantia (usada pelo WhatsApp Hub) e os dois fluxos não se misturam.
  const [pendingResidential, setPendingResidential] = useState<{ nome: string; telefone: string } | null>(null);
  const activeViewRef = React.useRef<View>('dashboard');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    garantia: false,
    prospeccao: false,
    cotacoes: false,
    financeiro: false,
    auto: false,
    residencial: false,
    rc: false,
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
    if (!session) { setModulos(null); return; }
    carregarModulos(session.user?.email).then(setModulos);
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
            new Notification(`WhatsApp — ${name}`, {
              body: msg.length > 80 ? msg.substring(0, 80) + '…' : msg,
              icon: '/logo.svg',
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session]);

  // Auto-expand the group that contains the active view
  useEffect(() => {
    if (GARANTIA_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, garantia: true }));
    if (['prospeccao', 'pncp-prospeccao', 'pncp-auto', 'garimpo', 'pnpc'].includes(activeView)) setOpenGroups(prev => ({ ...prev, garantia: true, prospeccao: true }));
    if (['seg-licitante', 'seg-contrato'].includes(activeView)) setOpenGroups(prev => ({ ...prev, garantia: true, cotacoes: true }));
    if (FINANCEIRO_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, financeiro: true }));
    if (AUTO_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, auto: true }));
    if (RESIDENCIAL_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, residencial: true }));
    if (RC_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, rc: true }));
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
    if (view !== 'residential') setPendingResidential(null);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="relative">
          <div className="w-24 h-24 border-4 border-[#C69C6D]/20 border-t-[#C69C6D] rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center text-[#C69C6D] font-black text-xl">FG</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Auth onSessionUpdate={() => { }} />;
  }

  const Logo = () => (
    <div className="flex items-center justify-center">
      <img src="/logo.svg" alt="F&G Corretora" className="h-20 w-auto object-contain" />
    </div>
  );

  // ── Plain top-level nav item ────────────────────────────────────
  const NavItem: React.FC<{ view: View; icon: React.ReactNode; label: string; badge?: number }> = ({ view, icon, label, badge }) => (
    <button
      onClick={() => navigate(view)}
      className={`flex items-center justify-between w-full px-4 py-3 rounded-2xl transition-all duration-300 group ${
        activeView === view
          ? 'bg-[#C69C6D] text-[#1B263B] shadow-2xl shadow-[#C69C6D]/25'
          : 'text-slate-300 hover:bg-[#243347] hover:text-[#F5F1EA]'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`${activeView === view ? 'text-[#1B263B]' : 'text-slate-400 group-hover:text-[#C69C6D]'} transition-colors`}>{icon}</span>
        <span className="font-bold text-[12px] tracking-tight whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {badge != null && badge > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 bg-emerald-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {activeView === view && <ChevronRight size={12} className="opacity-70" />}
      </div>
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
          className={`flex items-center justify-between w-full px-4 py-3 rounded-2xl transition-all duration-300 group ${
            isGroupActive
              ? 'bg-[#243347] text-white'
              : 'text-slate-300 hover:bg-[#243347] hover:text-[#F5F1EA]'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className={`${isGroupActive ? 'text-[#C69C6D]' : 'text-slate-400 group-hover:text-[#C69C6D]'} transition-colors`}>{icon}</span>
            <span className="font-bold text-[12px] tracking-tight whitespace-nowrap">{label}</span>
          </div>
          <ChevronDown
            size={12}
            className={`text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {isOpen && (
          <div className="mt-1 ml-3 pl-3 border-l-2 border-[#C69C6D]/20 space-y-0.5 py-1">
            {children}
          </div>
        )}
      </div>
    );
  };

  // ── Sub-item inside a group ──────────────────────────────────────
  const NavSubItem: React.FC<{ view: View; label: string; badge?: number }> = ({ view, label, badge }) => (
    <button
      onClick={() => navigate(view)}
      className={`flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all text-[11px] font-bold tracking-tight ${
        activeView === view
          ? 'bg-[#C69C6D] text-[#1B263B] shadow-md shadow-[#C69C6D]/20'
          : 'text-slate-400 hover:text-[#F5F1EA] hover:bg-[#243347]'
      }`}
    >
      <span>{label}</span>
      {badge != null && badge > 0 && <BadgeDot count={badge} />}
    </button>
  );

  // ── Collapsible sub-group inside a NavGroup ───────────────────────
  const NavSubGroup: React.FC<{
    groupKey: string;
    label: string;
    isGroupActive: boolean;
    children: React.ReactNode;
  }> = ({ groupKey, label, isGroupActive, children }) => {
    const isOpen = openGroups[groupKey];
    return (
      <div>
        <button
          onClick={() => toggleGroup(groupKey)}
          className={`flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all text-[11px] font-bold tracking-tight ${
            isGroupActive
              ? 'text-[#C69C6D] bg-[#1a2d45]'
              : 'text-slate-400 hover:text-[#F5F1EA] hover:bg-[#243347]'
          }`}
        >
          <span>{label}</span>
          <ChevronDown size={10} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="mt-0.5 ml-3 pl-3 border-l border-[#C69C6D]/15 space-y-0.5 py-0.5">
            {children}
          </div>
        )}
      </div>
    );
  };

  return (
    <ToastProvider>
    {/* Passa por navigate() para a busca global respeitar a permissão. */}
    <GlobalSearch onNavigate={(view) => navigate(view as View)} />
    <div className="min-h-screen flex bg-[#F5F1EA] font-sans selection:bg-[#C69C6D]/30">
      {/* Overlay mobile — fecha sidebar ao clicar fora */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#1B263B] transform transition-transform duration-500 ease-in-out lg:relative lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } no-print shadow-2xl border-r border-[#C69C6D]/20 h-screen`}
      >
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 custom-scroll">
            <div className="mb-8 flex justify-center">
              <Logo />
            </div>

            <nav className="space-y-1">
              <NavItem view="dashboard" icon={<LayoutDashboard size={16} />} label="Visão Geral" />

              {/* ── Seguro Garantia ─────────────────────── */}
              {podeModulo('garantia') && (
              <NavGroup
                groupKey="garantia"
                icon={<ShieldCheck size={16} />}
                label="Seguro Garantia"
                isGroupActive={GARANTIA_VIEWS.includes(activeView) || FINANCEIRO_VIEWS.includes(activeView)}
              >
                {/* Cotações (Seguro Licitante / Seguro de Contrato) — fora do menu por enquanto.
                    Só o acesso pelo sidebar saiu: as views, os analisadores e o roteamento
                    continuam de pé. Para trazer de volta, basta descomentar este bloco.
                <NavSubGroup
                  groupKey="cotacoes"
                  label="Cotações"
                  isGroupActive={['seg-licitante', 'seg-contrato'].includes(activeView)}
                >
                  <NavSubItem view="seg-licitante" label="Seguro Licitante" />
                  <NavSubItem view="seg-contrato" label="Seguro de Contrato" />
                </NavSubGroup>
                */}
                <NavSubItem view="goals" label="Registro de Vendas" />
                <NavSubItem view="carteira" label="Carteira de Clientes" />
                <NavSubGroup
                  groupKey="prospeccao"
                  label="Prospecção"
                  isGroupActive={['prospeccao', 'prospeccao-email', 'email-trilhas', 'pncp-prospeccao', 'pncp-auto', 'garimpo', 'pnpc'].includes(activeView)}
                >
                  <NavSubItem view="prospeccao" label="Prospecção Ativa" />
                  <NavSubItem view="prospeccao-email" label="Prospecção Email" />
                  <NavSubItem view="email-trilhas" label="Trilhas de E-mail" />
                  <NavSubItem view="pncp-prospeccao" label="Prospecção PNCP" />
                  <NavSubItem view="pncp-auto" label="Prospecção Automática" />
                  <NavSubItem view="garimpo" label="Garimpo Automático" />
                  <NavSubItem view="pnpc" label="PNPC" />
                </NavSubGroup>
                <NavSubItem view="directory" label="Seguradoras" />
                <NavSubItem view="banks" label="Bancos Garantidores" />
                <NavSubItem view="letter" label="Carta de Nomeação" />
                <NavSubItem view="calculator" label="Cálculo de Garantia" />
                <NavSubItem view="endosso-allseg" label="Endosso Allseg" />
              </NavGroup>
              )}

              {/* ── Seguro AUTO ─────────────────────────── */}
              {podeModulo('auto') && (
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

              {/* ── Seguro Residencial ──────────────────── */}
              {podeModulo('residencial') && (
              <NavGroup
                groupKey="residencial"
                icon={<Home size={16} />}
                label="Residencial / Locatícia"
                isGroupActive={RESIDENCIAL_VIEWS.includes(activeView)}
              >
                <NavSubItem view="residential" label="Registro de Vendas" badge={badges.vencimentos} />
                <NavSubItem view="residencial-seguradoras" label="Seguradoras" />
                <NavSubItem view="residencial-garantidoras" label="Garantidoras" />
                <NavSubItem view="imobiliaria-repasse" label="Repasse Imobiliárias" badge={badges.imobiliaria} />
                <FeatureTip
                  id="garantia-calc-2026"
                  title="Calculadora de Garantia"
                  description="Simule o valor da garantia locatícia em segundos e gere a mensagem pronta para o cliente."
                  position="right"
                >
                  <NavSubItem view="garantia-locaticia" label="Garantia Locatícia" />
                </FeatureTip>
                <NavSubItem view="inadimplentes" label="Inadimplentes" />
              </NavGroup>
              )}

              {/* ── Responsabilidade Civil ──────────────── */}
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

              {/* ── Gestão Financeira ────────────────────── */}
              {podeModulo('financeiro') && (
              <NavGroup
                groupKey="financeiro"
                icon={<Target size={16} />}
                label="Gestão Financeira"
                isGroupActive={FINANCEIRO_VIEWS.includes(activeView)}
              >
                <NavSubItem view="metas-mensais" label="Metas Mensais" />
                <NavSubItem view="metas-anuais" label="Metas Anuais" />
              </NavGroup>
              )}

              {podeModulo('whatsapp') && (
              <FeatureTip
                id="whatsapp-hub-2026"
                title="WhatsApp Hub integrado"
                description="Gerencie todas as conversas, envie mensagens em massa e vincule contatos ao CRM direto por aqui."
              >
                <NavGroup
                  groupKey="whatsapp"
                  icon={<MessageSquare size={16} />}
                  label="WhatsApp"
                  isGroupActive={['whatsapp', 'whatsapp-blast'].includes(activeView)}
                >
                  <NavSubItem view="whatsapp" label={`Inbox${unreadWhatsApp > 0 ? ` (${unreadWhatsApp})` : ''}`} />
                  <NavSubItem view="whatsapp-blast" label="Prospecção" />
                </NavGroup>
              </FeatureTip>
              )}

              {podeModulo('email-followup') && <NavItem view="email-followup" icon={<Mail size={16} />} label="Follow-up de Email" />}
              {podeModulo('manual') && <NavItem view="manual" icon={<FileText size={16} />} label="Manual de Procedimentos" />}
              {podeModulo('agenda') && <NavItem view="agenda" icon={<Calendar size={16} />} label="Agenda" />}
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
              {session?.user?.email === ADMIN_EMAIL && (
                <NavItem view="usuarios" icon={<ShieldCheck size={16} />} label="Usuários do Hub" />
              )}
            </nav>
          </div>

          <div className="shrink-0 mt-auto p-6 bg-[#162033] space-y-3">
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
                <div className="flex items-center gap-2 px-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-[10px] text-slate-500 font-mono">build {fmt}</span>
                </div>
              );
            })()}
            <button
              onClick={handleLogout}
              className="group flex items-center gap-3 text-slate-300 hover:text-[#C69C6D] transition-all text-sm font-bold w-full px-5 py-3 rounded-2xl hover:bg-[#243347]"
            >
              <LogOut size={14} className="group-hover:rotate-12 transition-transform" />
              <span>Encerrar Acesso</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="bg-[#F8F4ED]/95 backdrop-blur-md border-b border-[#C69C6D]/25 flex items-center justify-between px-3 lg:px-8 no-print shrink-0 z-30" style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 'calc(3.5rem + env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2 lg:gap-4 min-w-0">
            <button
              className="lg:hidden p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-all shrink-0"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="min-w-0">
              <h2 className="text-[#1B263B] font-black text-base lg:text-xl tracking-tight truncate">
                {VIEW_TITLES[activeView]}
              </h2>
              <p className="hidden sm:block text-[10px] text-[#6E7785] font-bold uppercase tracking-widest mt-0.5 truncate">
                Sessão Ativa: {session?.user?.email?.split('@')[0]}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4 shrink-0">
            <div className="hidden md:flex items-center gap-2 bg-[#EFE7DB] px-3 py-1.5 rounded-xl border border-[#C69C6D]/25">
              <div className="w-1.5 h-1.5 rounded-full bg-[#C69C6D] animate-pulse"></div>
              <span className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">Online</span>
            </div>
            {/* Busca: ícone no mobile, botão completo no desktop */}
            <button
              onMouseDown={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              className="flex items-center gap-2 p-2 sm:px-4 sm:py-2 bg-[#f4f1ec] border border-[#e8e4dc] rounded-xl cursor-pointer text-[#78716c] hover:bg-[#ede9e1] transition-all"
            >
              <Search size={15} />
              <span className="hidden sm:inline text-sm font-semibold">Buscar</span>
              <kbd className="hidden sm:inline text-[10px] bg-[#e8e4dc] rounded px-1 text-[#94a3b8]">⌘K</kbd>
            </button>
            <button className="p-2 text-slate-400 hover:text-[#C69C6D] transition-all relative">
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-white"></span>
            </button>
            <div className="hidden sm:block h-8 w-[1px] bg-[#C69C6D]/30"></div>
            <div className="hidden sm:flex items-center gap-3 group cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-[#1B263B] flex items-center justify-center text-[#C69C6D] shadow-md group-hover:scale-105 transition-transform">
                <User size={18} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8 custom-scroll bg-[#F5F1EA]/80">
          {/* Limite largo para aproveitar monitores grandes, sem esticar ao infinito em ultrawide */}
          <div className="max-w-[1800px] mx-auto pb-20 lg:pb-16">

            {/* ── Visão Geral ──────────────────────────────────── */}
            {activeView === 'dashboard' && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-[#1B263B] rounded-[1.5rem] lg:rounded-[2.5rem] p-6 lg:p-14 text-white relative overflow-hidden shadow-3xl">
                  <div className="relative z-10 grid lg:grid-cols-2 gap-6 lg:gap-12 items-center">
                    <div>
                      <div className="inline-flex items-center gap-2 bg-[#C69C6D]/20 text-[#C69C6D] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-4 lg:mb-6 border border-[#C69C6D]/20">
                        <Zap size={11} fill="currentColor" />
                        Hub F&G v2.7
                      </div>
                      <h1 className="text-2xl sm:text-3xl lg:text-5xl font-black mb-3 lg:mb-6 tracking-tighter leading-tight">
                        Eficiência em <br /><span className="text-[#C69C6D]">Seguros Corporativos.</span>
                      </h1>
                      <p className="text-slate-400 max-w-lg text-sm lg:text-base leading-relaxed font-medium hidden sm:block">
                        O Hub centralizado da F&G Corretora permite que você gerencie cálculos, documentos e metas com precisão absoluta.
                      </p>
                      <div className="mt-5 lg:mt-8 flex flex-wrap gap-3">
                        <button onClick={() => navigate('goals')} className="bg-[#C69C6D] text-white px-5 py-3 lg:px-8 lg:py-4 rounded-xl lg:rounded-2xl font-black hover:bg-[#b58a5b] transition-all shadow-xl shadow-[#C69C6D]/20 active:scale-95 flex items-center gap-2 text-sm">
                          Registro de Vendas <ChevronRight size={14} />
                        </button>
                        <button onClick={() => navigate('goals')} className="bg-white/5 text-white border border-white/10 px-5 py-3 lg:px-8 lg:py-4 rounded-xl lg:rounded-2xl font-black hover:bg-white/10 transition-all text-sm">Performance</button>
                      </div>
                    </div>
                    <div className="hidden lg:flex justify-end">
                      <div className="relative">
                        <div className="w-64 h-64 bg-gradient-to-br from-[#C69C6D] to-[#1B263B] rounded-[4rem] flex items-center justify-center shadow-2xl p-0.5 rotate-3">
                          <div className="bg-[#1B263B] w-full h-full rounded-[3.8rem] flex items-center justify-center -rotate-3 overflow-hidden">
                            <ShieldCheck size={112} className="text-[#C69C6D] opacity-40" />
                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent"></div>
                          </div>
                        </div>
                        <div className="absolute -bottom-4 -left-4 bg-white p-4 rounded-2xl shadow-2xl animate-bounce duration-[3000ms]">
                          <Target size={26} className="text-[#C69C6D]" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -right-20 -top-20 w-96 h-96 bg-[#C69C6D] opacity-[0.05] rounded-full blur-[100px] pointer-events-none"></div>
                  <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-[#C69C6D] opacity-[0.05] rounded-full blur-[100px] pointer-events-none"></div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-6 px-2">
                    <h3 className="text-xl font-black text-slate-800 tracking-tight">Atalhos Operacionais</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {([
                      { title: 'Garantia', desc: 'Registro de Vendas', icon: <FileText size={22} />, view: 'goals' as View, color: 'bg-indigo-50 text-indigo-600' },
                      { title: 'Residencial', desc: 'Registro de Clientes', icon: <Home size={22} />, view: 'residential' as View, color: 'bg-emerald-50 text-emerald-600' },
                      { title: 'WhatsApp', desc: 'Central de Mensagens', icon: <Users size={22} />, view: 'whatsapp' as View, color: 'bg-amber-50 text-amber-600' },
                      { title: 'Parceiros', desc: 'Acessos & Portais', icon: <Users size={22} />, view: 'parceiros' as View, color: 'bg-slate-100 text-[#1B263B]' },
                    ] as { title: string; desc: string; icon: React.ReactNode; view: View; color: string }[])
                      // Atalho para tela sem permissão vira botão morto — some.
                      .filter(item => podeVer(item.view))
                      .map((item, idx) => (
                      <button key={idx} onClick={() => navigate(item.view)}
                        className="bg-white p-8 rounded-[2rem] border border-slate-100 hover:border-[#C69C6D] hover:shadow-lg transition-all duration-300 text-left group flex flex-col relative overflow-hidden">
                        <div className={`${item.color} w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-all duration-300 shadow-sm`}>
                          {item.icon}
                        </div>
                        <h3 className="font-black text-slate-800 text-xl mb-2 tracking-tighter">{item.title}</h3>
                        <p className="text-[11px] text-slate-400 uppercase font-black tracking-widest opacity-80">{item.desc}</p>
                        <div className="mt-8 pt-6 border-t border-slate-50 flex justify-between items-center">
                          <span className="text-xs font-black text-[#C69C6D] uppercase tracking-widest group-hover:translate-x-1 transition-transform">Abrir Módulo</span>
                          <ChevronRight size={13} className="text-slate-300 group-hover:text-[#C69C6D] transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-6 px-2">
                    <h3 className="text-xl font-black text-slate-800 tracking-tight">Portais Públicos</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Links para enviar aos clientes/parceiros</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Portal do Parceiro', desc: 'Acesso dos parceiros comerciais ao relatório de comissões', url: 'https://hub.fegsegurogarantia.com/parceiros-login.html', icon: '🤝' },
                      { label: 'Portal da Imobiliária', desc: 'Acesso das imobiliárias parceiras ao portal de clientes', url: 'https://hub.fegsegurogarantia.com/imobiliaria.html', icon: '🏠' },
                    ].map((portal, idx) => (
                      <div key={idx} className="bg-white rounded-2xl border border-slate-100 p-4 lg:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="text-xl shrink-0">{portal.icon}</div>
                          <div className="min-w-0">
                            <p className="font-black text-slate-800 text-sm">{portal.label}</p>
                            <p className="text-xs text-slate-400 font-medium mt-0.5 hidden sm:block">{portal.desc}</p>
                            <a href={portal.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#C69C6D] font-bold hover:underline mt-0.5 block truncate max-w-[220px]">
                              {portal.url.replace('https://', '')}
                            </a>
                          </div>
                        </div>
                        <button onClick={() => navigator.clipboard.writeText(portal.url)} className="shrink-0 text-xs font-black px-4 py-2.5 min-h-[40px] bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl transition-all">
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
              {/* Seguro Garantia */}
              {vista === 'goals' && <ResultsDashboard key="goals" initialSection="sales" initialSaleData={pendingSale ?? undefined} />}
              {vista === 'carteira' && <ResultsDashboard key="carteira" initialSection="carteira" hideTabs />}
              {vista === 'prospeccao' && <ResultsDashboard key="prospeccao" initialSection="prospects" hideTabs />}
              {vista === 'prospeccao-email' && <ProspeccaoEmail />}
              {vista === 'email-trilhas' && <EmailTrilhas />}
              {vista === 'pncp-prospeccao' && <PncpProspection />}
              {vista === 'pncp-auto' && <ProspeccaoPncpAuto />}
              {vista === 'garimpo' && <GarimpoAutomatico />}
              {vista === 'pnpc' && <ResultsDashboard key="pnpc" initialSection="pnpc" hideTabs />}
              {vista === 'seg-licitante' && <ResultsDashboard key="seg-licitante" initialSection="licitante" hideTabs onVerVendas={() => navigate('goals')} />}
              {vista === 'seg-contrato' && <ResultsDashboard key="seg-contrato" initialSection="contrato" hideTabs onVerVendas={() => navigate('goals')} />}
              {vista === 'metas-mensais' && <ResultsDashboard key="metas-mensais" initialSection="goals" hideTabs />}
              {vista === 'metas-anuais' && <ResultsDashboard key="metas-anuais" initialSection="annualGoals" hideTabs />}
              {vista === 'directory' && (
                <InsuranceDirectory
                  tableName="insurers"
                  title="Seguradoras — Garantia"
                  subtitle="Gerenciamento centralizado de acessos e condições comerciais."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}
              {vista === 'banks' && <BanksDirectory />}
              {vista === 'letter' && <NominationLetter />}
              {vista === 'calculator' && <Calculator />}
              {vista === 'endosso-allseg' && <EndossoAllseg />}

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
              {vista === 'residential' && <ResidentialInsurance prefill={pendingResidential} onPrefillConsumed={() => setPendingResidential(null)} />}
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
              {vista === 'imobiliaria-repasse' && <ImobiliariaRepasse onGoToSale={(data) => { setPendingResidential(data); navigate('residential'); }} />}
              {vista === 'garantia-locaticia' && <GarantiaLocaticia />}
              {vista === 'inadimplentes' && <InadimplentesResidencial />}
              {vista === 'rc' && <RCInsurance />}
              {vista === 'rc-seguradoras' && (
                <InsuranceDirectory
                  tableName="seguradoras_rc"
                  title="Seguradoras — RC"
                  subtitle="Portais, acessos e condições para responsabilidade civil."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}

              {/* Outros */}
              {vista === 'whatsapp' && <WhatsAppHub onGoToSale={(data) => { setPendingSale(data); navigate('goals'); }} />}
              {vista === 'whatsapp-blast' && <WhatsAppBlast />}
              {vista === 'email-followup' && <EmailFollowUp />}
              {vista === 'sureties' && <SuretiesDirectory />}
              {vista === 'manual' && <InternalProcedures />}
              {vista === 'agenda' && <AgendaHub />}
              {vista === 'parceiros' && <ParceiroManager />}
              {vista === 'usuarios' && <UserManager />}
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
