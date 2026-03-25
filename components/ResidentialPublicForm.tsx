import React, { useState } from 'react';
import { Home, Loader2, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ORIGEM_MARKER = '[origem:formulario-publico]';

const TIPO_SEGURO = [
    'Apenas Garantia Locatícia',
    'Apenas Seguro Residencial',
    'Garantia Locatícia & Seguro Residencial',
] as const;

const ESTADO_CIVIL = ['Casado(a)', 'Solteiro(a)', 'Separado(a)', 'Viúvo(a)'] as const;

const TIPO_IMOVEL = ['Casa', 'Apartamento', 'Casa em condomínio', 'Comercial'] as const;

const formatCPF = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 11);
    return d
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

const formatCNPJ = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 14);
    return d
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2');
};

const formatCpfCnpj = (value: string) => {
    const d = value.replace(/\D/g, '');
    if (d.length <= 11) return formatCPF(value);
    return formatCNPJ(value);
};

const formatPhone = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) {
        return d
            .replace(/(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{4})(\d)/, '$1-$2');
    }
    return d
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{4})\d+?$/, '$1');
};

const formatCEP = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 8);
    return d.replace(/(\d{5})(\d)/, '$1-$2');
};

const formatCurrency = (value: string) => {
    const numericValue = value.replace(/\D/g, '');
    if (!numericValue) return '';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(numericValue) / 100);
};

function buildObs(fields: {
    telefone2: string;
    estadoCivil: string;
    cep: string;
    numeroImovel: string;
    tipoImovel: string;
    valorImovel: string;
    valorAluguel: string;
    dataPrimeiroPagamento: string;
    valorIptuCondominio: string;
}) {
    return [
        ORIGEM_MARKER,
        `Telefone / Celular 2: ${fields.telefone2.trim() || '—'}`,
        `Estado civil: ${fields.estadoCivil}`,
        `CEP do imóvel: ${fields.cep.trim() || '—'}`,
        `Número do imóvel: ${fields.numeroImovel.trim() || '—'}`,
        `Tipo de imóvel: ${fields.tipoImovel}`,
        `Valor do imóvel: ${fields.valorImovel.trim() || '—'}`,
        `Valor do aluguel: ${fields.valorAluguel.trim() || '—'}`,
        `Data do 1º pagamento do aluguel: ${fields.dataPrimeiroPagamento || '—'}`,
        `Valor IPTU e/ou condomínio: ${fields.valorIptuCondominio.trim() || '—'}`,
        `Enviado em: ${new Date().toISOString()}`,
    ].join('\n');
}

