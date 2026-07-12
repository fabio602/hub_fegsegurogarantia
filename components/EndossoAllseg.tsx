import React, { useState } from 'react';
import JSZip from 'jszip';
import { FileDown, Loader2, RefreshCw } from 'lucide-react';

interface EndossoForm {
  // Tomador
  tom_razao: string;
  tom_cnpj: string;
  tom_end: string;
  tom_bairro: string;
  tom_cep: string;
  tom_cidade: string;
  tom_uf: string;
  // Segurado
  seg_razao: string;
  seg_cnpj: string;
  seg_end: string;
  seg_bairro: string;
  seg_cep: string;
  seg_cidade: string;
  seg_uf: string;
  // Risco
  risco_num_proposta: string;
  risco_num_apolice: string;
  risco_modalidade: string;
  risco_inicio: string;
  risco_fim: string;
  risco_valor_garantia: string;
  risco_pagamento: string;
  // Objeto
  obj_contrato: string;
  obj_processo: string;
  obj_pregao: string;
  // Corretor (pré-preenchido F&G)
  cor_razao: string;
  cor_cnpj: string;
  cor_susep: string;
  // Data
  local_data: string;
}

const empty: EndossoForm = {
  tom_razao: '', tom_cnpj: '', tom_end: '', tom_bairro: '', tom_cep: '', tom_cidade: '', tom_uf: '',
  seg_razao: '', seg_cnpj: '', seg_end: '', seg_bairro: '', seg_cep: '', seg_cidade: '', seg_uf: '',
  risco_num_proposta: '', risco_num_apolice: '', risco_modalidade: 'CONSTRUTOR',
  risco_inicio: '', risco_fim: '', risco_valor_garantia: '', risco_pagamento: 'Boleto',
  obj_contrato: '', obj_processo: '', obj_pregao: '',
  cor_razao: 'F&G Corretora de Seguros', cor_cnpj: '56.123.874/0001-90', cor_susep: '242160653',
  local_data: '',
};

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${parseInt(d)} de ${months[parseInt(m) - 1]} de ${y}`;
}

const Field: React.FC<{
  label: string;
  id: keyof EndossoForm;
  value: string;
  onChange: (id: keyof EndossoForm, v: string) => void;
  placeholder?: string;
  type?: string;
  half?: boolean;
  readOnly?: boolean;
}> = ({ label, id, value, onChange, placeholder, type = 'text', half, readOnly }) => (
  <div className={half ? 'col-span-1' : ''}>
    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(id, e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] focus:bg-white transition-all ${readOnly ? 'text-slate-400 cursor-default' : ''}`}
    />
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="px-6 py-3 bg-red-600 text-white font-black text-sm tracking-widest uppercase">
      {title}
    </div>
    <div className="p-5 grid grid-cols-2 gap-4">
      {children}
    </div>
  </div>
);

