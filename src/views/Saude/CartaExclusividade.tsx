import React, { useMemo, useRef, useState } from 'react';
import { Download, Copy, Loader2, AlertTriangle, Building2, Check } from 'lucide-react';
import { useToast } from '../../../components/Toast.tsx';
import { formatDateExtenso } from '../../../utils/formatters.ts';
import { LIMITE_VIDAS } from './precos.ts';

/**
 * Carta de exclusividade da Unimed Sorocaba.
 *
 * Atenção ao que este documento é, porque contraria a expectativa de quem já
 * usa o gerador de nomeação do Seguro Garantia: aqui quem é nomeada NÃO é a
 * F&G. No plano de saúde o credenciamento passa pela Favorita Brasil, e o
 * modelo que a operadora aceita nomeia a plataforma. Quem assina é o cliente.
 *
 * O texto é fiel ao modelo da operadora, guardado em
 * `docs/saude/modelo-carta-exclusividade-unimed.doc`. Havendo divergência
 * entre esta tela e aquele arquivo, o arquivo vence.
 *
 * A mecânica (máscara de CNPJ, BrasilAPI, html2pdf) é a mesma do
 * `components/NominationLetter.tsx`, copiada de propósito em vez de
 * importada: são documentos diferentes, com destinatários diferentes, e
 * amarrar os dois faria uma mudança no Seguro Garantia respingar na saúde.
 *
 * Nada é gravado em banco. A carta é assinada fora do HUB, e registrar a
 * geração sem registrar a devolução assinada seria um status que mente.
 */

declare var html2pdf: any;

const formatCNPJ = (v: string) =>
  v.replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})/, '$1-$2')
    .slice(0, 18);

/**
 * `formatDateExtenso` devolve o mês com inicial maiúscula, que é o que o
 * gerador de nomeação usa. Em corpo de carta formal o mês vai em minúscula,
 * como está no modelo da operadora, então a inicial cai aqui.
 */
const dataPorExtensoMinuscula = (d: Date) =>
  formatDateExtenso(d).replace(/ de (\p{Lu})/u, (_, letra: string) => ` de ${letra.toLowerCase()}`);

const inputCls =
  'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold text-slate-800 bg-slate-50';
const rotuloCls =
  'text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1';