const ResidentialPublicForm: React.FC = () => {
    const [tipoSeguro, setTipoSeguro] = useState<string>(TIPO_SEGURO[0]);
    const [nomeCompleto, setNomeCompleto] = useState('');
    const [cpfCnpj, setCpfCnpj] = useState('');
    const [telefone1, setTelefone1] = useState('');
    const [telefone2, setTelefone2] = useState('');
    const [email, setEmail] = useState('');
    const [estadoCivil, setEstadoCivil] = useState<string>(ESTADO_CIVIL[0]);
    const [cep, setCep] = useState('');
    const [numeroImovel, setNumeroImovel] = useState('');
    const [tipoImovel, setTipoImovel] = useState<string>(TIPO_IMOVEL[0]);
    const [valorImovel, setValorImovel] = useState('');
    const [valorAluguel, setValorAluguel] = useState('');
    const [dataPrimeiroPagamento, setDataPrimeiroPagamento] = useState('');
    const [valorIptuCondominio, setValorIptuCondominio] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const temGarantiaLocaticia =
        tipoSeguro === 'Apenas Garantia Locatícia' || tipoSeguro === 'Garantia Locatícia & Seguro Residencial';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            const obs = buildObs({
                telefone2,
                estadoCivil,
                cep,
                numeroImovel,
                tipoImovel,
                valorImovel,
                valorAluguel,
                dataPrimeiroPagamento,
                valorIptuCondominio,
            });

            const payload = {
                nome: nomeCompleto.trim(),
                cpf: cpfCnpj.trim() || null,
                telefone: telefone1.trim() || null,
                email: email.trim() || null,
                produto: tipoSeguro,
                apolice: null as string | null,
                premio_total: null as string | null,
                comissao: null as string | null,
                data_emissao: null as string | null,
                fim_vigencia: null as string | null,
                forma_pagamento: null as string | null,
                situacao: 'Lead (site)',
                obs,
                tem_garantia: temGarantiaLocaticia ? 'Sim' : 'Não',
                garantia_inicio: null as string | null,
                garantia_fim: null as string | null,
                garantia_valor: null as string | null,
            };

            const { error: insertError } = await supabase.from('residential_clients').insert([payload]);
            if (insertError) throw insertError;

            setDone(true);
            setNomeCompleto('');
            setCpfCnpj('');
            setTelefone1('');
            setTelefone2('');
            setEmail('');
            setCep('');
            setNumeroImovel('');
            setValorImovel('');
            setValorAluguel('');
            setDataPrimeiroPagamento('');
            setValorIptuCondominio('');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Não foi possível enviar. Tente novamente.';
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="h-[100dvh] min-h-0 overflow-y-auto overflow-x-hidden bg-[#F5F1EA] text-slate-800 custom-scroll">
            <header className="bg-[#1B263B] text-white border-b-4 border-[#C69C6D]">
                <div className="max-w-3xl mx-auto px-5 py-8 flex flex-col sm:flex-row sm:items-center gap-6">
                    <img src="/logo.svg" alt="F&G Corretora" className="h-16 w-auto object-contain" />
                    <div>
                        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#F5F1EA]">
                            Seguro Residencial / Locatícia
                        </h1>
                        <p className="text-sm text-[#C69C6D] font-bold mt-1">Solicitação de cotação — F&G Corretora</p>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-5 py-10 pb-16">
                {done ? (
                    <div className="bg-white rounded-2xl border-2 border-[#C69C6D]/40 shadow-xl p-8 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                            <CheckCircle2 size={36} />
                        </div>
                        <h2 className="text-2xl font-black text-[#1B263B]">Recebemos sua solicitação</h2>
                        <p className="text-slate-600 font-medium">
                            Em breve nossa equipe entra em contato pelo telefone ou e-mail informados.
                        </p>
                        <button
                            type="button"
                            onClick={() => setDone(false)}
                            className="mt-4 bg-[#1B263B] text-[#F5F1EA] px-6 py-3 rounded-xl font-bold text-sm border border-[#C69C6D]/40 hover:bg-[#243347] transition-colors"
                        >
                            Enviar outra solicitação
                        </button>
                    </div>
                ) : (
                    <form
                        onSubmit={handleSubmit}
                        className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden"
                    >
                        <div className="h-1.5 bg-gradient-to-r from-[#1B263B] via-[#243347] to-[#C69C6D]" />
                        <div className="p-6 sm:p-10 space-y-8">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[#1B263B] flex items-center justify-center shrink-0">
                                    <Home className="text-[#C69C6D]" size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-[#1B263B]">Dados para contato e imóvel</h2>
                                    <p className="text-xs text-slate-500 font-medium mt-1">
                                        Preencha com atenção. Campos com * são obrigatórios.
                                    </p>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-bold">
                                    <AlertCircle size={20} className="shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                    Tipo de seguro *
                                </label>
                                <select
                                    value={tipoSeguro}
                                    onChange={(e) => setTipoSeguro(e.target.value)}
                                    required
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                >
                                    {TIPO_SEGURO.map((t) => (
                                        <option key={t} value={t}>
                                            {t}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div className="space-y-2 sm:col-span-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Nome completo do inquilino *
                                    </label>
                                    <input
                                        type="text"
                                        value={nomeCompleto}
                                        onChange={(e) => setNomeCompleto(e.target.value)}
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="Nome completo"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        CPF / CNPJ *
                                    </label>
                                    <input
                                        type="text"
                                        value={cpfCnpj}
                                        onChange={(e) => setCpfCnpj(formatCpfCnpj(e.target.value))}
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="CPF ou CNPJ"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        E-mail *
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="seu@email.com"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Telefone / Celular 1 *
                                    </label>
                                    <input
                                        type="text"
                                        value={telefone1}
                                        onChange={(e) => setTelefone1(formatPhone(e.target.value))}
                                        required
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="(00) 00000-0000"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Telefone / Celular 2
                                    </label>
                                    <input
                                        type="text"
                                        value={telefone2}
                                        onChange={(e) => setTelefone2(formatPhone(e.target.value))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="Opcional"
                                    />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Estado civil
                                    </label>
                                    <select
                                        value={estadoCivil}
                                        onChange={(e) => setEstadoCivil(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                    >
                                        {ESTADO_CIVIL.map((ec) => (
                                            <option key={ec} value={ec}>
                                                {ec}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        CEP do imóvel
                                    </label>
                                    <input
                                        type="text"
                                        value={cep}
                                        onChange={(e) => setCep(formatCEP(e.target.value))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="00000-000"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Número do imóvel
                                    </label>
                                    <input
                                        type="text"
                                        value={numeroImovel}
                                        onChange={(e) => setNumeroImovel(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="Nº"
                                    />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Tipo de imóvel
                                    </label>
                                    <select
                                        value={tipoImovel}
                                        onChange={(e) => setTipoImovel(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                    >
                                        {TIPO_IMOVEL.map((t) => (
                                            <option key={t} value={t}>
                                                {t}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Valor do imóvel
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={valorImovel}
                                        onChange={(e) => setValorImovel(formatCurrency(e.target.value))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="R$ 0,00"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Valor do aluguel
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={valorAluguel}
                                        onChange={(e) => setValorAluguel(formatCurrency(e.target.value))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="R$ 0,00"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Data do primeiro pagamento do aluguel
                                    </label>
                                    <input
                                        type="date"
                                        value={dataPrimeiroPagamento}
                                        onChange={(e) => setDataPrimeiroPagamento(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-[#1B263B] uppercase tracking-widest">
                                        Valor IPTU e/ou condomínio
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={valorIptuCondominio}
                                        onChange={(e) => setValorIptuCondominio(formatCurrency(e.target.value))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] outline-none"
                                        placeholder="R$ 0,00"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-100">
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="w-full sm:w-auto bg-[#C69C6D] hover:bg-[#b58a5b] text-[#1B263B] font-black text-sm px-8 py-4 rounded-xl shadow-lg border border-[#1B263B]/10 flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                                >
                                    {submitting ? (
                                        <>
                                            <Loader2 className="animate-spin" size={20} />
                                            Enviando...
                                        </>
                                    ) : (
                                        <>
                                            <Send size={18} />
                                            Enviar solicitação
                                        </>
                                    )}
                                </button>
                                <p className="text-[10px] text-slate-400 font-medium mt-4">
                                    Ao enviar, você concorda em ser contatado(a) pela F&G Corretora quanto a esta solicitação.
                                </p>
                            </div>
                        </div>
                    </form>
                )}
            </main>

            <footer className="border-t border-slate-200 bg-white/80 py-6 text-center text-xs text-slate-500 font-medium">
                F&G Corretora de Seguros — formulário exclusivo para cotação Seguro Residencial / Locatícia
            </footer>
        </div>
    );
};

export default ResidentialPublicForm;
