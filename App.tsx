
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
    <div className="flex items-center gap-4">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className="absolute inset-0 bg-[#C69C6D] rounded-2xl rotate-6 opacity-20"></div>
        <div className="absolute inset-0 bg-[#1B263B] rounded-2xl shadow-lg flex items-center justify-center border border-[#C69C6D]/30">
          <span className="text-[#C69C6D] font-black text-lg">FG</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-white font-black leading-none text-2xl tracking-tighter">F&G</span>
        <span className="text-[#C69C6D] text-[10px] font-bold uppercase tracking-[3px] mt-1">Corretora</span>
      </div>
    </div>
  );

  const NavItem: React.FC<{ view: View; icon: React.ReactNode; label: string }> = ({ view, icon, label }) => (
    <button
      onClick={() => {
        setActiveView(view);
        if (window.innerWidth < 1024) setIsSidebarOpen(false);
      }}
      className={`flex items-center justify-between w-full px-6 py-4 rounded-2xl transition-all duration-400 group ${activeView === view
        ? 'bg-[#C69C6D] text-white shadow-2xl shadow-[#C69C6D]/30'
        : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
    >
      <div className="flex items-center gap-4">
        <span className={`${activeView === view ? 'text-white' : 'text-slate-500 group-hover:text-[#C69C6D]'} transition-colors duration-300`}>{icon}</span>
        <span className="font-bold text-[13px] tracking-tight">{label}</span>
      </div>
      {activeView === view && <ChevronRight size={14} className="opacity-70" />}
    </button>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans selection:bg-[#C69C6D]/30">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-80 bg-[#1B263B] transform transition-transform duration-500 ease-in-out lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } no-print shadow-2xl border-r border-white/5`}
      >
        <div className="flex flex-col h-full">
          <div className="p-8">
            <div className="mb-12">
              <Logo />
            </div>

            <nav className="space-y-2">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[4px] px-6 mb-6 opacity-40">Módulos do Sistema</p>
              <NavItem view="dashboard" icon={<LayoutDashboard size={20} />} label="Visão Geral" />
              <NavItem view="calculator" icon={<CalcIcon size={20} />} label="Cálculo de Garantia" />
              <NavItem view="letter" icon={<FileText size={20} />} label="Carta de Nomeação" />
              <NavItem view="goals" icon={<Target size={20} />} label="Seguro Garantia" />
              <NavItem view="residential" icon={<Home size={20} />} label="Seguro Residencial/Locatícia" />
              <NavItem view="directory" icon={<ShieldCheck size={20} />} label="Seguradoras" />
              <NavItem view="banks" icon={<Landmark size={20} />} label="Bancos Garantidores" />
              <NavItem view="sureties" icon={<Scale size={20} />} label="Afiançadoras" />
              <NavItem view="manual" icon={<FileText size={20} />} label="Manual de Procedimentos" />

              <div className="pt-8 mt-8 border-t border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[4px] px-6 mb-5 opacity-40">Acessos Externos</p>
                <a
                  href="https://crm-perfexcrm.a1dttr.easypanel.host/admin/authentication"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full px-6 py-4 rounded-2xl transition-all duration-300 group text-slate-400 hover:bg-white/5 border border-transparent hover:border-white/10"
                >
                  <div className="flex items-center gap-4">
                    <ExternalLinkIcon size={20} className="text-slate-500 group-hover:text-[#C69C6D]" />
                    <span className="font-bold text-[13px] tracking-tight">Portal CRM Perfex</span>
                  </div>
                  <ArrowUpRight size={14} className="opacity-0 group-hover:opacity-70 transition-opacity" />
                </a>
              </div>
            </nav>
          </div>

          <div className="mt-auto p-8 bg-black/10">
            <button
              onClick={handleLogout}
              className="group flex items-center gap-4 text-slate-500 hover:text-red-400 transition-all text-sm font-bold w-full px-6 py-4 rounded-2xl hover:bg-red-500/10"
            >
              <LogOut size={18} className="group-hover:rotate-12 transition-transform" />
              <span>Encerrar Acesso</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-24 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-8 lg:px-12 no-print shrink-0 z-30">
          <div className="flex items-center gap-6">
            <button
              className="lg:hidden p-3 text-slate-600 hover:bg-slate-100 rounded-2xl transition-all"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div>
              <h2 className="text-slate-800 font-black text-2xl tracking-tight">
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

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-2xl border border-slate-100">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Servidor Online</span>
            </div>
            <button className="p-3 text-slate-400 hover:text-[#C69C6D] transition-all relative">
              <Bell size={20} />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="h-10 w-[1px] bg-slate-200"></div>
            <div className="flex items-center gap-4 group cursor-pointer">
              <div className="w-12 h-12 rounded-2xl bg-[#1B263B] flex items-center justify-center text-[#C69C6D] shadow-md group-hover:scale-105 transition-transform">
                <User size={22} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 lg:p-12 custom-scroll bg-slate-50/50">
          <div className="max-w-[1400px] mx-auto pb-20">
            {activeView === 'dashboard' && (
              <div className="space-y-12 animate-fade-in">
                {/* Hero Section */}
                <div className="bg-[#1B263B] rounded-[3.5rem] p-10 lg:p-20 text-white relative overflow-hidden shadow-3xl">
                  <div className="relative z-10 grid lg:grid-cols-2 gap-16 items-center">
                    <div>
                      <div className="inline-flex items-center gap-2 bg-[#C69C6D]/20 text-[#C69C6D] px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest mb-8 border border-[#C69C6D]/20">
                        <Zap size={14} fill="currentColor" />
                        Acesso Master v2.6
                      </div>
                      <h1 className="text-5xl lg:text-7xl font-black mb-8 tracking-tighter leading-[0.9]">
                        Eficiência em <br /><span className="text-[#C69C6D]">Seguros Corporativos.</span>
                      </h1>
                      <p className="text-slate-400 max-w-lg text-lg leading-relaxed font-medium">
                        O Hub centralizado da F&G Corretora permite que você gerencie cálculos, documentos e metas com precisão absoluta.
                      </p>
                      <div className="mt-12 flex flex-wrap gap-5">
                        <button onClick={() => setActiveView('calculator')} className="bg-[#C69C6D] text-white px-10 py-5 rounded-2xl font-black hover:bg-[#b58a5b] transition-all shadow-xl shadow-[#C69C6D]/20 active:scale-95 flex items-center gap-3">
                          Começar Agora <ChevronRight size={18} />
                        </button>
                        <button onClick={() => setActiveView('goals')} className="bg-white/5 text-white border border-white/10 px-10 py-5 rounded-2xl font-black hover:bg-white/10 transition-all">Analisar Performance</button>
                      </div>
                    </div>
                    <div className="hidden lg:flex justify-end">
                      <div className="relative">
                        <div className="w-80 h-80 bg-gradient-to-br from-[#C69C6D] to-[#1B263B] rounded-[5rem] flex items-center justify-center shadow-2xl p-0.5 rotate-3">
                          <div className="bg-[#1B263B] w-full h-full rounded-[4.8rem] flex items-center justify-center -rotate-3 overflow-hidden">
                            <ShieldCheck size={140} className="text-[#C69C6D] opacity-40" />
                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent"></div>
                          </div>
                        </div>
                        <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-3xl shadow-2xl animate-bounce duration-[3000ms]">
                          <Target size={32} className="text-[#C69C6D]" />
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
                  <div className="flex items-center justify-between mb-8 px-2">
                    <h3 className="text-2xl font-black text-slate-800 tracking-tight">Atalhos Operacionais</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Última atualização: Hoje</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                    {[
                      { title: 'Calculadora', desc: 'Precificação Garantia', icon: <CalcIcon size={28} />, view: 'calculator', color: 'bg-indigo-50 text-indigo-600' },
                      { title: 'Nomeação', desc: 'Relatório em PDF', icon: <FileText size={28} />, view: 'letter', color: 'bg-amber-50 text-amber-600' },
                      { title: 'Performance', desc: 'KPIs & PLR 2026', icon: <Target size={28} />, view: 'goals', color: 'bg-emerald-50 text-emerald-600' },
                      { title: 'Parceiros', desc: 'Acessos & Portais', icon: <ShieldCheck size={28} />, view: 'directory', color: 'bg-slate-100 text-[#1B263B]' },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveView(item.view as View)}
                        className="bg-white p-10 rounded-[3rem] border border-slate-100 hover:border-[#C69C6D] hover:shadow-3xl transition-all duration-500 text-left group flex flex-col relative overflow-hidden"
                      >
                        <div className={`${item.color} w-20 h-20 rounded-3xl flex items-center justify-center mb-8 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-sm`}>
                          {item.icon}
                        </div>
                        <h3 className="font-black text-slate-800 text-2xl mb-2 tracking-tighter">{item.title}</h3>
                        <p className="text-[11px] text-slate-400 uppercase font-black tracking-widest opacity-80">{item.desc}</p>

                        <div className="mt-10 pt-8 border-t border-slate-50 flex justify-between items-center">
                          <span className="text-xs font-black text-[#C69C6D] uppercase tracking-widest group-hover:translate-x-1 transition-transform">Abrir Módulo</span>
                          <div className="bg-slate-50 p-2 rounded-xl group-hover:bg-[#C69C6D] group-hover:text-white transition-all">
                            <ChevronRight size={16} />
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