const CartaExclusividade: React.FC = () => {
  const { toast } = useToast();
  const pdfRef = useRef<HTMLDivElement>(null);

  const [exportando, setExportando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [cnpjStatus, setCnpjStatus] = useState<'idle' | 'loading' | 'found' | 'error'>('idle');

  const [dados, setDados] = useState({
    razaoSocial: '',
    cnpj: '',
    responsavel: '',
    cidade: 'Sorocaba',
    dataExtenso: dataPorExtensoMinuscula(new Date()),
  });

  const set = (campo: keyof typeof dados, valor: string) =>
    setDados(prev => ({ ...prev, [campo]: valor }));

  const aoDigitarCnpj = async (bruto: string) => {
    const formatado = formatCNPJ(bruto);
    setDados(prev => ({ ...prev, cnpj: formatado }));
    const digitos = formatado.replace(/\D/g, '');
    if (digitos.length !== 14) { setCnpjStatus('idle'); return; }
    setCnpjStatus('loading');
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      // O primeiro sócio do quadro societário nem sempre é o representante
      // legal, então isso entra como sugestão para o Fábio conferir, não como
      // verdade: o campo continua editável.
      const socio = json.qsa?.[0]?.nome_socio || json.qsa?.[0]?.nome || '';
      setDados(prev => ({
        ...prev,
        razaoSocial: json.razao_social || prev.razaoSocial,
        responsavel: socio || prev.responsavel,
      }));
      setCnpjStatus('found');
    } catch {
      setCnpjStatus('error');
    }
  };

  const preenchido = (v: string, vazio: string) => (v.trim() ? v.trim() : vazio);

  const textoDaCarta = useMemo(() => [
    `${preenchido(dados.cidade, 'Sorocaba')}, ${dados.dataExtenso}.`,
    '',
    'A UNIMED SOROCABA – COOPERATIVA DE TRABALHO MÉDICO',
    '',
    'A/C: Diretora Executiva',
    '',
    'Ref: Carta de Exclusividade',
    '',
    'A/C Departamento Comercial',
    '',
    'Comunicamos que a Plataforma FAVORITA BRASIL CORRETORA DE SEGUROS LTDA, '
      + 'foi nomeada a partir desta data com exclusividade para solicitar estudos '
      + 'e propostas para nossa empresa.',
    '',
    'Desta forma, revogamos qualquer exclusividade, autorização ou reserva de '
      + 'mercado anteriormente firmada com a mesma finalidade.',
    '',
    'Atenciosamente,',
    '',
    '',
    `Empresa: ${preenchido(dados.razaoSocial, '____________________________________')}`,
    `CNPJ: ${preenchido(dados.cnpj, '____________________________________')}`,
    'Assinatura do Responsável Legal: ____________________________________',
    `Nome do Responsável Legal: ${preenchido(dados.responsavel, '____________________________')}`,
  ].join('\n'), [dados]);

  const copiarTexto = async () => {
    try {
      await navigator.clipboard.writeText(textoDaCarta);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      toast('Texto copiado. Cole no papel timbrado do cliente.', 'success');
    } catch {
      toast('Não consegui copiar. Selecione o texto da prévia e copie na mão.', 'error');
    }
  };

  const baixarPDF = async () => {
    if (!pdfRef.current) return;
    setExportando(true);
    const nomeArquivo = `Exclusividade_${(dados.razaoSocial || 'cliente').replace(/[^\w]+/g, '_')}.pdf`;
    const opt = {
      margin: 0,
      filename: nomeArquivo,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: { scale: 2, useCORS: true, logging: false, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };
    try {
      await html2pdf().set(opt).from(pdfRef.current).save();
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
      toast('Não consegui gerar o PDF. Tente de novo.', 'error');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Aviso. Fica acima do formulário de propósito: quem chega aqui vindo do
          gerador do Seguro Garantia espera nomear a F&G, e não é o caso. */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-2 text-sm text-amber-900">
          <p className="font-bold">Esta carta nomeia a Favorita Brasil, não a F&amp;G.</p>
          <p>
            No plano de saúde o credenciamento passa pela Favorita Brasil, e o modelo que a
            Unimed Sorocaba aceita nomeia a plataforma. A F&amp;G atende o cliente por trás
            dela. Quem assina é o responsável legal da empresa.
          </p>
          <p>
            Ela é necessária acima de {LIMITE_VIDAS} vidas, quando a cotação passa por reserva
            de mercado. Até {LIMITE_VIDAS} vidas o simulador fecha sozinho e a carta não entra.
          </p>
          <p className="font-bold">
            Emitir em papel timbrado da empresa do cliente.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] items-start">
        {/* Formulário */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 no-print">
          <div className="flex items-center gap-2 pb-1">
            <Building2 size={16} className="text-gold" aria-hidden="true" />
            <h2 className="font-black text-slate-800 text-lg">Dados da empresa</h2>
          </div>

          <div>
            <label className={rotuloCls} htmlFor="carta-cnpj">CNPJ</label>
            <div className="relative">
              <input
                id="carta-cnpj"
                value={dados.cnpj}
                onChange={e => aoDigitarCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                className={inputCls}
              />
              {cnpjStatus === 'loading' && (
                <Loader2 size={14} className="animate-spin text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              )}
              {cnpjStatus === 'found' && (
                <Check size={14} className="text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
            {cnpjStatus === 'error' && (
              <p className="text-[10px] text-amber-700 mt-1">
                Não achei este CNPJ na consulta pública. Preencha os campos na mão.
              </p>
            )}
          </div>

          <div>
            <label className={rotuloCls} htmlFor="carta-razao">Razão social</label>
            <input
              id="carta-razao"
              value={dados.razaoSocial}
              onChange={e => set('razaoSocial', e.target.value)}
              placeholder="Como está no contrato social"
              className={inputCls}
            />
          </div>

          <div>
            <label className={rotuloCls} htmlFor="carta-responsavel">Nome do responsável legal</label>
            <input
              id="carta-responsavel"
              value={dados.responsavel}
              onChange={e => set('responsavel', e.target.value)}
              placeholder="Quem vai assinar"
              className={inputCls}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Vem do primeiro sócio do quadro societário, que nem sempre é quem assina. Confira.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotuloCls} htmlFor="carta-cidade">Cidade</label>
              <input
                id="carta-cidade"
                value={dados.cidade}
                onChange={e => set('cidade', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={rotuloCls} htmlFor="carta-data">Data</label>
              <input
                id="carta-data"
                value={dados.dataExtenso}
                onChange={e => set('dataExtenso', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={copiarTexto}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-navy hover:bg-navy-light text-gold rounded-xl font-bold text-sm transition-colors"
            >
              {copiado ? <Check size={15} /> : <Copy size={15} />}
              {copiado ? 'Copiado' : 'Copiar texto'}
            </button>
            <button
              onClick={baixarPDF}
              disabled={exportando}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-gold/10 text-gold-dark hover:bg-gold/20 rounded-xl font-bold text-sm transition-colors disabled:opacity-50"
            >
              {exportando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {exportando ? 'Gerando...' : 'Baixar PDF'}
            </button>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Copiar texto costuma ser o caminho mais rápido: o cliente cola no timbrado dele,
              assina e devolve. O PDF serve para quem prefere imprimir, e sai sem a marca da
              F&amp;G justamente porque o papel é do cliente.
            </p>
          </div>
        </div>

        {/* Prévia, que é o que vira PDF */}
        <div className="bg-slate-100 rounded-2xl p-4 lg:p-6 overflow-x-auto">
          <div
            ref={pdfRef}
            className="bg-white mx-auto shadow-sm"
            style={{ width: '210mm', minHeight: '297mm', padding: '45mm 25mm 25mm', boxSizing: 'border-box' }}
          >
            <div
              style={{
                fontFamily: 'Times New Roman, Times, serif',
                fontSize: '12pt',
                lineHeight: 1.6,
                color: '#000',
                whiteSpace: 'pre-wrap',
              }}
            >
              {textoDaCarta}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CartaExclusividade;
