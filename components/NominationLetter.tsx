
import React, { useState, useRef } from 'react';
import { Download, FileText, MapPin, Phone, Mail, UserCheck, Loader2, CheckCircle2, ShieldCheck, Printer } from 'lucide-react';
import { formatDateExtenso } from '../utils/formatters';

const seguradorasDisponiveis = [
  "PORTO SEGURO", "JUNTO SEGUROS", "JNS SEGUROS", "NEWE SEGUROS", 
  "POTTENCIAL SEGURADORA", "AVLA SEGURADORA", "BERKLEY SEGUROS", "SANCOR SEGUROS", "ALLSEG", "AKAD"
];

declare var html2pdf: any;

const NominationLetter: React.FC = () => {
  const [isExporting, setIsExporting] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState({
    razaoSocial: '',
    cnpj: '',
    responsavel: '',
    telefone: '',
    email: '',
    cidade: 'Icém',
    dataExtenso: formatDateExtenso(new Date()),
    seguradoras: ["PORTO SEGURO", "JUNTO SEGUROS", "AVLA SEGURADORA"],
    nomeAssinatura: ''
  });

  const handleToggleSeguradora = (seg: string) => {
    setData(prev => ({
      ...prev,
      seguradoras: prev.seguradoras.includes(seg) 
        ? prev.seguradoras.filter(s => s !== seg)
        : [...prev.seguradoras, seg]
    }));
  };

  const handleExportPDF = async () => {
    if (!pdfRef.current) return;
    setIsExporting(true);

    const element = pdfRef.current;
    const opt = {
      margin: 0,
      filename: `Nomeacao_${data.razaoSocial || 'FG_Corretora'}.pdf`,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        logging: false,
        letterRendering: true
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Houve um erro ao gerar o PDF. Tente novamente.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-white p-6 lg:p-8 rounded-[2rem] border border-slate-200 shadow-sm no-print">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-[#1B263B] rounded-2xl flex items-center justify-center text-[#C69C6D] shadow-lg">
               <FileText size={28} />
            </div>
            <div>
               <h2 className="text-3xl font-black text-slate-800 tracking-tight">Nomeação Oficial</h2>
               <p className="text-sm text-slate-500 font-medium">Configure os dados para o relatório de página única.</p>
            </div>
          </div>
          <div className="flex gap-3">
             <button 
                onClick={() => window.print()}
                className="hidden md:flex items-center justify-center gap-2 bg-slate-100 text-slate-600 px-6 py-4 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
              >
                <Printer size={20} />
                Imprimir
              </button>
              <button 
                onClick={handleExportPDF}
                disabled={isExporting}
                className={`flex items-center justify-center gap-3 bg-[#C69C6D] text-white px-8 py-4 rounded-2xl font-black transition-all shadow-xl shadow-[#C69C6D]/20 active:scale-95 shrink-0 ${isExporting ? 'opacity-70 cursor-not-allowed' : 'hover:bg-[#b58a5b]'}`}
              >
                {isExporting ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                {isExporting ? 'Processando...' : 'Baixar PDF A4'}
              </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] ml-1">Razão Social do Tomador</label>
                <input 
                  type="text" 
                  value={data.razaoSocial}
                  onChange={e => setData({...data, razaoSocial: e.target.value})}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] outline-none transition-all font-semibold text-slate-700"
                  placeholder="Nome completo da empresa"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] ml-1">CNPJ</label>
                <input 
                  type="text" 
                  value={data.cnpj}
                  onChange={e => setData({...data, cnpj: e.target.value})}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] outline-none transition-all font-semibold text-slate-700"
                  placeholder="00.000.000/0000-00"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] ml-1">Cidade</label>
                <input 
                  type="text" 
                  value={data.cidade}
                  onChange={e => setData({...data, cidade: e.target.value})}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-semibold text-slate-700"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] ml-1">Telefone</label>
                <input 
                  type="text" 
                  value={data.telefone}
                  onChange={e => setData({...data, telefone: e.target.value})}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-semibold text-slate-700"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] ml-1">E-mail</label>
                <input 
                  type="email" 
                  value={data.email}
                  onChange={e => setData({...data, email: e.target.value})}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#C69C6D]/20 outline-none font-semibold text-slate-700"
                />
              </div>
            </div>

            <div className="bg-[#1B263B]/5 p-6 rounded-[2rem] border border-[#1B263B]/10 flex flex-col md:flex-row items-center gap-6">
              <div className="w-12 h-12 bg-[#1B263B] rounded-2xl flex items-center justify-center text-[#C69C6D] shrink-0">
                 <UserCheck size={24} />
              </div>
              <div className="flex-1 w-full space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[2px]">Nome do Assinante Responsável</label>
                <input 
                  type="text" 
                  value={data.nomeAssinatura}
                  onChange={e => setData({...data, nomeAssinatura: e.target.value})}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none font-black text-[#1B263B]"
                  placeholder="Nome que aparecerá na assinatura"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 h-full">
               <h3 className="font-black text-[#1B263B] text-xs uppercase tracking-[3px] mb-4 flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[#C69C6D]" />
                  Seleção Cias
               </h3>
               <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scroll">
                 {seguradorasDisponiveis.map(seg => (
                   <button
                     key={seg}
                     onClick={() => handleToggleSeguradora(seg)}
                     className={`flex items-center justify-between p-3 rounded-xl border transition-all text-[10px] font-black tracking-tight ${
                       data.seguradoras.includes(seg) 
                       ? 'bg-[#1B263B] border-[#1B263B] text-white' 
                       : 'bg-white border-slate-200 text-slate-500'
                     }`}
                   >
                     {seg}
                     {data.seguradoras.includes(seg) && <CheckCircle2 size={14} className="text-[#C69C6D]" />}
                   </button>
                 ))}
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Visualização do Documento (Ajustado para Página Única A4) */}
      <div className="flex flex-col items-center gap-6 py-10 bg-slate-100/50 rounded-[3rem] border border-dashed border-slate-200">
         <div className="flex items-center gap-3">
            <p className="text-slate-500 font-black text-[10px] uppercase tracking-[4px]">Preview A4 • Versão de Página Única</p>
         </div>

         {/* Container A4 Rigoroso */}
         <div 
           ref={pdfRef} 
           className="bg-white shadow-2xl w-[210mm] h-[297mm] p-[20mm] text-slate-800 border border-slate-200 flex flex-col relative overflow-hidden"
           style={{ fontFamily: 'Inter, sans-serif' }}
         >
            {/* Header Timbrado Compacto */}
            <div className="flex justify-between items-start mb-10 border-b-2 border-[#1B263B] pb-6">
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 bg-[#1B263B] text-[#C69C6D] flex items-center justify-center font-black rounded-xl text-xl">
                      FG
                   </div>
                   <div>
                      <h1 className="text-xl font-black text-[#1B263B] leading-none uppercase tracking-tighter">F&G Corretora</h1>
                      <p className="text-[8px] font-black uppercase tracking-[2px] text-[#C69C6D] mt-1 italic">Garantia, Riscos & Soluções Corporativas</p>
                   </div>
                </div>
                <div className="text-right space-y-0.5">
                   <p className="text-[8px] font-black text-[#1B263B] uppercase tracking-wider">Doc Ref: FG-{Math.floor(Math.random() * 9000) + 1000}</p>
                   <p className="text-[7px] font-bold text-slate-400 uppercase leading-tight">
                      CNPJ: 56.123.874/0001-90 | SUSEP: 242160653
                   </p>
                </div>
            </div>

            <div className="text-center mb-8">
                <h2 className="text-lg font-black text-[#1B263B] uppercase tracking-[6px] py-4 border-y border-slate-100 bg-slate-50/30">Carta de Nomeação</h2>
            </div>

            <div className="space-y-6 text-slate-700 leading-relaxed text-[12px] text-justify">
              <div>
                <p className="font-black text-[#1B263B] uppercase text-[9px] tracking-[1.5px] mb-1">À atenção do:</p>
                <p className="font-bold text-slate-900 uppercase text-[10px] pl-2">
                  Departamento de Cadastro, Subscrição e Produção
                </p>
              </div>

              <div className="space-y-4">
                <p>
                  A empresa <strong className="text-[#1B263B]">{data.razaoSocial || '____________________________________________________'}</strong>, 
                  inscrita no CNPJ sob o nº <strong>{data.cnpj || '____.____.____/____-____'}</strong>, declara e nomeia oficialmente a 
                  <strong className="text-[#1B263B]"> F & G Corretora de Seguros</strong> (CNPJ 56.123.874/0001-90 / SUSEP 242160653) como sua legítima representante perante as companhias seguradoras:
                </p>

                {/* Lista de Seguradoras em Grade Compacta */}
                <div className="grid grid-cols-2 gap-y-2 gap-x-6 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                   {data.seguradoras.map(s => (
                      <div key={s} className="flex items-center gap-2 text-[9px] font-black text-[#1B263B] uppercase tracking-tight">
                         <div className="w-2 h-2 rounded-full bg-[#C69C6D]" /> {s}
                      </div>
                   ))}
                   {data.seguradoras.length === 0 && <div className="col-span-2 text-center text-slate-400 text-[10px] py-2">Nenhuma seguradora selecionada</div>}
                </div>

                <p>
                  Esta nomeação confere à CORRETORA plenos poderes para atuar em nosso nome, permitindo o acesso a dados cadastrais, 
                  negociação de taxas comerciais, solicitação de cotações, gestão de apólices vigentes e regulação de sinistros, 
                  especialmente no ramo de <strong className="text-[#C69C6D]">Seguro Garantia e Riscos de Engenharia</strong>.
                </p>

                <p>
                  A presente autorização revoga quaisquer nomeações anteriores para as mesmas seguradoras aqui listadas, mantendo-se 
                  válida até que haja comunicação formal de rescisão entre as partes.
                </p>
              </div>
            </div>

            {/* Signature Area Subida */}
            <div className="mt-auto pb-6">
              <div className="flex flex-col items-center">
                <div className="w-64 h-[0.5px] bg-slate-300 mb-4"></div>
                <p className="text-[11px] font-black text-[#1B263B] uppercase tracking-[2px] text-center">
                  {data.nomeAssinatura || data.razaoSocial || 'ASSINATURA DO RESPONSÁVEL'}
                </p>
                <p className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-widest">
                   CNPJ: {data.cnpj || '00.000.000/0000-00'}
                </p>
                
                <div className="mt-6 flex items-center gap-6 text-[8px] font-bold text-slate-500 uppercase">
                  {data.telefone && (
                    <div className="flex items-center gap-1">
                      <Phone size={10} className="text-[#C69C6D]" /> {data.telefone}
                    </div>
                  )}
                  {data.email && (
                    <div className="flex items-center gap-1 lowercase">
                      <Mail size={10} className="text-[#C69C6D]" /> {data.email}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-end mt-10 text-[8px] font-black text-slate-300 tracking-widest uppercase pt-2 border-t border-slate-50">
                <p>{data.cidade}, {data.dataExtenso}</p>
                <p className="flex items-center gap-1 italic">
                  <ShieldCheck size={10} className="text-[#C69C6D]" />
                  FG.HUB.V26.SECURE
                </p>
              </div>
            </div>
            
            {/* Decoração Lateral Sutil */}
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#1B263B]"></div>
            <div className="absolute top-0 left-0 w-1.5 h-32 bg-[#C69C6D]"></div>
         </div>
         
         <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">O PDF gerado respeitará o limite de 297mm de altura.</p>
      </div>
    </div>
  );
};

export default NominationLetter;
