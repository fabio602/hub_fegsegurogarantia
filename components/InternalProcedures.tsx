import React, { useState } from 'react';
import {
    Home,
    Megaphone,
    ClipboardList,
    Bolt,
    ShieldCheck,
    ListOrdered,
    Gavel,
    HardHat,
    TriangleAlert,
    Receipt,
    Signature,
    Handshake,
    MessageSquareQuote,
    MailOpen,
    History,
    ChevronDown,
    Info,
    CircleCheck,
    Copy,
    Star,
    Lightbulb,
    Rocket,
    Headset,
    ArrowRight,
    Shield,
    FileText,
    Clock,
    ExternalLink,
    MessageSquare,
    RotateCw,
    Search,
    Briefcase,
    Paperclip,
    UserCheck,
    LayoutDashboard,
    TrendingUp,
    Zap,
    Heart
} from 'lucide-react';

const InternalProcedures: React.FC = () => {
    const [activeSection, setActiveSection] = useState('home');
    const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({
        admin: false,
        comercial: false
    });
    const [showToast, setShowToast] = useState(false);

    const toggleSubmenu = (menu: string) => {
        setOpenSubmenus(prev => ({ ...prev, [menu]: !prev[menu] }));
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
        });
    };

    const NavItem = ({ id, icon: Icon, label, submenu }: { id: string, icon: any, label: string, submenu?: string }) => {
        const isActive = activeSection === id;
        return (
            <button
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${isActive
                    ? 'bg-[#C69C6D] text-white shadow-lg'
                    : 'text-slate-600 hover:bg-slate-100'
                    } ${submenu ? 'pl-12 text-sm' : 'font-bold'}`}
            >
                <Icon size={submenu ? 16 : 20} className={isActive ? 'text-white' : 'text-[#C69C6D]'} />
                <span>{label}</span>
            </button>
        );
    };

    const SubmenuHeader = ({ id, icon: Icon, label, isOpen, onToggle }: { id: string, icon: any, label: string, isOpen: boolean, onToggle: () => void }) => (
        <button
            onClick={onToggle}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-slate-700 font-bold hover:bg-slate-100 transition-all"
        >
            <div className="flex items-center gap-3">
                <Icon size={20} className="text-[#1B263B]" />
                <span>{label}</span>
            </div>
            <ChevronDown size={16} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
    );

    return (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
            {/* Sidebar Sub-Navigation */}
            <aside className="w-full lg:w-72 shrink-0 space-y-2 bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm h-fit sticky top-28">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[4px] px-4 mb-4">Sumário</p>

                <NavItem id="home" icon={Home} label="Início" />

                <div className="space-y-1">
                    <SubmenuHeader
                        id="admin"
                        icon={ClipboardList}
                        label="Fluxo Administrativo"
                        isOpen={openSubmenus.admin}
                        onToggle={() => toggleSubmenu('admin')}
                    />
                    {openSubmenus.admin && (
                        <div className="space-y-1 animate-in slide-in-from-top-2 duration-300">
                            <NavItem id="fluxo-admin-prazos" icon={Bolt} label="Prazos Meta" submenu="admin" />
                            <NavItem id="cadastro-seguradoras" icon={ShieldCheck} label="Cadastro Seguradoras" submenu="admin" />
                            <NavItem id="fluxo-admin-seguradoras" icon={ListOrdered} label="Crédito | Seguradoras" submenu="admin" />
                            <NavItem id="licitante" icon={Gavel} label="Licitante – BidBond" submenu="admin" />
                            <NavItem id="performance" icon={HardHat} label="Seguro Performance" submenu="admin" />
                            <NavItem id="fluxo-admin-sem-limite" icon={TriangleAlert} label="CNPJ - Sem Limite" submenu="admin" />
                            <NavItem id="fluxo-admin-serasa" icon={Receipt} label="CNPJ - Serasa" submenu="admin" />
                            <NavItem id="fluxo-admin-ccg" icon={Signature} label="CCG" submenu="admin" />
                            <NavItem id="fluxo-admin-afiancadoras" icon={Handshake} label="Afiançadoras" submenu="admin" />
                            <NavItem id="emails" icon={MailOpen} label="Scripts" submenu="admin" />
                        </div>
                    )}
                </div>

                <div className="space-y-1">
                    <SubmenuHeader
                        id="comercial"
                        icon={Handshake}
                        label="Fluxo Comercial"
                        isOpen={openSubmenus.comercial}
                        onToggle={() => toggleSubmenu('comercial')}
                    />
                    {openSubmenus.comercial && (
                        <div className="space-y-1 animate-in slide-in-from-top-2 duration-300">
                            <NavItem id="comercial" icon={MessageSquareQuote} label="Vendas" submenu="comercial" />
                            <NavItem id="tutorial-prevendas" icon={Headset} label="Pre-vendas" submenu="comercial" />
                        </div>
                    )}
                </div>

                <NavItem id="pos-venda" icon={History} label="Pós-Venda" />
            </aside>

            {/* Content Area */}
            <div className="flex-1 space-y-8 min-w-0">
                {activeSection === 'home' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm transition-all hover:shadow-md border-t-4 border-t-[#C69C6D]">
                                <h3 className="text-2xl font-black text-[#1B263B] mb-6 flex items-center gap-3">
                                    <Rocket className="text-[#C69C6D]" size={28} />
                                    Objetivo do Manual
                                </h3>
                                <p className="text-slate-600 leading-relaxed">
                                    Formalizar os procedimentos internos no Departamento de Seguro Garantia, visando maior agilidade nas decisões internas. Este manual serve para todos que precisam acessar informações sobre o modelo de trabalho desenvolvido pelo departamento.
                                </p>
                            </div>
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm transition-all hover:shadow-md border-t-4 border-t-[#C69C6D]">
                                <h3 className="text-2xl font-black text-[#1B263B] mb-6 flex items-center gap-3">
                                    <Headset className="text-[#C69C6D]" size={28} />
                                    Comunicação com Clientes
                                </h3>
                                <p className="text-slate-600 leading-relaxed mb-6">
                                    Nosso objetivo principal é a excelência no atendimento. Nenhuma ação do cliente em nossa direção pode ficar sem retorno.
                                </p>
                                <div className="space-y-4">
                                    <h4 className="font-bold text-[#1B263B] uppercase text-xs tracking-widest flex items-center gap-2">
                                        <Star size={14} className="text-[#C69C6D]" /> Regras de Ouro
                                    </h4>
                                    <ul className="space-y-3 text-sm">
                                        <li className="flex gap-3 text-slate-600"><span className="font-bold text-[#1B263B]">Retorno Imediato:</span> Agradecer e informar próximos passos.</li>
                                        <li className="flex gap-3 text-slate-600"><span className="font-bold text-[#1B263B]">Padronização:</span> Manter títulos e fontes reconhecíveis.</li>
                                        <li className="flex gap-3 text-slate-600"><span className="font-bold text-[#1B263B]">Objetividade:</span> Detalhes por telefone, síntese por e-mail.</li>
                                        <li className="flex gap-3 text-slate-600"><span className="font-bold text-[#1B263B]">Responsabilidade:</span> A clareza é dever de quem comunica.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                        <div className="bg-[#1B263B] p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-10 opacity-[0.05] group-hover:scale-110 transition-transform">
                                <Lightbulb size={120} className="text-[#C69C6D]" />
                            </div>
                            <h3 className="text-2xl font-black text-[#C69C6D] mb-8 flex items-center gap-3">
                                <Lightbulb size={28} />
                                Dicas de Ouro (Admin & Comercial)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                <ul className="space-y-4 text-slate-300">
                                    <li className="flex gap-3"><CircleCheck size={18} className="text-[#C69C6D] shrink-0" /> Fortaleça sua marca: não repasse e-mails diretos das seguradoras.</li>
                                    <li className="flex gap-3"><CircleCheck size={18} className="text-[#C69C6D] shrink-0" /> Cobrança de Pendências: Telefone/WhatsApp primeiro, e-mail depois.</li>
                                </ul>
                                <ul className="space-y-4 text-slate-300">
                                    <li className="flex gap-3"><CircleCheck size={18} className="text-[#C69C6D] shrink-0" /> Inadimplência: Monitorar semanalmente para evitar negativações.</li>
                                    <li className="flex gap-3"><CircleCheck size={18} className="text-[#C69C6D] shrink-0" /> Dica de Milhões: Só prometa o que tiver certeza absoluta que cumprirá.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'fluxo-admin-prazos' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Nossos Prazos Meta</h3>
                            <p className="text-slate-500 font-medium">Excelência operacional garantida através do cumprimento de metas de tempo.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {[
                                { title: 'Seguro Licitante', time: '2 Horas', desc: 'Simples e rápido', icon: Bolt, color: 'text-amber-500' },
                                { title: 'Seguro Contrato', time: '24 Horas', desc: 'Tranquilo de orçar', icon: Clock, color: 'text-blue-500' },
                                { title: 'Homologação', time: 'Max 3 Dias', desc: 'Acompanhamento constante', icon: CircleCheck, color: 'text-emerald-500' }
                            ].map((item, idx) => (
                                <div key={idx} className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center text-center group hover:border-[#C69C6D] transition-all">
                                    <div className={`p-6 rounded-[2rem] bg-slate-50 mb-6 group-hover:scale-110 transition-transform ${item.color}`}>
                                        <item.icon size={48} />
                                    </div>
                                    <h4 className="font-black text-[#1B263B] text-xl mb-2">{item.title}</h4>
                                    <p className="text-3xl font-black text-[#C69C6D] mb-2">{item.time}</p>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{item.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeSection === 'cadastro-seguradoras' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Cadastro Seguradoras</h3>
                            <p className="text-slate-500 font-medium">Processos de homologação e ampliação de limites.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
                                <h3 className="text-2xl font-black text-[#1B263B] mb-6 flex items-center gap-3">
                                    <ShieldCheck className="text-[#C69C6D]" size={28} />
                                    Limites Básicos (CNPJ)
                                </h3>
                                <p className="text-slate-600 leading-relaxed mb-6">
                                    Toda seguradora libera limites de forma imediata se o cliente tiver uma boa saúde financeira, isso chamamos aqui de <strong>limite básico</strong>. Quando há necessidade de maiores limites é necessário enviar os documentos nas seguradoras e aguardar a liberação de novos limites.
                                </p>
                                <div className="space-y-4">
                                    <h4 className="font-bold text-[#1B263B] text-sm uppercase tracking-widest">Tipos de Cadastro</h4>
                                    <ul className="space-y-3">
                                        <li className="flex gap-3 text-slate-600 font-medium"><CircleCheck size={16} className="text-[#C69C6D]" /> <span className="font-bold">Eletrônico:</span> Junto Seguros (analisa e cadastra direto na cotação).</li>
                                        <li className="flex gap-3 text-slate-600 font-medium"><CircleCheck size={16} className="text-[#C69C6D]" /> <span className="font-bold">Tradicional:</span> Tokio Marine (exige cadastro antes de cotar).</li>
                                    </ul>
                                </div>
                            </div>
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
                                <h3 className="text-2xl font-black text-[#1B263B] mb-6 flex items-center gap-3">
                                    <Receipt className="text-[#C69C6D]" size={28} />
                                    Documentação
                                </h3>
                                <div className="bg-slate-50 p-6 rounded-2xl">
                                    <h4 className="font-bold text-[#1B263B] text-xs uppercase tracking-widest mb-4">Empresa Ltda / SA</h4>
                                    <ul className="space-y-2 text-sm text-slate-600">
                                        <li>• Contrato Social e alterações</li>
                                        <li>• Balanços últimos 03 anos (Ativo/Passivo/DRE)</li>
                                        <li>• Balancete recente</li>
                                        <li>• Declaração de inatividade</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'fluxo-admin-seguradoras' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Fluxo Crédito | Seguradoras</h3>
                            <p className="text-slate-500 font-medium">Resumo do fluxo de emissão de apólice.</p>
                        </div>
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-10">
                            {[
                                { step: '1', title: 'Cadastrar Empresa', desc: 'Essencial para conhecer a taxa e o limite de crédito disponível.' },
                                { step: '2', title: 'Análise do Contrato', desc: 'Identifique a modalidade. Solicite: Editais, Contratos ou Resumo Judicial.' },
                                { step: '3', title: 'Cotação / Proposta', desc: 'Formatar proposta comercial com IS, Prazo, Limite e Taxa.' },
                                { step: '4', title: 'Emissão da Apólice', desc: 'Via Portais das Cias ou Análise direta da companhia.' },
                                { step: '5', title: 'Pós Venda', desc: 'Endossos são comuns. Mantenha registro digital e acompanhe o tomador.' }
                            ].map((item, idx) => (
                                <div key={idx} className="flex gap-8 items-start relative">
                                    <div className="w-12 h-12 rounded-2xl bg-[#C69C6D] flex items-center justify-center text-white font-black text-xl shrink-0 shadow-lg">
                                        {item.step}
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-xl font-black text-[#1B263B]">{item.title}</h4>
                                        <p className="text-slate-600 leading-relaxed">{item.desc}</p>
                                    </div>
                                    {idx !== 4 && <div className="absolute left-6 top-16 bottom-[-2.5rem] w-0.5 bg-slate-100"></div>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeSection === 'licitante' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Checklist: Seguro Licitante</h3>
                            <p className="text-slate-500 font-medium">Propostas para participação em pregões públicos.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-xs flex items-center gap-2">
                                    <Clock size={16} className="text-[#C69C6D]" /> Vigência e Prazos
                                </h4>
                                <ul className="space-y-3 text-slate-600 text-sm">
                                    <li>• Conferir cláusula no edital (60/90/120 dias)</li>
                                    <li>• Iniciar vigência um dia antes do pregão</li>
                                </ul>
                            </div>
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-xs flex items-center gap-2">
                                    <Receipt size={16} className="text-[#C69C6D]" /> Importância Segurada
                                </h4>
                                <p className="text-sm text-slate-600">Normalmente 1% do valor do edital. Validar valor final com o cliente.</p>
                            </div>
                        </div>
                        <div className="bg-blue-50 p-10 rounded-[3rem] border border-blue-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-blue-900 uppercase tracking-widest text-sm flex items-center gap-3">
                                <Info size={20} className="text-blue-600" />
                                ⚠️ Nova Regra de Cautela - Evite Desclassificação
                            </h4>
                            <div className="space-y-4">
                                <p className="text-blue-900 font-bold text-sm leading-relaxed">
                                    Para evitar riscos de desclassificação nas licitações que exigem seguro de proposta de 1%, vamos adotar uma nova regra de cautela na emissão das apólices:
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white p-4 rounded-2xl border border-blue-200">
                                        <p className="text-xs font-black text-blue-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                                            <CircleCheck size={14} className="text-green-600" />
                                            Início da vigência
                                        </p>
                                        <p className="text-sm text-slate-700">Sempre coloque <span className="font-black text-blue-900">1 dia antes</span> da data da licitação.</p>
                                    </div>
                                    <div className="bg-white p-4 rounded-2xl border border-blue-200">
                                        <p className="text-xs font-black text-blue-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                                            <CircleCheck size={14} className="text-green-600" />
                                            Fim da vigência
                                        </p>
                                        <p className="text-sm text-slate-700">Não esqueça de somar <span className="font-black text-blue-900">+1 dia</span> no final para manter o prazo do edital.</p>
                                    </div>
                                </div>
                                <div className="bg-amber-50 p-5 rounded-2xl border border-amber-200">
                                    <p className="text-xs font-black text-amber-900 uppercase tracking-widest mb-2">Por quê?</p>
                                    <p className="text-sm text-amber-900 leading-relaxed">
                                        Algumas seguradoras iniciam a vigência apenas às 24h da data escolhida. Se a licitação for às 09h da manhã, podem alegar que a apólice ainda não vale.
                                    </p>
                                </div>
                                <div className="bg-[#1B263B] p-6 rounded-2xl">
                                    <p className="text-xs font-black text-[#C69C6D] uppercase tracking-widest mb-3 flex items-center gap-2">
                                        📅 Exemplo Prático
                                    </p>
                                    <p className="text-white text-sm mb-2">
                                        <span className="text-[#C69C6D] font-bold">Licitação dia 30?</span>
                                    </p>
                                    <p className="text-slate-300 text-sm leading-relaxed">
                                        👉 Emitir início dia <span className="font-black text-white">29</span> e ajustar o vencimento.
                                    </p>
                                    <p className="text-slate-400 text-xs mt-3 italic">
                                        ** Ou seja, 92 dias no total
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-red-50 p-10 rounded-[3rem] border border-red-100 flex items-center gap-8">
                            <TriangleAlert size={40} className="text-red-500" />
                            <p className="text-red-900 font-black">ERRO ZERO: Qualquer erro desclassifica o cliente do pregão.</p>
                        </div>
                    </div>
                )}

                {activeSection === 'performance' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Checklist: Seguro Performance</h3>
                            <p className="text-slate-500 font-medium">Garantia de execução contratual após a vitória na licitação.</p>
                        </div>

                        {/* Documentação */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                <FileText size={20} className="text-[#C69C6D]" />
                                Documentação
                            </h4>
                            <div className="space-y-4">
                                <div className="flex items-start gap-3">
                                    <CircleCheck size={18} className="text-[#C69C6D] shrink-0 mt-0.5" />
                                    <p className="text-sm text-slate-700">
                                        <span className="font-bold text-[#1B263B]">Edital completo.</span>
                                    </p>
                                </div>
                                <div className="flex items-start gap-3">
                                    <CircleCheck size={18} className="text-[#C69C6D] shrink-0 mt-0.5" />
                                    <p className="text-sm text-slate-700">
                                        <span className="font-bold text-[#1B263B]">Minuta do contrato ou ata do vencedor.</span>
                                    </p>
                                </div>
                            </div>
                            <div className="bg-red-50 p-6 rounded-2xl border border-red-200">
                                <div className="flex items-start gap-3">
                                    <TriangleAlert size={20} className="text-red-600 shrink-0" />
                                    <div className="space-y-2">
                                        <p className="text-sm font-black text-red-900 uppercase tracking-wide">Atenção</p>
                                        <p className="text-sm text-red-800 leading-relaxed">
                                            <span className="font-bold">Não emitir o seguro enquanto não tivermos a minuta.</span>
                                        </p>
                                        <p className="text-xs text-red-700 italic">
                                            Se ainda não houver a minuta, precisamos de algum documento que mostre o valor que foi vencedor no pregão.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Verificações Importantes */}
                        <div className="bg-[#1B263B] p-10 rounded-[2.5rem] shadow-xl space-y-6">
                            <h4 className="font-bold text-[#C69C6D] uppercase tracking-widest text-sm flex items-center gap-3">
                                <ClipboardList size={20} />
                                Verificações Importantes
                            </h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Seguro Adicional */}
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Shield size={18} className="text-[#C69C6D]" />
                                        <p className="text-white font-black text-sm">Seguro Adicional</p>
                                    </div>
                                    <p className="text-slate-300 text-sm leading-relaxed">
                                        Necessário quando a proposta for inferior a <span className="font-bold text-white">85%</span> do valor do edital.
                                    </p>
                                </div>

                                {/* Coberturas Extras */}
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck size={18} className="text-[#C69C6D]" />
                                        <p className="text-white font-black text-sm">Coberturas Extras</p>
                                    </div>
                                    <p className="text-slate-300 text-sm leading-relaxed">
                                        Há exigência de cláusulas trabalhistas ou outro tipo de seguro no edital ou contrato?
                                    </p>
                                </div>

                                {/* Percentual de Garantia */}
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp size={18} className="text-[#C69C6D]" />
                                        <p className="text-white font-black text-sm">Percentual de Garantia</p>
                                    </div>
                                    <p className="text-slate-300 text-sm leading-relaxed">
                                        Qual % será necessário? <span className="text-amber-300">(Pode variar de 5% a 30%)</span>.
                                    </p>
                                </div>

                                {/* Vigência */}
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Clock size={18} className="text-[#C69C6D]" />
                                        <p className="text-white font-black text-sm">Vigência</p>
                                    </div>
                                    <p className="text-slate-300 text-sm leading-relaxed">
                                        Qual a vigência exigida? <span className="text-amber-300">(Alguns contratos pedem 12 meses + 90 dias extras)</span>.
                                    </p>
                                </div>
                            </div>

                            {/* Valor da IS */}
                            <div className="bg-[#C69C6D]/20 p-6 rounded-2xl border border-[#C69C6D]/30">
                                <div className="flex items-start gap-3">
                                    <Info size={20} className="text-[#C69C6D] shrink-0" />
                                    <div className="space-y-2">
                                        <p className="text-[#C69C6D] font-black text-sm uppercase tracking-widest">Valor da IS</p>
                                        <p className="text-white text-sm leading-relaxed">
                                            Confirme <span className="font-bold">todas essas informações diretamente na minuta/contrato</span>.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'fluxo-admin-sem-limite' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">CNPJ - Sem Limite</h3>
                            <p className="text-slate-500 font-medium">Resolução de pendências.</p>
                        </div>

                        {/* Contexto */}
                        <div className="bg-amber-50 p-10 rounded-[2.5rem] border border-amber-200 shadow-sm space-y-4">
                            <div className="flex items-start gap-3">
                                <TriangleAlert size={24} className="text-amber-600 shrink-0" />
                                <div className="space-y-3">
                                    <h4 className="font-black text-amber-900 text-lg">Contexto Importante</h4>
                                    <p className="text-sm text-amber-900 leading-relaxed">
                                        Mesmo com pré-checagem, as seguradoras podem levantar pendências até a homologação. O objetivo é <span className="font-bold">resolver de forma ágil</span> para não travar o processo.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Buscar Alternativas */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                <Search size={20} className="text-[#C69C6D]" />
                                Buscar Alternativas
                            </h4>
                            <p className="text-slate-600 text-sm leading-relaxed">
                                Se o limite na cotação não for suficiente ou inexistir, busque outras seguradoras:
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-blue-50 p-6 rounded-2xl border border-blue-200">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black shrink-0">1</div>
                                        <div>
                                            <p className="font-bold text-blue-900 mb-2">Tente aprovar em outra seguradora</p>
                                            <p className="text-sm text-blue-800 leading-relaxed">
                                                Cada seguradora tem critérios próprios de análise.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-200">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-black shrink-0">2</div>
                                        <div>
                                            <p className="font-bold text-emerald-900 mb-2">Não se restrinja à primeira</p>
                                            <p className="text-sm text-emerald-800 leading-relaxed">
                                                Não restrinja-se apenas à primeira seguradora consultada.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Objetivo */}
                        <div className="bg-[#1B263B] p-10 rounded-[2.5rem] shadow-xl">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-3 bg-[#C69C6D] rounded-2xl">
                                    <Zap size={28} className="text-[#1B263B]" />
                                </div>
                                <div>
                                    <h4 className="font-black text-[#C69C6D] text-xl">Objetivo: Agilidade</h4>
                                    <p className="text-slate-400 text-xs uppercase tracking-widest font-bold">Prioridade Máxima</p>
                                </div>
                            </div>
                            <p className="text-slate-300 text-sm leading-relaxed">
                                Busque outras seguradoras <span className="font-bold text-white">imediatamente</span>. A meta é resolver <span className="font-bold text-white">antes da homologação</span>.
                            </p>
                        </div>
                    </div>
                )}

                {activeSection === 'fluxo-admin-serasa' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">CNPJ - Serasa</h3>
                            <p className="text-slate-500 font-medium">Análise de casos com restrição.</p>
                        </div>

                        {/* Análise Opções de Seguradoras */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                <Search size={20} className="text-[#C69C6D]" />
                                Análise Opções de Seguradoras
                            </h4>
                            <p className="text-slate-600 text-sm leading-relaxed">
                                Quando o cliente possui Serasa, precisamos estudar melhor o caso, entender a demanda e os motivos do Serasa. Se nenhuma der limite, indica restrição.
                            </p>
                            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black shrink-0">1</div>
                                    <p className="text-sm text-blue-900 leading-relaxed">
                                        <span className="font-bold">Busque outras seguradoras</span>, cada Seguradora tem um apetite. Se nenhuma der limite, indica Serasa. Passe para o comercial.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Abordagem com Cliente */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                <MessageSquare size={20} className="text-[#C69C6D]" />
                                Abordagem com Cliente
                            </h4>
                            <p className="text-slate-600 text-sm leading-relaxed font-medium">
                                Abordagem com Cliente de forma cuidadosa:
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                    <p className="flex items-start gap-2 text-sm text-slate-700">
                                        <CircleCheck size={16} className="text-[#C69C6D] shrink-0 mt-0.5" />
                                        <span>O cliente tem ciência do débito ou restrição?</span>
                                    </p>
                                </div>
                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                    <p className="flex items-start gap-2 text-sm text-slate-700">
                                        <CircleCheck size={16} className="text-[#C69C6D] shrink-0 mt-0.5" />
                                        <span>Qual o valor da pendência?</span>
                                    </p>
                                </div>
                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                    <p className="flex items-start gap-2 text-sm text-slate-700">
                                        <CircleCheck size={16} className="text-[#C69C6D] shrink-0 mt-0.5" />
                                        <span>Já se resolveu e apenas não houve a baixa?</span>
                                    </p>
                                </div>
                                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                    <p className="flex items-start gap-2 text-sm text-slate-700">
                                        <CircleCheck size={16} className="text-[#C69C6D] shrink-0 mt-0.5" />
                                        <span>Peças as documentações adicionais.</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Documentação Adicional */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                <Paperclip size={20} className="text-[#C69C6D]" />
                                Documentação Adicional
                            </h4>
                            <p className="text-slate-600 text-sm leading-relaxed">
                                Envie documentos adicionais para tentar reavaliação:
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-[#C69C6D]/10 p-6 rounded-2xl border border-[#C69C6D]/20 text-center">
                                    <FileText className="text-[#C69C6D] mx-auto mb-3" size={32} />
                                    <p className="text-sm font-bold text-[#1B263B]">Balanços atualizados</p>
                                </div>
                                <div className="bg-[#C69C6D]/10 p-6 rounded-2xl border border-[#C69C6D]/20 text-center">
                                    <Receipt className="text-[#C69C6D] mx-auto mb-3" size={32} />
                                    <p className="text-sm font-bold text-[#1B263B]">Comprovação de pagamento</p>
                                </div>
                                <div className="bg-[#C69C6D]/10 p-6 rounded-2xl border border-[#C69C6D]/20 text-center">
                                    <LayoutDashboard className="text-[#C69C6D] mx-auto mb-3" size={32} />
                                    <p className="text-sm font-bold text-[#1B263B]">Planilhas de fluxo de caixa</p>
                                </div>
                            </div>
                        </div>

                        {/* Análise das Documentações */}
                        <div className="bg-[#1B263B] p-10 rounded-[2.5rem] text-white shadow-xl space-y-6">
                            <h4 className="font-bold text-[#C69C6D] uppercase tracking-widest text-sm flex items-center gap-3">
                                <TrendingUp size={20} />
                                Análise das documentações
                            </h4>
                            <p className="text-slate-300 text-sm leading-relaxed">
                                <span className="font-bold text-white">Objetivo:</span> Verificar se o cliente tem uma estrutura financeira para adicionarmos informações que poderão ajudar as Seguradoras a reanalisar o caso e liberar limites.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                                    <p className="text-[#C69C6D] font-black text-xs uppercase tracking-widest mb-2">Pergunta 1</p>
                                    <p className="text-white text-sm font-medium">Qual o capital social da empresa?</p>
                                </div>
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                                    <p className="text-[#C69C6D] font-black text-xs uppercase tracking-widest mb-2">Pergunta 2</p>
                                    <p className="text-white text-sm font-medium">Qual o valor da dívida?</p>
                                </div>
                                <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                                    <p className="text-[#C69C6D] font-black text-xs uppercase tracking-widest mb-2">Pergunta 3</p>
                                    <p className="text-white text-sm font-medium">Qual o faturamento da empresa?</p>
                                </div>
                            </div>
                            <div className="bg-amber-500/20 p-6 rounded-2xl border border-amber-500/30 mt-6">
                                <p className="text-amber-200 text-sm leading-relaxed italic">
                                    <span className="font-bold text-amber-100">Análise técnica:</span> Capacidade de faturamento vs Dívida vs Capital Social.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'fluxo-admin-ccg' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Contrato de Contra Garantia (CCG)</h3>
                            <p className="text-slate-500 font-medium">Formalização jurídica indispensável.</p>
                        </div>
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 text-sm text-slate-600 space-y-4">
                            <p>Deve ser assinado em todas as cias com cadastro. Pode ser Eletrônico ou com firma reconhecida. Sócio e cônjuge assinam.</p>
                            <div className="bg-blue-50 p-6 rounded-xl text-blue-900 font-bold border border-blue-100">
                                Antecipe o CCG para evitar travas na emissão futura.
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'fluxo-admin-afiancadoras' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Alternativa: Afiançadoras</h3>
                            <p className="text-slate-500 font-medium">Contatos para Cartas Fidejussórias.</p>
                        </div>

                        {/* Quando Usar */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                <Info size={20} className="text-[#C69C6D]" />
                                Quando Usar Afiançadoras
                            </h4>
                            <p className="text-slate-600 text-sm leading-relaxed">
                                Se a documentação não der limite de crédito, considere empresas privadas que emitem <span className="font-bold text-[#1B263B]">Carta Fidejussória</span>.
                            </p>
                        </div>

                        {/* Avisos Importantes */}
                        <div className="bg-red-50 p-10 rounded-[2.5rem] border border-red-200 shadow-sm space-y-6">
                            <div className="flex items-start gap-3">
                                <TriangleAlert size={24} className="text-red-600 shrink-0" />
                                <div className="space-y-4">
                                    <h4 className="font-black text-red-900 text-lg uppercase tracking-wide">Atenção</h4>
                                    <div className="space-y-4">
                                        <div className="bg-white p-5 rounded-2xl border border-red-200">
                                            <p className="text-xs font-black text-red-900 uppercase tracking-wide mb-2">Última Alternativa</p>
                                            <p className="text-sm text-red-800 leading-relaxed">
                                                Essa é nossa <span className="font-bold">última alternativa</span>, porque nem sempre será aceito pelo órgão público.
                                            </p>
                                        </div>
                                        <div className="bg-white p-5 rounded-2xl border border-red-200">
                                            <p className="text-xs font-black text-red-900 uppercase tracking-wide mb-2">Validação Obrigatória</p>
                                            <p className="text-sm text-red-800 leading-relaxed">
                                                É sempre importante <span className="font-bold">validar com o cliente</span> se o órgão público aceita uma garantia feita por uma empresa privada.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Processo Comercial */}
                        <div className="bg-blue-50 p-10 rounded-[2.5rem] border border-blue-200 shadow-sm space-y-6">
                            <h4 className="font-bold text-blue-900 uppercase tracking-widest text-sm flex items-center gap-3">
                                <Briefcase size={20} className="text-blue-600" />
                                Processo Comercial
                            </h4>
                            <div className="bg-white p-6 rounded-2xl border border-blue-200 space-y-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black shrink-0">1</div>
                                    <div>
                                        <p className="font-bold text-blue-900 mb-2">Informar o Custo</p>
                                        <p className="text-sm text-slate-700 leading-relaxed">
                                            O comercial deve informar o custo <span className="text-blue-900 font-bold">(definido pela afiançadora + adicional da corretora)</span>.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black shrink-0">2</div>
                                    <div>
                                        <p className="font-bold text-blue-900 mb-2">Aguardar Aprovação</p>
                                        <p className="text-sm text-slate-700 leading-relaxed">
                                            Aguardar aprovação do órgão público antes de prosseguir.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Contatos */}
                        <div className="bg-[#1B263B] p-10 rounded-[3rem] shadow-xl space-y-6">
                            <h4 className="font-bold text-[#C69C6D] uppercase tracking-widest text-sm flex items-center gap-3">
                                <Headset size={20} />
                                Contatos das Afiançadoras
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-white/10 p-8 rounded-[2rem] border border-white/20 shadow-sm flex items-center gap-6 hover:bg-white/15 transition-colors">
                                    <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shrink-0">A</div>
                                    <div>
                                        <p className="font-black text-white text-xl">AUPOL</p>
                                        <p className="text-[#C69C6D] text-sm font-bold">11 93096-5184</p>
                                    </div>
                                </div>
                                <div className="bg-white/10 p-8 rounded-[2rem] border border-white/20 shadow-sm flex items-center gap-6 hover:bg-white/15 transition-colors">
                                    <div className="w-16 h-16 bg-slate-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shrink-0">S</div>
                                    <div>
                                        <p className="font-black text-white text-xl">SEVEN</p>
                                        <p className="text-[#C69C6D] text-sm font-bold">12 98890-1382</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'emails' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Scripts Administrativos</h3>
                            <p className="text-slate-500 font-medium">Modelos de e-mails padronizados para comunicação com clientes.</p>
                        </div>

                        {/* Cobrança de Documentos Pendentes */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                    <FileText size={20} className="text-[#C69C6D]" />
                                    Cobrança de Documentos Pendentes
                                </h4>
                                <button
                                    onClick={() => copyToClipboard(`Prezado (nome do cliente),

Recepcionamos os documentos cadastrais da sua empresa, no entanto, para dar continuidade ao processo de cadastramento, será necessário que nos envie:

- DRE do balanço de 2019;
- 15° alteração contratual, pois a enviada está elegível.

Caso haja alguma dúvida, estamos à disposição. Abraços,`)}
                                    className="flex items-center gap-2 px-4 py-2 bg-[#C69C6D] text-white rounded-xl hover:bg-[#B08A5D] transition-colors text-sm font-bold"
                                >
                                    <Copy size={16} />
                                    Copiar
                                </button>
                            </div>
                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-sm text-slate-700 leading-relaxed font-mono">
                                <p className="mb-4">Prezado <span className="text-[#C69C6D] font-bold">(nome do cliente)</span>,</p>
                                <p className="mb-4">Recepcionamos os documentos cadastrais da sua empresa, no entanto, para dar continuidade ao processo de cadastramento, será necessário que nos envie:</p>
                                <ul className="mb-4 ml-4 space-y-1">
                                    <li>- DRE do balanço de 2019;</li>
                                    <li>- 15° alteração contratual, pois a enviada está elegível.</li>
                                </ul>
                                <p>Caso haja alguma dúvida, estamos à disposição. Abraços,</p>
                            </div>
                        </div>

                        {/* Agradecimento Envio de Cadastro */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                    <CircleCheck size={20} className="text-emerald-600" />
                                    Agradecimento Envio de Cadastro
                                </h4>
                                <button
                                    onClick={() => copyToClipboard(`Prezado (nome do cliente),

Muito obrigada pelo envio do seu cadastro!

Informamos que os mesmos já estão em avaliação nas Cias Seguradoras e logo faremos contato para informar o(s) limite(s) de crédito aprovado(s).

Permanecemos à disposição. Abraços,`)}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm font-bold"
                                >
                                    <Copy size={16} />
                                    Copiar
                                </button>
                            </div>
                            <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-200 text-sm text-emerald-900 leading-relaxed font-mono">
                                <p className="mb-4">Prezado <span className="text-emerald-700 font-bold">(nome do cliente)</span>,</p>
                                <p className="mb-4">Muito obrigada pelo envio do seu cadastro!</p>
                                <p className="mb-4">Informamos que os mesmos já estão em avaliação nas Cias Seguradoras e logo faremos contato para informar o(s) limite(s) de crédito aprovado(s).</p>
                                <p>Permanecemos à disposição. Abraços,</p>
                            </div>
                        </div>

                        {/* Comunicação de Limites Aprovados */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                    <Star size={20} className="text-amber-500" />
                                    Comunicação de Limites Aprovados
                                </h4>
                                <button
                                    onClick={() => copyToClipboard(`À (razão social da empresa) A/C: (nome do cliente),

É com muita satisfação, que a (nome da Corretora) lhe dá boas vindas!

Informamos que seu cadastro foi homologado para operações tradicionais de seguro garantia, nas seguintes condições:

Porto Seguro – Limite: [INSERIR LIMITE]
Berkley – Limite: [INSERIR LIMITE]
Junto Seguros – Limite: [INSERIR LIMITE]

Agradecemos à confiança e estamos à disposição para atendê-los em suas próximas contratações de Seguro Garantia.

Até breve!`)}
                                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-bold"
                                >
                                    <Copy size={16} />
                                    Copiar
                                </button>
                            </div>
                            <div className="bg-amber-50 p-6 rounded-2xl border border-amber-200 text-sm text-amber-900 leading-relaxed font-mono">
                                <p className="mb-4">À <span className="text-amber-700 font-bold">(razão social da empresa)</span> A/C: <span className="text-amber-700 font-bold">(nome do cliente)</span>,</p>
                                <p className="mb-4">É com muita satisfação, que a <span className="text-amber-700 font-bold">(nome da Corretora)</span> lhe dá boas vindas!</p>
                                <p className="mb-4">Informamos que seu cadastro foi homologado para operações tradicionais de seguro garantia, nas seguintes condições:</p>
                                <ul className="mb-4 ml-4 space-y-1">
                                    <li>Porto Seguro – Limite: <span className="text-amber-700 font-bold">[INSERIR LIMITE]</span></li>
                                    <li>Berkley – Limite: <span className="text-amber-700 font-bold">[INSERIR LIMITE]</span></li>
                                    <li>Junto Seguros – Limite: <span className="text-amber-700 font-bold">[INSERIR LIMITE]</span></li>
                                </ul>
                                <p className="mb-4">Agradecemos à confiança e estamos à disposição para atendê-los em suas próximas contratações de Seguro Garantia.</p>
                                <p>Até breve!</p>
                            </div>
                        </div>

                        {/* Cobrança de Inadimplência */}
                        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-[#1B263B] uppercase tracking-widest text-sm flex items-center gap-3">
                                    <TriangleAlert size={20} className="text-red-600" />
                                    Cobrança de Inadimplência
                                </h4>
                                <button
                                    onClick={() => copyToClipboard(`Prezados, boa tarde!

A (nome da sua Corretora) tem trabalhado para sempre oferecer os melhores serviços para sua empresa.

Dessa forma, solicitamos que entre em contato conosco o mais breve possível, a fim de juntos solucionarmos a(s) pendência(s) da(s) apólice(s) que se encontra em atraso de pagamento.

Segue abaixo descritivo da apólice:
(descrever a apólice que encontra-se pendente de pagamento)

Caso a situação já tenha sido regularizada, por favor, desconsidere esta mensagem.

Atenciosamente,`)}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors text-sm font-bold"
                                >
                                    <Copy size={16} />
                                    Copiar
                                </button>
                            </div>
                            <div className="bg-red-50 p-6 rounded-2xl border border-red-200 text-sm text-red-900 leading-relaxed font-mono">
                                <p className="mb-4">Prezados, boa tarde!</p>
                                <p className="mb-4">A <span className="text-red-700 font-bold">(nome da sua Corretora)</span> tem trabalhado para sempre oferecer os melhores serviços para sua empresa.</p>
                                <p className="mb-4">Dessa forma, solicitamos que entre em contato conosco o mais breve possível, a fim de juntos solucionarmos a(s) pendência(s) da(s) apólice(s) que se encontra em atraso de pagamento.</p>
                                <p className="mb-4">Segue abaixo descritivo da apólice:<br />
                                    <span className="text-red-700 font-bold">(descrever a apólice que encontra-se pendente de pagamento)</span></p>
                                <p className="mb-4">Caso a situação já tenha sido regularizada, por favor, desconsidere esta mensagem.</p>
                                <p>Atenciosamente,</p>
                            </div>
                        </div>
                    </div>
                )}


                {activeSection === 'comercial' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Abordagem Comercial Eficaz – Método DOR &gt; SOLUÇÃO &gt; PROVA &gt; CHAMADA</h3>
                            <p className="text-slate-500 font-medium leading-relaxed">
                                Com a planilha em mãos e os prospects identificados, iniciamos a abordagem comercial. Como oferecer o Seguro Garantia de forma que o potencial cliente veja valor imediato.
                            </p>
                        </div>

                        <div className="bg-[#1B263B] p-8 rounded-[2.5rem] text-white flex items-center gap-6 shadow-xl border-l-8 border-[#C69C6D]">
                            <div className="p-4 bg-[#C69C6D] rounded-2xl text-[#1B263B]">
                                <Lightbulb size={32} />
                            </div>
                            <div>
                                <h4 className="font-black text-[#C69C6D] uppercase text-xs tracking-widest mb-1">Dica de Especialista</h4>
                                <p className="text-sm text-slate-300">Não fale "posso te vender um seguro?". Fale como um especialista que resolve um problema real: <span className="text-white font-bold">tempo, custo, agilidade ou risco.</span></p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {[
                                {
                                    step: '1',
                                    title: 'DOR',
                                    subtitle: 'Destaque o problema',
                                    desc: 'Toque na "ferida" para demonstrar que entende a realidade do cliente.',
                                    example: '"Vocês já passaram pela situação de perder um contrato grande por não ter a garantia pronta?"',
                                    color: 'bg-red-50 text-red-600 border-red-100'
                                },
                                {
                                    step: '2',
                                    title: 'SOLUÇÃO',
                                    subtitle: 'Apresente a saída',
                                    desc: 'Mostre que o Seguro Garantia protege contra riscos financeiros e agiliza a execução.',
                                    example: 'Foque na agilidade e segurança que a apólice traz para a operação.',
                                    color: 'bg-blue-50 text-blue-600 border-blue-100'
                                },
                                {
                                    step: '3',
                                    title: 'PROVA',
                                    subtitle: 'Gere credibilidade',
                                    desc: 'Use cases reais (mesmo sem citar nomes) para mostrar que já funcionou.',
                                    example: '"Recentemente ajudamos uma empresa similar que ganhou uma obra e precisou da garantia imediata..."',
                                    color: 'bg-[#C69C6D]/10 text-[#C69C6D] border-[#C69C6D]/20'
                                },
                                {
                                    step: '4',
                                    title: 'CHAMADA',
                                    subtitle: 'Convite para ação (CTA)',
                                    desc: 'Oferta personalizada que leva o prospect a dar o próximo passo.',
                                    example: '"Posso te enviar uma simulação de valor?" ou "Vamos analisar seus próximos contratos?"',
                                    color: 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                }
                            ].map((item, idx) => (
                                <div key={idx} className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm relative group overflow-hidden">
                                    <div className="flex items-start justify-between mb-8">
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl ${item.color} shadow-sm group-hover:scale-110 transition-transform`}>
                                            {item.step}
                                        </div>
                                        <div className="text-right">
                                            <h4 className="font-black text-[#1B263B] text-xl mb-1">{item.title}</h4>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.subtitle}</p>
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 leading-relaxed mb-6 font-medium">{item.desc}</p>
                                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                        <p className="text-xs text-[#1B263B] font-bold mb-2 uppercase tracking-tight">Exemplo Prático:</p>
                                        <p className="text-xs text-slate-500 italic leading-relaxed">{item.example}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="bg-[#1B263B] p-10 rounded-[3.5rem] text-white relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-10 opacity-5">
                                <Search size={150} />
                            </div>
                            <div className="relative z-10 grid md:grid-cols-2 gap-12">
                                <div className="space-y-6">
                                    <h4 className="text-2xl font-black text-[#C69C6D]">Mindset Consultivo</h4>
                                    <p className="text-slate-300 text-sm leading-relaxed">
                                        Eduque enquanto vende. Muitas empresas não sabem que certas soluções existem. Quando você apresenta a ideia junto com a dor, você age como um consultor especialista.
                                    </p>
                                    <ul className="space-y-4">
                                        <li className="flex gap-4 items-center">
                                            <div className="w-2 h-2 rounded-full bg-[#C69C6D]"></div>
                                            <p className="text-sm text-slate-400"><span className="text-white font-bold">Ouvir Ativamente:</span> Não seja um monólogo.</p>
                                        </li>
                                        <li className="flex gap-4 items-center">
                                            <div className="w-2 h-2 rounded-full bg-[#C69C6D]"></div>
                                            <p className="text-sm text-slate-400"><span className="text-white font-bold">Personalizar:</span> Cite vitórias recentes do cliente.</p>
                                        </li>
                                        <li className="flex gap-4 items-center">
                                            <div className="w-2 h-2 rounded-full bg-[#C69C6D]"></div>
                                            <p className="text-sm text-slate-400"><span className="text-white font-bold">Empatia:</span> Transforme custo em oportunidade.</p>
                                        </li>
                                    </ul>
                                </div>
                                <div className="bg-white/5 p-8 rounded-[3rem] border border-white/10 flex flex-col justify-center text-center">
                                    <div className="w-16 h-16 bg-[#C69C6D] rounded-2xl flex items-center justify-center text-[#1B263B] shadow-lg mx-auto mb-6">
                                        <Star size={32} />
                                    </div>
                                    <h4 className="text-xl font-black text-white mb-4">Cultura de Venda</h4>
                                    <p className="text-sm text-slate-300 leading-relaxed italic">
                                        "Não tente apenas vender, entenda o negócio do cliente. Nosso diferencial é o conhecimento profundo do produto garantia."
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'tutorial-prevendas' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-2">Scripts de Pre-vendas</h3>
                            <p className="text-slate-500 font-medium">Metodologia para prospecção ativa e contorno de objeções.</p>
                        </div>

                        {/* Script de Ligações */}
                        <div className="space-y-8">
                            <div className="flex items-center gap-3 px-6">
                                <div className="p-3 bg-slate-100 rounded-2xl text-[#1B263B]">
                                    <Headset size={24} />
                                </div>
                                <h4 className="text-2xl font-black text-[#1B263B]">Script de Ligações</h4>
                            </div>

                            <div className="bg-[#1B263B] p-8 rounded-[2.5rem] text-white space-y-4 shadow-xl">
                                <h5 className="text-[#C69C6D] font-black uppercase text-xs tracking-widest flex items-center gap-2">
                                    <TrendingUp size={16} /> Estratégia Geral
                                </h5>
                                <p className="text-slate-300 text-sm leading-relaxed">
                                    A abordagem é consultiva e focada em <span className="text-white font-bold">validar e comparar</span> sem ser agressivo.
                                    O objetivo é se tornar uma opção de cotação para a próxima demanda.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 gap-8">
                                {/* Parte 1: Secretaria */}
                                <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
                                    <div className="bg-[#1B263B] px-8 py-5 flex justify-between items-center text-white">
                                        <h4 className="font-black text-lg">Parte 1: Passando pela Secretaria</h4>
                                        <span className="bg-[#C69C6D] text-[#1B263B] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Autoridade Emprestada</span>
                                    </div>
                                    <div className="p-8 space-y-6">
                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 italic text-slate-600 text-sm">
                                            "O objetivo aqui não é vender, é descobrir quem resolve. Use o nome do dono."
                                        </div>
                                        <div className="space-y-4">
                                            <p className="text-sm font-bold text-[#1B263B]">Roteiro Inicial:</p>
                                            <p className="text-slate-600 text-sm leading-relaxed border-l-4 border-[#C69C6D] pl-4">
                                                "Bom dia/tarde. Sou a <span className="font-bold">[SEU NOME]</span> da F&G Seguro Garantia. Preciso falar com <span className="font-bold">[Nome do Dono]</span>. É sobre os processos de licitação em andamento que a <span className="font-bold">[Nome da Empresa]</span>."
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
                                                <p className="font-black text-blue-900 text-xs uppercase mb-3 text-center">Cenário A: Ela passa o nome</p>
                                                <p className="text-xs text-blue-800 leading-relaxed italic">"Ah, é a Mariana."</p>
                                                <p className="text-xs font-bold text-blue-900 mt-2">Você: "Perfeito. Você pode me passar para a Mariana, por favor?"</p>
                                            </div>
                                            <div className="p-6 bg-orange-50/50 rounded-2xl border border-orange-100">
                                                <p className="font-black text-orange-900 text-xs uppercase mb-3 text-center">Cenário B: É o dono mesmo</p>
                                                <p className="text-xs text-orange-800 leading-relaxed italic">"Como é um assunto de prazos de edital, eu preciso enviar uma informação técnica..."</p>
                                                <p className="text-xs font-bold text-orange-900 mt-2">Peça o e-mail direto ou WhatsApp antes de desligar.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Parte 2: Decisor */}
                                <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
                                    <div className="bg-[#C69C6D] px-8 py-5 flex justify-between items-center text-white">
                                        <h4 className="font-black text-lg">Parte 2: Falando com o Decisor</h4>
                                        <span className="bg-[#1B263B] text-[#C69C6D] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Abordagem Consultiva</span>
                                    </div>
                                    <div className="p-8 space-y-6">
                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 italic text-slate-600 text-sm">
                                            "A linguagem muda para perguntas de validação e valor comercial."
                                        </div>
                                        <p className="text-slate-600 text-sm leading-relaxed border-l-4 border-[#1B263B] pl-4">
                                            "Olá <span className="font-bold">[Nome]</span>, Sou a <span className="font-bold">[SEU NOME]</span> da F&G Seguro Garantia. Tudo bem? Vou ser bem breve. Vi que vocês estão ativos em algumas licitações recentes..."
                                        </p>
                                        <div className="space-y-4">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pergunta de Validação:</p>
                                            <div className="bg-[#1B263B] text-white p-6 rounded-2xl font-bold text-sm">
                                                "Hoje, para cumprir a exigência dos editais, vocês já utilizam o Seguro Garantia?"
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">A Pergunta Chave:</p>
                                            <div className="bg-slate-100 p-6 rounded-2xl font-bold text-sm text-[#1B263B]">
                                                "Hoje, o que eu precisaria fazer para nos tornarmos uma opção de cotação na sua próxima demanda?"
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Parte 3: Fechamento */}
                                <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
                                    <div className="bg-[#1B263B] px-8 py-5 flex justify-between items-center text-white">
                                        <h4 className="font-black text-lg">Parte 3: O Fechamento</h4>
                                        <span className="bg-[#C69C6D] text-[#1B263B] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Baixo Risco</span>
                                    </div>
                                    <div className="p-8 space-y-6">
                                        <p className="text-slate-600 text-sm leading-relaxed">
                                            "Qual o WhatsApp ou e-mail direto de quem cota isso no dia a dia? Assim que tiverem uma demanda, nosso time faz o cálculo. Se meu preço for melhor, a gente fecha."
                                        </p>
                                        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 text-emerald-900 font-bold text-sm italic">
                                            "Se não for, pelo menos você balizou seu corretor atual. Pode ser?"
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Objeções da Secretaria */}
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                                <h4 className="text-xl font-black text-[#1B263B] border-b pb-4">Como lidar com as Objeções da Secretaria</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">"Manda e-mail geral"</p>
                                        <p className="text-xs text-slate-600 leading-relaxed italic border-l-2 border-slate-200 pl-4">"O e-mail geral costuma demorar. Você não teria o e-mail de quem toca as licitações? Prometo que só envio se for estritamente sobre isso."</p>
                                    </div>
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">"Não atendem corretores"</p>
                                        <p className="text-xs text-slate-600 leading-relaxed italic border-l-2 border-slate-200 pl-4">"É especificamente sobre a liberação de limite para os contratos públicos. É um assunto financeiro estratégico."</p>
                                    </div>
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">"Já temos corretor"</p>
                                        <p className="text-xs text-slate-600 leading-relaxed italic border-l-2 border-slate-200 pl-4">"Que bom! Minha intenção não é substituir seu corretor agora, é apenas garantir que não estejam pagando taxa acima do mercado por falta de comparação."</p>
                                    </div>
                                </div>
                            </div>

                            {/* Dicas de Ouro */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-[#1B263B] p-8 rounded-[2rem] text-white">
                                    <h5 className="font-black text-[#C69C6D] text-xs uppercase mb-4 tracking-widest">1. Evite a palavra "Vender"</h5>
                                    <p className="text-xs text-slate-400 leading-relaxed">Troque por <span className="text-white">Validar, Comparar, Cadastrar ou Otimizar</span>.</p>
                                </div>
                                <div className="bg-[#1B263B] p-8 rounded-[2rem] text-white">
                                    <h5 className="font-black text-[#C69C6D] text-xs uppercase mb-4 tracking-widest">2. Use Jargões do Nicho</h5>
                                    <p className="text-xs text-slate-400 leading-relaxed">Falar "Edital", "Tomador", "Apólice", "Seguradora" mostra autoridade.</p>
                                </div>
                                <div className="bg-[#1B263B] p-8 rounded-[2rem] text-white">
                                    <h5 className="font-black text-[#C69C6D] text-xs uppercase mb-4 tracking-widest">3. Peça Ajuda</h5>
                                    <p className="text-xs text-slate-400 leading-relaxed">"Estou meio perdido, preciso falar sobre o edital... quem você me recomenda?"</p>
                                </div>
                            </div>
                        </div>

                        <div className="h-[1px] bg-slate-200 my-12"></div>

                        {/* Script de Mensagens */}
                        <div className="space-y-8">
                            <div className="flex items-center gap-3 px-6">
                                <div className="p-3 bg-slate-100 rounded-2xl text-[#1B263B]">
                                    <MessageSquare size={24} />
                                </div>
                                <h4 className="text-2xl font-black text-[#1B263B]">Script de Mensagens</h4>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* WhatsApp */}
                                <div className="bg-[#25D366]/5 rounded-[2.5rem] border border-[#25D366]/20 overflow-hidden">
                                    <div className="bg-[#25D366] px-8 py-5 flex justify-between items-center text-white">
                                        <h5 className="font-black flex items-center gap-2 mt-0 mb-0">
                                            <MessageSquare size={18} /> WhatsApp
                                        </h5>
                                        <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Ágil e Humano</span>
                                    </div>
                                    <div className="p-8 space-y-6">
                                        <div className="space-y-4">
                                            <p className="text-[10px] font-black text-slate-400 uppercase">Mensagem 1: Abertura</p>
                                            <div className="bg-white p-4 rounded-xl text-xs text-slate-600 border border-slate-100 italic relative group">
                                                "Olá, [Nome do Decisor]. Tudo bem? Aqui é [Seu Nome], da F&G. Tentei contato por telefone... Peguei seu contato com a [Nome da Secretária]..."
                                                <button onClick={() => copyToClipboard('Olá, [Nome do Decisor]. Tudo bem?\nAqui é [Seu Nome], da F&G.\nTentei contato por telefone, mas imagino que esteja corrido. Peguei seu contato com a [Nome da Secretária] pois vi que a [Nome da Empresa do Cliente] tem participado ativamente de licitações recentes.')} className="absolute top-2 right-2 p-2 bg-slate-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Copy size={12} className="text-[#C69C6D]" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <p className="text-[10px] font-black text-slate-400 uppercase">Mensagem 2: O Gancho</p>
                                            <div className="bg-white p-4 rounded-xl text-xs text-slate-600 border border-slate-100 italic relative group">
                                                "Não quero tomar seu tempo... O meu objetivo é simples: ser um ponto de verificação de preço... Faz sentido pra você?"
                                                <button onClick={() => copyToClipboard('Não quero tomar seu tempo com apresentações. O meu objetivo é simples: ser um ponto de verificação de preço para os seus Seguros Garantia.\nNa próxima demanda que tiver na mesa, me permite fazer um cálculo sem compromisso? Se meu preço for melhor, a gente avança. Se não, você mantém seu corretor atual sabendo que ele está cobrando o justo.\nFaz sentido pra você?')} className="absolute top-2 right-2 p-2 bg-slate-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Copy size={12} className="text-[#C69C6D]" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* E-mail */}
                                <div className="bg-blue-50/50 rounded-[2.5rem] border border-blue-100 overflow-hidden">
                                    <div className="bg-blue-600 px-8 py-5 flex justify-between items-center text-white">
                                        <h5 className="font-black flex items-center gap-2 mt-0 mb-0">
                                            <MailOpen size={18} /> E-mail
                                        </h5>
                                        <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Formal e Autoridade</span>
                                    </div>
                                    <div className="p-8 space-y-6">
                                        <div className="bg-white p-6 rounded-2xl border border-blue-50 space-y-3">
                                            <p className="text-[10px] font-black text-blue-400 uppercase">Assunto:</p>
                                            <p className="text-xs font-bold text-[#1B263B]">Seguro Garantia / [Nome da Empresa] - Otimização de Custos</p>
                                            <div className="h-[1px] bg-slate-100 my-4"></div>
                                            <p className="text-[11px] text-slate-500 leading-relaxed italic">
                                                "Olá, [Nome]... conforme meu contato com a [Secretária]... Quero apenas que me envie o edital para uma cotação desafiante..."
                                            </p>
                                            <button onClick={() => copyToClipboard('Assunto: Seguro Garantia / [Nome da Empresa do Cliente] - Otimização de Custos\n\nOlá, [Nome do Decisor].\n\nConforme meu contato telefônico hoje com a [Nome da Secretária/Recepção], estou escrevendo diretamente a você pois identificamos a [Nome da Empresa] ativa em processos licitatórios recentes.\n\nSabemos que o Seguro Garantia é uma commodity necessária, mas que impacta a margem do contrato se não for bem negociado.\n\nMinha proposta é prática:\nNão quero que troque de corretor agora. Quero apenas que, na sua próxima necessidade de apólice (seja de participação ou execução), você me envie o edital para uma cotação desafiante.\n\nO que ganhamos com isso?\n1. Você valida se as taxas que paga hoje estão competitivas.\n2. Eu tenho a chance de provar nosso valor na prática, com preço e agilidade na emissão.\n\nPosso ficar no seu radar para a próxima?\n\nAtenciosamente,\n[Seu Nome]\n[Seu Link do WhatsApp]')} className="w-full py-3 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-colors mt-4">
                                                Copiar Roteiro E-mail
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Pulo do Gato: Áudio */}
                            <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:scale-110 transition-transform">
                                    <Headset size={150} />
                                </div>
                                <div className="relative z-10 flex flex-col md:flex-row gap-10">
                                    <div className="md:w-1/3">
                                        <div className="bg-amber-50 text-amber-600 p-3 rounded-2xl w-fit mb-6 shadow-sm shadow-amber-200/50">
                                            <Zap size={28} />
                                        </div>
                                        <h4 className="text-2xl font-black text-[#1B263B] mb-2">O "Pulo do Gato"</h4>
                                        <p className="text-xs font-black text-[#C69C6D] uppercase tracking-[2px]">Mensagem de áudio no WhatsApp</p>
                                    </div>
                                    <div className="md:w-2/3 bg-slate-50 p-8 rounded-[2rem] border border-slate-100">
                                        <p className="text-sm text-slate-500 mb-6 italic leading-relaxed">
                                            "Se visualizou e não respondeu: mande um áudio de 20-30 segundos. Gera conexão pessoal."
                                        </p>
                                        <div className="bg-white p-6 rounded-2xl border border-slate-100 text-[#1B263B] font-medium text-sm leading-relaxed border-l-4 border-amber-400">
                                            "Oi [Nome], [Seu Nome] de novo. Só pra não deixar mensagem de texto perdida... Minha intenção não é te dar trabalho, é só deixar meu contato salvo aí como 'Fulano do Seguro Garantia'. O dia que o corretor demorar ou o preço vier salgado, você me chama!"
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Dicas Finais */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-[#1B263B] p-10 rounded-[2.5rem] shadow-sm text-white">
                                    <h5 className="font-black text-[#C69C6D] mb-4">1. Personalização Mínima</h5>
                                    <p className="text-sm text-slate-400 leading-relaxed">
                                        Se souber de um edital que eles ganharam recentemente, cite-o. Ex: <span className="text-white italic">"Vi que venceram o pregão do órgão X..."</span>. Isso prova que você não é um robô.
                                    </p>
                                </div>
                                <div className="bg-[#1B263B] p-10 rounded-[2.5rem] shadow-sm text-white">
                                    <h5 className="font-black text-[#C69C6D] mb-4">2. O "Call to Action" (CTA)</h5>
                                    <p className="text-sm text-slate-400 leading-relaxed">
                                        Não peça uma reuniões de 30 min. Peça uma <span className="text-white font-bold">oportunidade de cotar</span>. É baixo risco e alta conversão.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === 'pos-venda' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm border-t-4 border-t-[#C69C6D]">
                            <h3 className="text-3xl font-black text-[#1B263B] mb-4">Pós-Venda Estratégico</h3>
                            <p className="text-slate-500 font-medium italic">O Seguro Garantia é cíclico. Não espere ser procurado, faça contatos proativos.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-black text-[#1B263B] mb-8 flex items-center gap-3">
                                    <History className="text-[#C69C6D]" size={28} />
                                    Ciclo do Cliente
                                </h3>
                                <div className="space-y-6">
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        Lembre-se: o produto não requer renovação formal em muitos casos, mas a <span className="text-[#C69C6D] font-bold">proatividade</span> é o que mantém o cliente fiel à F&G.
                                    </p>
                                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex items-start gap-4">
                                        <Info className="text-blue-500 shrink-0" size={20} />
                                        <p className="text-xs text-slate-500 italic">"Esteja presente nas vitórias e nos momentos de dúvida do tomador."</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-black text-[#1B263B] mb-8 flex items-center gap-3">
                                    <LayoutDashboard className="text-[#C69C6D]" size={28} />
                                    Gestão Interna (CRM)
                                </h3>
                                <div className="space-y-4">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">O que saber sobre seu cliente:</p>
                                    <ul className="space-y-3">
                                        {[
                                            'Pessoas de contato, e-mails e telefones diretos.',
                                            'Datas e observações importantes do dia a dia.',
                                            'Resumo do cadastro dele nas Cias Seguradoras.',
                                            'Breve histórico do relacionamento comercial.'
                                        ].map((item, idx) => (
                                            <li key={idx} className="flex gap-3 text-sm text-slate-600 font-medium">
                                                <CircleCheck size={16} className="text-[#C69C6D] shrink-0" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="bg-[#1B263B] p-10 rounded-[3rem] shadow-sm text-white relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-110 transition-transform">
                                <Megaphone size={120} />
                            </div>
                            <div className="relative z-10">
                                <h4 className="text-2xl font-black text-[#C69C6D] mb-6 flex items-center gap-4">
                                    <div className="p-3 bg-[#C69C6D]/20 rounded-2xl">
                                        <Heart size={24} className="text-[#C69C6D]" />
                                    </div>
                                    Dia da Licitação: Contato Ativo
                                </h4>
                                <div className="bg-white/5 p-8 rounded-[2rem] border border-white/10 space-y-6">
                                    <p className="text-slate-300 text-sm italic">
                                        "Oi, Sr. XXX, estamos na expectativa para saber como foi o pregão de hoje. Por favor, nos mantenha informados. Estamos na torcida por aqui!"
                                    </p>
                                    <button
                                        onClick={() => copyToClipboard('Oi, Sr. XXX,\n\nEstamos na expectativa para saber como foi o pregão de hoje. Por favor, nos mantenha informados. Estamos na torcida por aqui!')}
                                        className="bg-[#C69C6D] text-[#1B263B] px-8 py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#b58a5b] transition-all shadow-xl shadow-[#C69C6D]/10"
                                    >
                                        COPIAR MENSAGEM PROATIVA
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Toast Notification */}
            {showToast && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-[#1B263B] text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300 z-50 border-l-4 border-[#C69C6D]">
                    <CircleCheck size={20} className="text-[#C69C6D]" />
                    <span className="font-bold text-sm">Copiado para a área de transferência!</span>
                </div>
            )}
        </div>
    );
};

export default InternalProcedures;
