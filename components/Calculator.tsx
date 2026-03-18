
import React, { useState, useEffect } from 'react';
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatters';
import { Info, Calculator as CalcIcon, Percent, Calendar, FileText, ChevronRight, Scale } from 'lucide-react';

const Calculator: React.FC = () => {
  // Estados para Seguro Garantia
  const [valorContrato, setValorContrato] = useState<string>('0,00');
  const [percentualGarantia, setPercentualGarantia] = useState<string>('0,00');
  const [taxaTomador, setTaxaTomador] = useState<string>('0,00');
  const [vigenciaDias, setVigenciaDias] = useState<string>('0');
  const [somarAdicional, setSomarAdicional] = useState(false);

  // Estados para Seguro Adicional
  const [edital, setEdital] = useState<string>('0,00');
  const [lancePregao, setLancePregao] = useState<string>('0,00');
  const [percentualGarantiaContratual, setPercentualGarantiaContratual] = useState<string>('5,00');

  // Cálculos Automáticos (Lógica baseada no HTML fornecido)
  const numValorContrato = parseNumber(valorContrato);
  const numPercentualGarantia = parseNumber(percentualGarantia);
  const numTaxaTomador = parseNumber(taxaTomador);
  const numVigenciaDias = parseInt(vigenciaDias) || 0;
  
  const numEdital = parseNumber(edital);
  const numLancePregao = parseNumber(lancePregao);

  // Cálculos Adicional
  const numPercentualGarantiaContratual = parseNumber(percentualGarantiaContratual);
  const edital85 = numEdital * 0.85;
  const garantiaAdicional = Math.max(0, edital85 - numLancePregao);
  const garantiaContratual = numLancePregao * (numPercentualGarantiaContratual / 100);
  const totalGarantia = garantiaAdicional + garantiaContratual;

  // Cálculos Garantia
  let importanciaSegurada = numValorContrato * (numPercentualGarantia / 100);
  if (somarAdicional) {
    importanciaSegurada += garantiaAdicional;
  }

  const premioAnual = importanciaSegurada * (numTaxaTomador / 100);
  const premioTotal = (premioAnual / 365) * numVigenciaDias;

  const handleInputChange = (value: string, setter: (v: string) => void, isInt: boolean = false) => {
    // Remove tudo que não é dígito
    const cleanValue = value.replace(/\D/g, '');
    if (isInt) {
      setter(cleanValue || '0');
      return;
    }
    // Formata como decimal (2 casas)
    const num = parseFloat(cleanValue) / 100;
    setter(formatNumber(num));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-8">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
             <div className="bg-[#1B263B] p-2 rounded-xl text-[#C69C6D]">
                <CalcIcon size={24} />
             </div>
             Calculadora de Seguro
          </h2>
          <p className="text-slate-500 font-medium mt-1">F&G Seguro Garantia 2026 • Ferramenta de Precisão</p>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Seção 1: Seguro Garantia */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="bg-[#1B263B] p-8 text-white">
            <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
               <Scale size={20} className="text-[#C69C6D]" />
               Seguro Garantia
            </h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Parâmetros Principais do Contrato</p>
          </div>
          
          <div className="p-8 space-y-6 flex-1">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor do Contrato</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">R$</span>
                    <input 
                      type="text" 
                      value={valorContrato}
                      onChange={(e) => handleInputChange(e.target.value, setValorContrato)}
                      className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-bold text-slate-700 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Percentual de Garantia (%)</label>
                  <div className="relative">
                    <Percent size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      value={percentualGarantia}
                      onChange={(e) => handleInputChange(e.target.value, setPercentualGarantia)}
                      className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-bold text-slate-700"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 bg-[#C69C6D]/5 border border-[#C69C6D]/20 rounded-2xl">
                 <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-[#C69C6D] uppercase tracking-widest">Importância Segurada</label>
                    <span className="text-lg font-black text-[#1B263B]">{formatCurrency(importanciaSegurada)}</span>
                 </div>
              </div>

              <div className="flex items-center p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                 <label className="flex items-center gap-3 cursor-pointer group w-full">
                    <div className="relative shrink-0">
                       <input 
                        type="checkbox" 
                        checked={somarAdicional} 
                        onChange={(e) => setSomarAdicional(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-slate-200 rounded-full peer-checked:bg-[#1B263B] transition-colors"></div>
                      <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                    </div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:text-slate-800 transition-colors leading-tight">
                      Somar Garantia Adicional à Importância Segurada
                    </span>
                 </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Taxa do Tomador (%)</label>
                  <input 
                    type="text" 
                    value={taxaTomador}
                    onChange={(e) => handleInputChange(e.target.value, setTaxaTomador)}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-bold text-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vigência (nº de dias)</label>
                  <div className="relative">
                    <Calendar size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      value={vigenciaDias}
                      onChange={(e) => handleInputChange(e.target.value, setVigenciaDias, true)}
                      className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-bold text-slate-700"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center text-slate-400 mb-1">
                   <span className="text-[10px] font-black uppercase tracking-widest">Prêmio Anual</span>
                   <span className="text-sm font-bold">{formatCurrency(premioAnual)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Seção 2: Seguro Adicional */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="bg-[#C69C6D] p-8 text-[#1B263B]">
            <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
               <FileText size={20} />
               Seguro Adicional
            </h3>
            <p className="text-[#1B263B]/60 text-xs font-bold uppercase tracking-widest mt-1">Cálculos de Pregão & Edital</p>
          </div>

          <div className="p-8 space-y-6 flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor do Edital</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">R$</span>
                  <input 
                    type="text" 
                    value={edital}
                    onChange={(e) => handleInputChange(e.target.value, setEdital)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#1B263B]/10 outline-none font-bold text-slate-700"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lance do Pregão</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">R$</span>
                  <input 
                    type="text" 
                    value={lancePregao}
                    onChange={(e) => handleInputChange(e.target.value, setLancePregao)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#1B263B]/10 outline-none font-bold text-slate-700"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex justify-between items-center p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">85% do Edital</span>
                 <span className="text-sm font-bold text-slate-700">{formatCurrency(edital85)}</span>
              </div>

              <div className="flex justify-between items-center p-4 bg-amber-50/50 rounded-2xl border border-amber-100">
                 <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Garantia Adicional</span>
                 <span className="text-sm font-black text-amber-700">{formatCurrency(garantiaAdicional)}</span>
              </div>

              <div className="flex flex-col md:flex-row justify-between items-start md:items-center p-4 bg-blue-50/50 rounded-2xl border border-blue-100 gap-4">
                 <div className="flex items-center gap-3 w-full md:w-auto">
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest whitespace-nowrap">Garantia Contratual</span>
                    <div className="relative w-24">
                      <Percent size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400" />
                      <input 
                        type="text" 
                        value={percentualGarantiaContratual}
                        onChange={(e) => handleInputChange(e.target.value, setPercentualGarantiaContratual)}
                        className="w-full pl-3 pr-8 py-2 bg-white border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-300 outline-none font-bold text-blue-700 text-xs text-center"
                      />
                    </div>
                 </div>
                 <span className="text-sm font-black text-blue-700">{formatCurrency(garantiaContratual)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resultados Finais */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-[#1B263B] p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
             <CalcIcon size={80} className="text-[#C69C6D]" />
          </div>
          <p className="text-[#C69C6D] text-[10px] font-black uppercase tracking-[4px] mb-2">Prêmio Final</p>
          <h4 className="text-white text-5xl font-black tracking-tighter">{formatCurrency(premioTotal)}</h4>
          <div className="mt-8 flex items-center gap-2 text-slate-400">
             <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
             <p className="text-[10px] font-bold uppercase tracking-widest">Cálculo de Vigência Proporcional</p>
          </div>
        </div>

        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-xl flex flex-col justify-center">
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-[4px] mb-2">Total Garantia</p>
          <h4 className="text-slate-800 text-5xl font-black tracking-tighter">{formatCurrency(totalGarantia)}</h4>
          <div className="mt-8 p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-start gap-3">
             <Info size={18} className="text-[#C69C6D] shrink-0 mt-0.5" />
             <p className="text-[10px] text-orange-700 font-bold leading-relaxed uppercase">
                ⚠️ OBSERVAÇÃO: Abaixo de R$ 150,00 considerar prêmio mínimo por Seguradora.
             </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Calculator;
