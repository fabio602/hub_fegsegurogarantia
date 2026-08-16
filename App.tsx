
import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { supabase } from './lib/supabase';
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

type View =
  | 'dashboard'
  // Seguro Garantia
  | 'goals' | 'directory' | 'banks' | 'letter' | 'calculator' | 'endosso-allseg'
  // Seguro AUTO
  | 'auto' | 'auto-seguradoras'
  // Seguro Residencial
  | 'residential' | 'residencial-seguradoras' | 'residencial-garantidoras'
  // Outros
  | 'manual' | 'agenda' | 'parceiros' | 'usuarios' | 'sureties';

const GARANTIA_VIEWS: View[] = ['goals', 'directory', 'banks', 'letter', 'calculator', 'endosso-allseg'];
const AUTO_VIEWS: View[] = ['auto', 'auto-seguradoras'];
const RESIDENCIAL_VIEWS: View[] = ['residential', 'residencial-seguradoras', 'residencial-garantidoras'];

const VIEW_TITLES: Record<View, string> = {
  dashboard: 'Bem-vindo ao Hub F&G',
  goals: 'Gestão de Resultados',
  directory: 'Seguradoras — Garantia',
  banks: 'Bancos Garantidores',
  letter: 'Gerador de Nomeação',
  calculator: 'Calculadora de Seguros',
  'endosso-allseg': 'Pedido de Endosso — Allseg',
  auto: 'Seguro AUTO',
  'auto-seguradoras': 'Seguradoras AUTO',
  residential: 'Seguro Residencial / Locatícia',
  'residencial-seguradoras': 'Seguradoras Residencial',
  'residencial-garantidoras': 'Garantidoras',
  manual: 'Manual de Procedimentos Internos',
  agenda: 'Agenda Semanal',
  parceiros: 'Gestão de Parceiros',
  usuarios: 'Usuários do Hub',
  sureties: 'Afiançadoras',
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    garantia: false,
    auto: false,
    residencial: false,
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

  // Auto-expand the group that contains the active view
  useEffect(() => {
    if (GARANTIA_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, garantia: true }));
    if (AUTO_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, auto: true }));
    if (RESIDENCIAL_VIEWS.includes(activeView)) setOpenGroups(prev => ({ ...prev, residencial: true }));
  }, [activeView]);

  const toggleGroup = (key: string) =>
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const navigate = (view: View) => {
    setActiveView(view);
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
  const NavItem: React.FC<{ view: View; icon: React.ReactNode; label: string }> = ({ view, icon, label }) => (
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
      {activeView === view && <ChevronRight size={12} className="opacity-70" />}
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
  const NavSubItem: React.FC<{ view: View; label: string }> = ({ view, label }) => (
    <button
      onClick={() => navigate(view)}
      className={`flex items-center w-full px-4 py-2.5 rounded-xl transition-all text-[11px] font-bold tracking-tight ${
        activeView === view
          ? 'bg-[#C69C6D] text-[#1B263B] shadow-md shadow-[#C69C6D]/20'
          : 'text-slate-400 hover:text-[#F5F1EA] hover:bg-[#243347]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen flex bg-[#F5F1EA] font-sans selection:bg-[#C69C6D]/30">
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
              <NavGroup
                groupKey="garantia"
                icon={<ShieldCheck size={16} />}
                label="Seguro Garantia"
                isGroupActive={GARANTIA_VIEWS.includes(activeView)}
              >
                <NavSubItem view="goals" label="Gestão Comercial" />
                <NavSubItem view="directory" label="Seguradoras" />
                <NavSubItem view="banks" label="Bancos Garantidores" />
                <NavSubItem view="letter" label="Carta de Nomeação" />
                <NavSubItem view="calculator" label="Cálculo de Garantia" />
                <NavSubItem view="endosso-allseg" label="Endosso Allseg" />
              </NavGroup>

              {/* ── Seguro AUTO ─────────────────────────── */}
              <NavGroup
                groupKey="auto"
                icon={<Car size={16} />}
                label="Seguro AUTO"
                isGroupActive={AUTO_VIEWS.includes(activeView)}
              >
                <NavSubItem view="auto" label="Gestão Comercial" />
                <NavSubItem view="auto-seguradoras" label="Seguradoras" />
              </NavGroup>

              {/* ── Seguro Residencial ──────────────────── */}
              <NavGroup
                groupKey="residencial"
                icon={<Home size={16} />}
                label="Residencial / Locatícia"
                isGroupActive={RESIDENCIAL_VIEWS.includes(activeView)}
              >
                <NavSubItem view="residential" label="Gestão Comercial" />
                <NavSubItem view="residencial-seguradoras" label="Seguradoras" />
                <NavSubItem view="residencial-garantidoras" label="Garantidoras" />
              </NavGroup>

              <NavItem view="manual" icon={<FileText size={16} />} label="Manual de Procedimentos" />
              <NavItem view="agenda" icon={<Calendar size={16} />} label="Agenda" />
              <NavItem view="parceiros" icon={<Users size={16} />} label="Parceiros" />
              {session?.user?.email === 'fabio@fegsegurogarantia.com.br' && (
                <NavItem view="usuarios" icon={<ShieldCheck size={16} />} label="Usuários do Hub" />
              )}
            </nav>
          </div>

          <div className="shrink-0 mt-auto p-6 bg-[#162033]">
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
        <header className="h-16 bg-[#F8F4ED]/95 backdrop-blur-md border-b border-[#C69C6D]/25 flex items-center justify-between px-6 lg:px-8 no-print shrink-0 z-30">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div>
              <h2 className="text-[#1B263B] font-black text-xl tracking-tight">
                {VIEW_TITLES[activeView]}
              </h2>
              <p className="text-[10px] text-[#6E7785] font-bold uppercase tracking-widest mt-0.5">
                Sessão Ativa: {session?.user?.email?.split('@')[0]}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 bg-[#EFE7DB] px-3 py-1.5 rounded-xl border border-[#C69C6D]/25">
              <div className="w-1.5 h-1.5 rounded-full bg-[#C69C6D] animate-pulse"></div>
              <span className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">Servidor Online</span>
            </div>
            <button className="p-2 text-slate-400 hover:text-[#C69C6D] transition-all relative">
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-white"></span>
            </button>
            <div className="h-8 w-[1px] bg-[#C69C6D]/30"></div>
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-[#1B263B] flex items-center justify-center text-[#C69C6D] shadow-md group-hover:scale-105 transition-transform">
                <User size={18} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 lg:p-8 custom-scroll bg-[#F5F1EA]/80">
          <div className="max-w-[1400px] mx-auto pb-16">

            {/* ── Dashboard ─────────────────────────────────────── */}
            {activeView === 'dashboard' && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-[#1B263B] rounded-[2.5rem] p-8 lg:p-14 text-white relative overflow-hidden shadow-3xl">
                  <div className="relative z-10 grid lg:grid-cols-2 gap-12 items-center">
                    <div>
                      <div className="inline-flex items-center gap-2 bg-[#C69C6D]/20 text-[#C69C6D] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-6 border border-[#C69C6D]/20">
                        <Zap size={11} fill="currentColor" />
                        Acesso Master v2.7
                      </div>
                      <h1 className="text-4xl lg:text-5xl font-black mb-6 tracking-tighter leading-[0.9]">
                        Eficiência em <br /><span className="text-[#C69C6D]">Seguros Corporativos.</span>
                      </h1>
                      <p className="text-slate-400 max-w-lg text-base leading-relaxed font-medium">
                        O Hub centralizado da F&G Corretora permite que você gerencie cálculos, documentos e metas com precisão absoluta.
                      </p>
                      <div className="mt-8 flex flex-wrap gap-4">
                        <button onClick={() => navigate('calculator')} className="bg-[#C69C6D] text-white px-8 py-4 rounded-2xl font-black hover:bg-[#b58a5b] transition-all shadow-xl shadow-[#C69C6D]/20 active:scale-95 flex items-center gap-2">
                          Começar Agora <ChevronRight size={14} />
                        </button>
                        <button onClick={() => navigate('goals')} className="bg-white/5 text-white border border-white/10 px-8 py-4 rounded-2xl font-black hover:bg-white/10 transition-all">Analisar Performance</button>
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
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Última atualização: Hoje</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                      { title: 'Calculadora', desc: 'Precificação Garantia', icon: <CalcIcon size={22} />, view: 'calculator' as View, color: 'bg-indigo-50 text-indigo-600' },
                      { title: 'Nomeação', desc: 'Relatório em PDF', icon: <FileText size={22} />, view: 'letter' as View, color: 'bg-amber-50 text-amber-600' },
                      { title: 'Performance', desc: 'KPIs & PLR 2026', icon: <Target size={22} />, view: 'goals' as View, color: 'bg-emerald-50 text-emerald-600' },
                      { title: 'Parceiros', desc: 'Acessos & Portais', icon: <Users size={22} />, view: 'parceiros' as View, color: 'bg-slate-100 text-[#1B263B]' },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => navigate(item.view)}
                        className="bg-white p-8 rounded-[2rem] border border-slate-100 hover:border-[#C69C6D] hover:shadow-3xl transition-all duration-500 text-left group flex flex-col relative overflow-hidden"
                      >
                        <div className={`${item.color} w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-sm`}>
                          {item.icon}
                        </div>
                        <h3 className="font-black text-slate-800 text-xl mb-2 tracking-tighter">{item.title}</h3>
                        <p className="text-[11px] text-slate-400 uppercase font-black tracking-widest opacity-80">{item.desc}</p>
                        <div className="mt-8 pt-6 border-t border-slate-50 flex justify-between items-center">
                          <span className="text-xs font-black text-[#C69C6D] uppercase tracking-widest group-hover:translate-x-1 transition-transform">Abrir Módulo</span>
                          <div className="bg-slate-50 p-1.5 rounded-lg group-hover:bg-[#C69C6D] group-hover:text-white transition-all">
                            <ChevronRight size={13} />
                          </div>
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
                      { label: 'Portal de Apólices', desc: 'Cliente consulta suas apólices pelo CNPJ', url: 'https://hub.fegsegurogarantia.com/apolices.html', icon: '📄' },
                      { label: 'Portal do Parceiro', desc: 'Acesso dos parceiros comerciais ao relatório de comissões', url: 'https://hub.fegsegurogarantia.com/parceiros-login.html', icon: '🤝' },
                    ].map((portal, idx) => (
                      <div key={idx} className="bg-white rounded-2xl border border-slate-100 p-6 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="text-2xl">{portal.icon}</div>
                          <div>
                            <p className="font-black text-slate-800 text-sm">{portal.label}</p>
                            <p className="text-xs text-slate-400 font-medium mt-0.5">{portal.desc}</p>
                            <a href={portal.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#C69C6D] font-bold hover:underline mt-1 block truncate max-w-[260px]">
                              {portal.url.replace('https://', '')}
                            </a>
                          </div>
                        </div>
                        <button onClick={() => navigator.clipboard.writeText(portal.url)} className="shrink-0 text-xs font-black px-4 py-2 bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl transition-all">
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
              {activeView === 'goals' && <ResultsDashboard />}
              {activeView === 'directory' && (
                <InsuranceDirectory
                  tableName="insurers"
                  title="Seguradoras — Garantia"
                  subtitle="Gerenciamento centralizado de acessos e condições comerciais."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}
              {activeView === 'banks' && <BanksDirectory />}
              {activeView === 'letter' && <NominationLetter />}
              {activeView === 'calculator' && <Calculator />}
              {activeView === 'endosso-allseg' && <EndossoAllseg />}

              {/* Seguro AUTO */}
              {activeView === 'auto' && <AutoInsurance />}
              {activeView === 'auto-seguradoras' && (
                <InsuranceDirectory
                  tableName="seguradoras_auto"
                  title="Seguradoras AUTO"
                  subtitle="Portais, acessos e condições comerciais para o ramo auto."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}

              {/* Seguro Residencial */}
              {activeView === 'residential' && <ResidentialInsurance />}
              {activeView === 'residencial-seguradoras' && (
                <InsuranceDirectory
                  tableName="seguradoras_residencial"
                  title="Seguradoras Residencial"
                  subtitle="Portais, acessos e condições para residencial e locatícia."
                  itemName="Seguradora"
                  emptyStateText="Adicionar Seguradora"
                />
              )}
              {activeView === 'residencial-garantidoras' && (
                <InsuranceDirectory
                  tableName="garantidoras_residencial"
                  title="Garantidoras"
                  subtitle="Empresas fiançadoras para seguro locatício."
                  itemName="Garantidora"
                  emptyStateText="Adicionar Garantidora"
                />
              )}

              {/* Outros */}
              {activeView === 'sureties' && <SuretiesDirectory />}
              {activeView === 'manual' && <InternalProcedures />}
              {activeView === 'agenda' && <AgendaHub />}
              {activeView === 'parceiros' && <ParceiroManager />}
              {activeView === 'usuarios' && <UserManager />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
