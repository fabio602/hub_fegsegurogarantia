
import React, { useState, useEffect } from 'react';
import {
  Calculator as CalcIcon,
  FileText,
  Target,
  ShieldCheck,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  ChevronRight,
  User,
  Bell,
  Loader2,
  ExternalLink as ExternalLinkIcon,
  Zap,
  ArrowUpRight,
  Home,
  Landmark,
  Scale
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

type View = 'dashboard' | 'calculator' | 'letter' | 'goals' | 'directory' | 'manual' | 'residential' | 'banks' | 'sureties';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
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
    <div className="flex items-center gap-3">
      <div className="relative w-10 h-10 flex items-center justify-center">
        <div className="absolute inset-0 bg-[#C69C6D] rounded-2xl rotate-6 opacity-20"></div>
        <div className="absolute inset-0 bg-[#1B263B] rounded-2xl shadow-lg flex items-center justify-center border border-[#C69C6D]/30">
          <span className="text-[#C69C6D] font-black text-base">FG</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-white font-black leading-none text-xl tracking-tighter">F&G</span>
        <span className="text-[#C69C6D] text-[10px] font-bold uppercase tracking-[3px] mt-0.5">Corretora</span>
      </div>
    </div>
  );

  const NavItem: React.FC<{ view: View; icon: React.ReactNode; label: string }> = ({ view, icon, label }) => (
    <button
      onClick={() => {
        setActiveView(view);
        if (window.innerWidth < 1024) setIsSidebarOpen(false);
      }}
        className={`flex items-center justify-between w-full px-4 py-3 rounded-2xl transition-all duration-400 group ${activeView === view
        ? 'bg-[#C69C6D] text-white shadow-2xl shadow-[#C69C6D]/30'
        : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
    >
      <div className="flex items-center gap-3">
        <span className={`${activeView === view ? 'text-white' : 'text-slate-500 group-hover:text-[#C69C6D]'} transition-colors duration-300`}>{icon}</span>
        <span className="font-bold text-[12px] tracking-tight whitespace-nowrap">{label}</span>
      </div>
      {activeView === view && <ChevronRight size={12} className="opacity-70" />}
    </button>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans selection:bg-[#C69C6D]/30">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#1B263B] transform transition-transform duration-500 ease-in-out lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } no-print shadow-2xl border-r border-white/5 h-screen`}
      >
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 custom-scroll">
            <div className="mb-8">
              <Logo />
            </div>

            <nav className="space-y-1">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[4px] px-5 mb-4 opacity-40">Módulos do Sistema</p>
              <NavItem view="dashboard" icon={<LayoutDashboard size={16} />} label="Visão Geral" />
              <NavItem view="calculator" icon={<CalcIcon size={16} />} label="Cálculo de Garantia" />
              <NavItem view="letter" icon={<FileText size={16} />} label="Carta de Nomeação" />
              <NavItem view="goals" icon={<Target size={16} />} label="Seguro Garantia" />
              <NavItem view="residential" icon={<Home size={16} />} label="Seguro Residencial/Locatícia" />
              <NavItem view="directory" icon={<ShieldCheck size={16} />} label="Seguradoras" />
              <NavItem view="banks" icon={<Landmark size={16} />} label="Bancos Garantidores" />
              <NavItem view="sureties" icon={<Scale size={16} />} label="Afiançadoras" />
              <NavItem view="manual" icon={<FileText size={16} />} label="Manual de Procedimentos" />

              <div className="pt-6 mt-6 border-t border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[4px] px-5 mb-4 opacity-40">Acessos Externos</p>
                <a
                  href="https://crm-perfexcrm.a1dttr.easypanel.host/admin/authentication"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full px-5 py-3 rounded-2xl transition-all duration-300 group text-slate-400 hover:bg-white/5 border border-transparent hover:border-white/10"
                >
                  <div className="flex items-center gap-3">
                    <ExternalLinkIcon size={16} className="text-slate-500 group-hover:text-[#C69C6D]" />
                    <span className="font-bold text-[13px] tracking-tight">Portal CRM Perfex</span>
                  </div>
                  <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-70 transition-opacity" />
                </a>
              </div>
            </nav>
          </div>

          <div className="shrink-0 mt-auto p-6 bg-black/10">
            <button
              onClick={handleLogout}
              className="group flex items-center gap-3 text-slate-500 hover:text-red-400 transition-all text-sm font-bold w-full px-5 py-3 rounded-2xl hover:bg-red-500/10"
            >
              <LogOut size={14} className="group-hover:rotate-12 transition-transform" />
              <span>Encerrar Acesso</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-6 lg:px-8 no-print shrink-0 z-30">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div>
              <h2 className="text-slate-800 font-black text-xl tracking-tight">
                {activeView === 'dashboard' && 'Bem-vindo ao Hub F&G'}
                {activeView === 'calculator' && 'Calculadora de Seguros'}
                {activeView === 'letter' && 'Gerador de Nomeação'}
                {activeView === 'goals' && 'Gestão de Resultados'}
                {activeView === 'residential' && 'Seguro Residencial / Locatícia'}
                {activeView === 'directory' && 'Ecossistema Seguradoras'}
                {activeView === 'banks' && 'Bancos Garantidores'}
                {activeView === 'sureties' && 'Afiançadoras'}
                {activeView === 'manual' && 'Manual de Procedimentos Internos'}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Sessão Ativa: {session?.user?.email?.split('@')[0]}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Servidor Online</span>
            </div>
            <button className="p-2 text-slate-400 hover:text-[#C69C6D] transition-all relative">
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-white"></span>
            </button>
            <div className="h-8 w-[1px] bg-slate-200"></div>
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-[#1B263B] flex items-center justify-center text-[#C69C6D] shadow-md group-hover:scale-105 transition-transform">
                <User size={18} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 lg:p-8 custom-scroll bg-slate-50/50">
          <div className="max-w-[1400px] mx-auto pb-16">
            {activeView === 'dashboard' && (
              <div className="space-y-8 animate-fade-in">
                {/* Hero Section */}
                <div className="bg-[#1B263B] rounded-[2.5rem] p-8 lg:p-14 text-white relative overflow-hidden shadow-3xl">
                  <div className="relative z-10 grid lg:grid-cols-2 gap-12 items-center">
                    <div>
                      <div className="inline-flex items-center gap-2 bg-[#C69C6D]/20 text-[#C69C6D] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest mb-6 border border-[#C69C6D]/20">
                        <Zap size={11} fill="currentColor" />
                        Acesso Master v2.6
                      </div>
                      <h1 className="text-4xl lg:text-5xl font-black mb-6 tracking-tighter leading-[0.9]">
                        Eficiência em <br /><span className="text-[#C69C6D]">Seguros Corporativos.</span>
                      </h1>
                      <p className="text-slate-400 max-w-lg text-base leading-relaxed font-medium">
                        O Hub centralizado da F&G Corretora permite que você gerencie cálculos, documentos e metas com precisão absoluta.
                      </p>
                      <div className="mt-8 flex flex-wrap gap-4">
                        <button onClick={() => setActiveView('calculator')} className="bg-[#C69C6D] text-white px-8 py-4 rounded-2xl font-black hover:bg-[#b58a5b] transition-all shadow-xl shadow-[#C69C6D]/20 active:scale-95 flex items-center gap-2">
                          Começar Agora <ChevronRight size={14} />
                        </button>
                        <button onClick={() => setActiveView('goals')} className="bg-white/5 text-white border border-white/10 px-8 py-4 rounded-2xl font-black hover:bg-white/10 transition-all">Analisar Performance</button>
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
                  {/* Decorative Elements */}
                  <div className="absolute -right-20 -top-20 w-96 h-96 bg-[#C69C6D] opacity-[0.05] rounded-full blur-[100px] pointer-events-none"></div>
                  <div className="absolute -left-20 -bottom-20 w-96 h-96 bg-[#C69C6D] opacity-[0.05] rounded-full blur-[100px] pointer-events-none"></div>
                </div>

                {/* Quick Access Grid */}
                <div>
                  <div className="flex items-center justify-between mb-6 px-2">
                    <h3 className="text-xl font-black text-slate-800 tracking-tight">Atalhos Operacionais</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Última atualização: Hoje</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                      { title: 'Calculadora', desc: 'Precificação Garantia', icon: <CalcIcon size={22} />, view: 'calculator', color: 'bg-indigo-50 text-indigo-600' },
                      { title: 'Nomeação', desc: 'Relatório em PDF', icon: <FileText size={22} />, view: 'letter', color: 'bg-amber-50 text-amber-600' },
                      { title: 'Performance', desc: 'KPIs & PLR 2026', icon: <Target size={22} />, view: 'goals', color: 'bg-emerald-50 text-emerald-600' },
                      { title: 'Parceiros', desc: 'Acessos & Portais', icon: <ShieldCheck size={22} />, view: 'directory', color: 'bg-slate-100 text-[#1B263B]' },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveView(item.view as View)}
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
              </div>
            )}

            <div className="animate-fade-in">
              {activeView === 'calculator' && <Calculator />}
              {activeView === 'letter' && <NominationLetter />}
              {activeView === 'goals' && <ResultsDashboard />}
              {activeView === 'residential' && <ResidentialInsurance />}
              {activeView === 'directory' && <InsuranceDirectory tableName="insurers" title="Base de Seguradoras" subtitle="Gerenciamento centralizado de acessos e condições comerciais." itemName="Seguradora" emptyStateText="Adicionar Seguradora" />}
              {activeView === 'banks' && <BanksDirectory />}
              {activeView === 'sureties' && <SuretiesDirectory />}
              {activeView === 'manual' && <InternalProcedures />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
