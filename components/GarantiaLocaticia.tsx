import React, { useState, useEffect, useMemo } from 'react';
import { Calculator, Copy, CheckCircle2, Save, Loader2, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  calcGarantia,
  fmtBRL,
  fmtDate,
  maskCurrency,
  parseCurrencyMask,
  GarantiaConfig,
  DEFAULT_CONFIG,
} from '../utils/garantiaCalc.ts';
import { buildMensagemBoleto, buildMensagemCartao } from '../utils/garantiaTemplates.ts';

const GarantiaLocaticia: React.FC = () => {
  // Inputs
  const [aluguelMasked, setAluguelMasked] = useState('');
  const [outrosMasked, setOutrosMasked] = useState('');
  const [forma, setForma] = useState<'cartao' | 'boleto'>('cartao');
  const [dataPrimeiroPag, setDataPrimeiroPag] = useState(() => new Date().toISOString().slice(0, 10));
  const [nomeCliente, setNomeCliente] = useState('');
  const [endereco, setEndereco] = useState('');
  const [tipoImovel, setTipoImovel] = useState<'residencial' | 'comercial'>('residencial');

  // Config & data
  const [config, setConfig] = useState<GarantiaConfig>(DEFAULT_CONFIG);
  const [configEdit, setConfigEdit] = useState<GarantiaConfig>(DEFAULT_CONFIG);
  const [simulacoes, setSimulacoes] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // UI state
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [savingParams, setSavingParams] = useState(false);

  // Computed values
  const aluguel = parseCurrencyMask(aluguelMasked);
  const outros = parseCurrencyMask(outrosMasked);

  const result = useMemo(() => {
    if (aluguel <= 0) return null;
    return calcGarantia(aluguel, outros, forma, dataPrimeiroPag, config);
  }, [aluguel, outros, forma, dataPrimeiroPag, config]);

  const mensagem = useMemo(() => {
    if (!result) return '';
    if (result.forma === 'boleto') {
      return buildMensagemBoleto(result, aluguel, nomeCliente, endereco);
    }
    return buildMensagemCartao(result, aluguel, nomeCliente, endereco);
  }, [result, aluguel, nomeCliente, endereco]);

  const loadSimulacoes = async () => {
    const { data } = await supabase
      .from('simulacoes_garantia_locaticia')
      .select('id, nome_cliente, forma_pagamento, aluguel_centavos, total_forma_centavos, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    setSimulacoes(data || []);
  };

  useEffect(() => {
    supabase
      .from('garantia_locaticia_config')
      .select('*')
      .single()
      .then(({ data }) => {
        if (data) {
          const cfg: GarantiaConfig = {
            taxa_anual: Number(data.taxa_anual),
            setup_centavos: data.setup_centavos,
            fator_boleto: Number(data.fator_boleto),
            parcelas: data.parcelas,
            garantidora: data.garantidora,
          };
          setConfig(cfg);
          setConfigEdit(cfg);
        }
      })
      .catch(() => {});

    supabase.auth.getUser().then(({ data }) => {
      setIsAdmin(data?.user?.email === 'fabio@fegsegurogarantia.com.br');
    });

    loadSimulacoes();
  }, []);

  const handleSalvar = async () => {
    if (!result) return;
    setSaving(true);
    try {
      await supabase.from('simulacoes_garantia_locaticia').insert({
        nome_cliente: nomeCliente || null,
        endereco: endereco || null,
        tipo_imovel: tipoImovel,
        aluguel_centavos: aluguel,
        outros_centavos: outros,
        forma_pagamento: forma,
        data_primeiro_pagamento: dataPrimeiroPag,
        base_mensal_centavos: result.base_mensal,
        base_anual_centavos: result.base_anual,
        premio_centavos: result.premio,
        setup_centavos: result.setup,
        total_avista_centavos: result.total_avista,
        total_forma_centavos: result.total_forma,
        taxa_anual_snapshot: config.taxa_anual,
        setup_snapshot: config.setup_centavos,
        fator_boleto_snapshot: config.fator_boleto,
        parcelas_snapshot: config.parcelas,
        garantidora_snapshot: config.garantidora,
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
      loadSimulacoes();
    } finally {
      setSaving(false);
    }
  };

  const handleSalvarParams = async () => {
    setSavingParams(true);
    try {
      await supabase
        .from('garantia_locaticia_config')
        .update({
          taxa_anual: configEdit.taxa_anual,
          setup_centavos: configEdit.setup_centavos,
          fator_boleto: configEdit.fator_boleto,
          parcelas: configEdit.parcelas,
          garantidora: configEdit.garantidora,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);

      const { data } = await supabase
        .from('garantia_locaticia_config')
        .select('*')
        .single();
      if (data) {
        const cfg: GarantiaConfig = {
          taxa_anual: Number(data.taxa_anual),
          setup_centavos: data.setup_centavos,
          fator_boleto: Number(data.fator_boleto),
          parcelas: data.parcelas,
          garantidora: data.garantidora,
        };
        setConfig(cfg);
        setConfigEdit(cfg);
      }
    } finally {
      setSavingParams(false);
    }
  };

  const handleCopiarMensagem = () => {
    navigator.clipboard.writeText(mensagem).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-3">
      <div className="w-1.5 h-6 bg-[#C69C6D] rounded-full"></div>
      {children}
    </h3>
  );

  const InputLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
      {children}
    </label>
  );

  const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#1B263B] rounded-[2rem] p-8 text-white relative overflow-hidden shadow-lg">
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-14 h-14 bg-[#C69C6D]/20 rounded-2xl flex items-center justify-center border border-[#C69C6D]/30">
            <Calculator size={28} className="text-[#C69C6D]" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Garantia Locatícia</h1>
            <p className="text-slate-400 text-sm font-medium mt-0.5">
              Simulação e envio — {config.garantidora}
            </p>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-48 h-48 bg-[#C69C6D] opacity-[0.05] rounded-full blur-[60px] pointer-events-none"></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT — Formulário */}
        <div className="xl:col-span-1 space-y-6">

          {/* Dados do imóvel */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <SectionTitle>Dados do Imóvel</SectionTitle>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <InputLabel>Nome do Cliente (opcional)</InputLabel>
                <input
                  className={inputCls}
                  placeholder="Ex.: João Silva"
                  value={nomeCliente}
                  onChange={e => setNomeCliente(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <InputLabel>Endereço do Imóvel (opcional)</InputLabel>
                <input
                  className={inputCls}
                  placeholder="Ex.: Rua das Flores, 123 — Apto 42"
                  value={endereco}
                  onChange={e => setEndereco(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <InputLabel>Tipo de Imóvel</InputLabel>
                <div className="flex gap-2">
                  {(['residencial', 'comercial'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTipoImovel(t)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all ${
                        tipoImovel === t
                          ? 'bg-[#1B263B] text-white shadow-md'
                          : 'bg-white text-slate-500 border border-slate-200 hover:border-[#C69C6D]'
                      }`}
                    >
                      {t === 'residencial' ? 'Residencial' : 'Comercial'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Valores */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <SectionTitle>Valores Mensais</SectionTitle>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <InputLabel>Aluguel (R$) *</InputLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">R$</span>
                  <input
                    className={`${inputCls} pl-10`}
                    placeholder="0,00"
                    value={aluguelMasked}
                    onChange={e => setAluguelMasked(maskCurrency(e.target.value))}
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <InputLabel>Outros Encargos (IPTU + Cond.) R$</InputLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">R$</span>
                  <input
                    className={`${inputCls} pl-10`}
                    placeholder="0,00"
                    value={outrosMasked}
                    onChange={e => setOutrosMasked(maskCurrency(e.target.value))}
                    inputMode="numeric"
                  />
                </div>
              </div>
              {(aluguel > 0 || outros > 0) && (
                <div className="bg-slate-50 rounded-xl px-4 py-3 flex justify-between items-center">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Base Mensal</span>
                  <span className="text-sm font-black text-slate-800">{fmtBRL(aluguel + outros)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Pagamento */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <SectionTitle>Forma de Pagamento</SectionTitle>
            <div className="space-y-4">
              <div className="flex gap-2">
                {(['cartao', 'boleto'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setForma(f)}
                    className={`flex-1 py-3 rounded-xl text-sm font-black transition-all ${
                      forma === f
                        ? 'bg-[#1B263B] text-white shadow-md'
                        : 'bg-white text-slate-500 border border-slate-200 hover:border-[#C69C6D]'
                    }`}
                  >
                    {f === 'cartao' ? 'Cartão (sem juros)' : 'Boleto (com juros)'}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <InputLabel>1º Vencimento</InputLabel>
                <input
                  type="date"
                  className={inputCls}
                  value={dataPrimeiroPag}
                  onChange={e => setDataPrimeiroPag(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Parâmetros (admin only) */}
          {isAdmin && (
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
              <button
                onClick={() => setShowParams(p => !p)}
                className="w-full flex items-center justify-between"
              >
                <SectionTitle>Parâmetros da Garantidora</SectionTitle>
                {showParams ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
              </button>

              {showParams && (
                <div className="space-y-4 mt-2">
                  <div className="space-y-1.5">
                    <InputLabel>Taxa Anual (%)</InputLabel>
                    <input
                      type="number"
                      step="0.01"
                      className={inputCls}
                      value={(configEdit.taxa_anual * 100).toFixed(2)}
                      onChange={e => setConfigEdit(c => ({ ...c, taxa_anual: Number(e.target.value) / 100 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <InputLabel>Setup (R$)</InputLabel>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        className={`${inputCls} pl-10`}
                        value={(configEdit.setup_centavos / 100).toFixed(2)}
                        onChange={e => setConfigEdit(c => ({ ...c, setup_centavos: Math.round(Number(e.target.value) * 100) }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <InputLabel>Fator Boleto</InputLabel>
                    <input
                      type="number"
                      step="0.000001"
                      className={inputCls}
                      value={configEdit.fator_boleto}
                      onChange={e => setConfigEdit(c => ({ ...c, fator_boleto: Number(e.target.value) }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <InputLabel>Garantidora</InputLabel>
                    <input
                      className={inputCls}
                      value={configEdit.garantidora}
                      onChange={e => setConfigEdit(c => ({ ...c, garantidora: e.target.value }))}
                    />
                  </div>
                  <button
                    onClick={handleSalvarParams}
                    disabled={savingParams}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-sm rounded-xl transition-all disabled:opacity-50"
                  >
                    {savingParams ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Salvar Parâmetros
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — Resultado */}
        <div className="xl:col-span-2 space-y-6">
          {!result ? (
            <div className="bg-white rounded-[2rem] p-16 shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-6">
                <Calculator size={36} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-lg">Informe o valor do aluguel</p>
              <p className="text-slate-300 text-sm mt-2">O resultado aparecerá aqui automaticamente</p>
            </div>
          ) : (
            <>
              {/* Desembolso mensal — destaque */}
              <div className="bg-[#1B263B] rounded-2xl p-6 text-center">
                <p className="text-[#C69C6D]/70 text-xs font-black uppercase tracking-widest mb-2">
                  {forma === 'boleto' ? '1º MÊS' : 'DESEMBOLSO MENSAL'}
                </p>
                <p className="text-[#C69C6D] text-4xl font-black">
                  {result.forma === 'boleto' ? fmtBRL(result.desembolso_mes1) : fmtBRL(result.desembolso_mensal)}
                </p>
                <p className="text-white/50 text-xs mt-1">aluguel + parcela da garantia</p>
                {result.forma === 'boleto' && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <p className="text-white/60 text-xs font-black uppercase tracking-widest mb-1">DO 2º AO 12º MÊS</p>
                    <p className="text-white text-2xl font-black">{fmtBRL(result.desembolso_demais)}</p>
                  </div>
                )}
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Prêmio Anual', value: fmtBRL(result.premio) },
                  { label: 'Setup (Cadastro)', value: fmtBRL(result.setup) },
                  { label: 'Total à Vista', value: fmtBRL(result.total_avista) },
                  {
                    label: forma === 'boleto' ? 'Total no Boleto' : 'Total no Cartão',
                    value: fmtBRL(result.total_forma),
                    highlight: forma === 'boleto' && result.forma === 'boleto',
                  },
                ].map((card, i) => (
                  <div
                    key={i}
                    className={`rounded-2xl p-5 border ${
                      (card as any).highlight
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-white border-slate-100'
                    }`}
                  >
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{card.label}</p>
                    <p className="text-lg font-black text-slate-800">{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Boleto extras */}
              {result.forma === 'boleto' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-2xl p-5 border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Custo do Financiamento</p>
                    <p className="text-lg font-black text-amber-600">{fmtBRL(result.custo_financiamento)}</p>
                  </div>
                  <div className="bg-white rounded-2xl p-5 border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Taxa Mensal Efetiva</p>
                    <p className="text-lg font-black text-slate-800">{(result.taxa_mensal_efetiva * 100).toFixed(2).replace('.', ',')}% a.m.</p>
                  </div>
                </div>
              )}

              {/* Tabela de parcelas */}
              <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                <SectionTitle>Cronograma de Parcelas</SectionTitle>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-4 py-2 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Parcela</th>
                        <th className="px-4 py-2 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Vencimento</th>
                        <th className="px-4 py-2 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.parcelas.map(p => (
                        <tr key={p.numero} className="border-t border-slate-50 hover:bg-slate-50/50">
                          <td className="px-4 py-2 font-bold text-slate-700">{p.numero}ª</td>
                          <td className="px-4 py-2 text-slate-500">{fmtDate(p.data_vencimento)}</td>
                          <td className="px-4 py-2 text-right font-black text-slate-800">{fmtBRL(p.valor_centavos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mensagem WhatsApp */}
              <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                <SectionTitle>Mensagem para o Cliente</SectionTitle>
                <div className="bg-slate-50 rounded-xl p-4 mb-4 font-mono text-xs text-slate-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto border border-slate-100">
                  {mensagem}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleCopiarMensagem}
                    className="flex items-center gap-2 px-6 py-3 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-sm rounded-xl transition-all"
                  >
                    {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    {copied ? 'Copiado!' : 'Copiar Mensagem'}
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl transition-all"
                  >
                    <MessageCircle size={14} />
                    Abrir no WhatsApp
                  </a>
                  <button
                    onClick={handleSalvar}
                    disabled={saving}
                    className={`flex items-center gap-2 px-6 py-3 font-black text-sm rounded-xl transition-all ${
                      savedOk
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : savedOk ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    {savedOk ? 'Salvo!' : 'Salvar Simulação'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Histórico de simulações */}
          {simulacoes.length > 0 && (
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
              <SectionTitle>Últimas Simulações</SectionTitle>
              <div className="space-y-2">
                {simulacoes.map(sim => (
                  <div
                    key={sim.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-all"
                  >
                    <div>
                      <p className="text-sm font-black text-slate-700">
                        {sim.nome_cliente || 'Cliente não informado'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {sim.forma_pagamento === 'cartao' ? 'Cartão' : 'Boleto'} —{' '}
                        {new Date(sim.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Aluguel</p>
                      <p className="text-sm font-black text-slate-700">{fmtBRL(sim.aluguel_centavos)}</p>
                      <p className="text-xs text-[#C69C6D] font-black">Total: {fmtBRL(sim.total_forma_centavos)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GarantiaLocaticia;