const EndossoAllseg: React.FC = () => {
  const [form, setForm] = useState<EndossoForm>(empty);
  const [generating, setGenerating] = useState(false);
  const [success, setSuccess] = useState(false);

  const set = (id: keyof EndossoForm, v: string) => {
    setSuccess(false);
    setForm(prev => ({ ...prev, [id]: v }));
  };

  const maskCnpj = (v: string) => {
    const d = v.replace(/\D/g, '').substring(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2')
            .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1/$2')
            .replace(/(\d{4})(\d)/, '$1-$2');
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setSuccess(false);
    try {
      const resp = await fetch('/endosso-allseg-template.docx');
      const arrayBuffer = await resp.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const docXml = await zip.file('word/document.xml')!.async('string');

      const localData = form.local_data
        ? `Boituva, ${fmtDate(form.local_data)}`
        : 'Boituva, _____ de __________ de ______';

      const filled = docXml
        .replace(/\{\{TOM_RAZAO\}\}/g, form.tom_razao)
        .replace(/\{\{TOM_CNPJ\}\}/g, form.tom_cnpj)
        .replace(/\{\{TOM_END\}\}/g, form.tom_end)
        .replace(/\{\{TOM_BAIRRO\}\}/g, form.tom_bairro)
        .replace(/\{\{TOM_CEP\}\}/g, form.tom_cep)
        .replace(/\{\{TOM_CIDADE\}\}/g, form.tom_cidade)
        .replace(/\{\{TOM_UF\}\}/g, form.tom_uf)
        .replace(/\{\{SEG_RAZAO\}\}/g, form.seg_razao)
        .replace(/\{\{SEG_CNPJ\}\}/g, form.seg_cnpj)
        .replace(/\{\{SEG_END\}\}/g, form.seg_end)
        .replace(/\{\{SEG_BAIRRO\}\}/g, form.seg_bairro)
        .replace(/\{\{SEG_CEP\}\}/g, form.seg_cep)
        .replace(/\{\{SEG_CIDADE\}\}/g, form.seg_cidade)
        .replace(/\{\{SEG_UF\}\}/g, form.seg_uf)
        .replace(/\{\{RISCO_NUM_PROPOSTA\}\}/g, form.risco_num_proposta)
        .replace(/\{\{RISCO_NUM_APOLICE\}\}/g, form.risco_num_apolice)
        .replace(/\{\{RISCO_MODALIDADE\}\}/g, form.risco_modalidade)
        .replace(/\{\{RISCO_INICIO\}\}/g, form.risco_inicio)
        .replace(/\{\{RISCO_FIM\}\}/g, form.risco_fim)
        .replace(/\{\{RISCO_VALOR_GARANTIA\}\}/g, form.risco_valor_garantia)
        .replace(/\{\{RISCO_PAGAMENTO\}\}/g, form.risco_pagamento)
        .replace(/\{\{OBJ_CONTRATO\}\}/g, form.obj_contrato)
        .replace(/\{\{OBJ_PROCESSO\}\}/g, form.obj_processo)
        .replace(/\{\{OBJ_PREGAO\}\}/g, form.obj_pregao)
        .replace(/\{\{COR_RAZAO\}\}/g, form.cor_razao)
        .replace(/\{\{COR_CNPJ\}\}/g, form.cor_cnpj)
        .replace(/\{\{COR_SUSEP\}\}/g, form.cor_susep)
        .replace(/\{\{LOCAL_DATA\}\}/g, localData);

      zip.file('word/document.xml', filled);
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const tomNome = form.tom_razao ? form.tom_razao.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) : 'Tomador';
      a.download = `Endosso_Allseg_${tomNome}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar o documento. Tente novamente.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-black text-slate-800">Pedido de Endosso — Allseg</h2>
        <p className="text-slate-500 font-medium mt-1">Preencha os campos e gere o documento Word no formato exato exigido pela Allseg.</p>
      </div>

      {/* TOMADOR */}
      <Section title="Dados do Tomador">
        <div className="col-span-2">
          <Field label="Razão Social" id="tom_razao" value={form.tom_razao} onChange={set} placeholder="Nome da empresa tomadora" />
        </div>
        <Field label="CNPJ / CPF" id="tom_cnpj" value={form.tom_cnpj} onChange={(id, v) => set(id, maskCnpj(v))} placeholder="00.000.000/0000-00" />
        <div /> {/* spacer */}
        <div className="col-span-2">
          <Field label="Endereço" id="tom_end" value={form.tom_end} onChange={set} placeholder="Rua, número" />
        </div>
        <Field label="Bairro" id="tom_bairro" value={form.tom_bairro} onChange={set} placeholder="Bairro" />
        <Field label="CEP" id="tom_cep" value={form.tom_cep} onChange={set} placeholder="00000-000" />
        <Field label="Cidade" id="tom_cidade" value={form.tom_cidade} onChange={set} placeholder="Cidade" />
        <Field label="UF" id="tom_uf" value={form.tom_uf} onChange={set} placeholder="SP" />
      </Section>

      {/* SEGURADO */}
      <Section title="Dados do Segurado">
        <div className="col-span-2">
          <Field label="Razão Social" id="seg_razao" value={form.seg_razao} onChange={set} placeholder="Nome do órgão segurado" />
        </div>
        <Field label="CNPJ / CPF" id="seg_cnpj" value={form.seg_cnpj} onChange={(id, v) => set(id, maskCnpj(v))} placeholder="00.000.000/0000-00" />
        <div />
        <div className="col-span-2">
          <Field label="Endereço" id="seg_end" value={form.seg_end} onChange={set} placeholder="Rua, número" />
        </div>
        <Field label="Bairro" id="seg_bairro" value={form.seg_bairro} onChange={set} placeholder="Bairro" />
        <Field label="CEP" id="seg_cep" value={form.seg_cep} onChange={set} placeholder="00000-000" />
        <Field label="Cidade" id="seg_cidade" value={form.seg_cidade} onChange={set} placeholder="Cidade" />
        <Field label="UF" id="seg_uf" value={form.seg_uf} onChange={set} placeholder="SP" />
      </Section>

      {/* RISCO */}
      <Section title="Dados do Risco">
        <Field label="Nº da Proposta" id="risco_num_proposta" value={form.risco_num_proposta} onChange={set} placeholder="0000000000000" />
        <Field label="Nº da Apólice" id="risco_num_apolice" value={form.risco_num_apolice} onChange={set} placeholder="058192026010007750008368" />
        <div className="col-span-2">
          <Field label="Modalidade" id="risco_modalidade" value={form.risco_modalidade} onChange={set} placeholder="CONSTRUTOR" />
        </div>
        <Field label="Início de Vigência (dd/mm/aaaa)" id="risco_inicio" value={form.risco_inicio} onChange={set} placeholder="11/06/2026" />
        <Field label="Final de Vigência (dd/mm/aaaa)" id="risco_fim" value={form.risco_fim} onChange={set} placeholder="22/01/2027" />
        <Field label="Valor da Garantia (R$)" id="risco_valor_garantia" value={form.risco_valor_garantia} onChange={set} placeholder="193.477,19" />
        <Field label="Forma de Pagamento" id="risco_pagamento" value={form.risco_pagamento} onChange={set} placeholder="Boleto" />
      </Section>

      {/* OBJETO */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-3 bg-red-600 text-white font-black text-sm tracking-widest uppercase">
          Objeto do Seguro
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 leading-relaxed">
            O texto do objeto é gerado automaticamente no formato exigido pela Allseg. Preencha apenas os dados variáveis abaixo:
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Contrato nº" id="obj_contrato" value={form.obj_contrato} onChange={set} placeholder="149/2026" />
            </div>
            <div className="col-span-2">
              <Field label="Processo de Contratação" id="obj_processo" value={form.obj_processo} onChange={set} placeholder="01-P-23367/2025" />
            </div>
            <div className="col-span-2">
              <Field label="Pregão Eletrônico DGA nº" id="obj_pregao" value={form.obj_pregao} onChange={set} placeholder="90198/2026" />
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 leading-relaxed">
            <strong>Prévia do objeto:</strong><br />
            "Este seguro garante a indenização, até o valor da garantia fixado na apólice, pelos prejuízos causados pelo Tomador ao Segurado, em razão de inadimplemento das obrigações previstas no <strong>Contrato nº {form.obj_contrato || '___'}</strong>, <strong>Processo de Contratação {form.obj_processo || '___'}</strong>, decorrente do <strong>Pregão Eletrônico DGA nº {form.obj_pregao || '___'},</strong>..."
          </div>
        </div>
      </div>

      {/* CORRETOR */}
      <Section title="Dados do Corretor">
        <Field label="Razão Social" id="cor_razao" value={form.cor_razao} onChange={set} />
        <Field label="CNPJ / CPF" id="cor_cnpj" value={form.cor_cnpj} onChange={set} />
        <Field label="Código SUSEP" id="cor_susep" value={form.cor_susep} onChange={set} />
        <div />
      </Section>

      {/* DATA */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Data do Documento</label>
        <input
          type="date"
          value={form.local_data}
          onChange={e => set('local_data', e.target.value)}
          className="w-56 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all"
        />
        {form.local_data && (
          <p className="text-xs text-slate-500 mt-1">Será exibido como: <strong>Boituva, {fmtDate(form.local_data)}</strong></p>
        )}
      </div>

      {/* GENERATE BUTTON */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-8 py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black text-sm rounded-2xl transition-all shadow-lg shadow-red-600/20"
        >
          {generating ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />}
          {generating ? 'Gerando documento...' : 'Gerar Pedido de Endosso (.docx)'}
        </button>
        <button
          onClick={() => { setForm(empty); setSuccess(false); }}
          className="flex items-center gap-2 px-5 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm rounded-2xl transition-all"
        >
          <RefreshCw size={15} /> Limpar
        </button>
      </div>

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-4 text-sm text-emerald-700 font-bold">
          ✅ Documento gerado com sucesso! O arquivo foi baixado no formato exato da Allseg.
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-xs text-slate-500 leading-relaxed">
        ℹ️ O documento gerado mantém exatamente o layout, logos e formatação do formulário original da Allseg. Basta abrir o .docx e imprimir ou enviar.
      </div>
    </div>
  );
};

export default EndossoAllseg;
