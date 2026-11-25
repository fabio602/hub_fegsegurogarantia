// Monta a Ficha para Análise de Garantia Judicial a partir do que o cliente
// enviou pelo formulário judicial.fegsegurogarantia.com (tabela fichas_judiciais).
// Documento autônomo, com a marca da F&G e sem nome de seguradora: serve para
// qualquer uma. É impresso num iframe, como a proposta comercial, para não
// herdar o sidebar nem a escala de 80% do HUB.
import logoBege from '../proposta/logo-bege.svg?raw';

export type StatusFicha = 'recebida' | 'em_analise' | 'cotada' | 'emitida' | 'cancelada' | 'descartada';

export interface AnexoFicha {
  path: string;
  nome: string;
  tamanho: number;
  tipo: string;
  categoria: 'sentenca' | 'calculo' | 'procuracao';
}

export interface FichaJudicial {
  id: string;
  protocolo: string;
  status: StatusFicha;
  contato_nome: string;
  contato_papel: 'advogado' | 'empresa';
  contato_email: string;
  contato_telefone: string;
  tomador_cnpj: string;
  tomador_razao_social: string;
  tomador_cep: string;
  tomador_endereco: string;
  tomador_cidade: string;
  tomador_uf: string;
  processo_numero: string;
  processo_juizo: string;
  valor_causa: number;
  data_distribuicao: string;
  recurso: string;
  tipo_caucao: 'nova' | 'substituicao' | 'adicional';
  reclamante_nome: string;
  reclamante_documento: string;
  reclamante_endereco: string | null;
  objeto: string;
  historico: string;
  linha_defesa: string;
  probabilidade_exito: 'provavel' | 'possivel' | 'remota';
  advogado_nome: string;
  advogado_oab: string;
  advogado_oab_uf: string;
  valor_base: number;
  valor_garantia: number;
  data_base: string;
  indice_reajuste: string;
  objetivo: string;
  segurado: string | null;
  observacoes: string | null;
  anexos: AnexoFicha[];
  notas_internas: string | null;
  email_cliente_em: string | null;
  email_interno_em: string | null;
  created_at: string;
}

export const ROTULO_CAUCAO: Record<FichaJudicial['tipo_caucao'], string> = {
  nova: 'Nova garantia no processo',
  substituicao: 'Substituição de garantia já existente',
  adicional: 'Garantia adicional',
};
export const ROTULO_EXITO: Record<FichaJudicial['probabilidade_exito'], string> = {
  provavel: 'Provável', possivel: 'Possível', remota: 'Remota',
};
export const ROTULO_PAPEL: Record<FichaJudicial['contato_papel'], string> = {
  advogado: 'Advogado da causa', empresa: 'Da empresa',
};
export const ROTULO_CATEGORIA: Record<AnexoFicha['categoria'], string> = {
  sentenca: 'Sentença ou decisão recorrida', calculo: 'Cálculo da condenação', procuracao: 'Procuração do advogado',
};

export const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const fmtCnpj = (c: string) => c.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
export const fmtCpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
export const fmtDoc = (d: string) => (d.length === 11 ? fmtCpf(d) : fmtCnpj(d));
export const fmtCep = (c: string) => c.replace(/^(\d{5})(\d{3})$/, '$1-$2');
export const fmtTelefone = (d: string) => d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');

const esc = (s?: string | null) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const item = (n: number, rotulo: string, valor: string, larg = 2) =>
  `<div class="f" style="grid-column:span ${larg}"><span>${n}. ${rotulo}</span><b>${valor}</b></div>`;

const marcas = <T extends string>(atual: T, rotulos: Record<T, string>) =>
  (Object.keys(rotulos) as T[]).map(k => `<span class="op${k === atual ? ' sim' : ''}">${k === atual ? '☒' : '☐'} ${esc(rotulos[k])}</span>`).join('');

export function htmlFicha(f: FichaJudicial): string {
  const enderecoTomador = `${f.tomador_endereco}, ${f.tomador_cidade}/${f.tomador_uf}, CEP ${fmtCep(f.tomador_cep)}`;
  const autor = [esc(f.reclamante_nome), `CPF/CNPJ ${esc(fmtDoc(f.reclamante_documento))}`, f.reclamante_endereco ? esc(f.reclamante_endereco) : ''].filter(Boolean).join('<br>');
  const reu = [esc(f.tomador_razao_social), `CNPJ ${esc(fmtCnpj(f.tomador_cnpj))}`, esc(enderecoTomador)].join('<br>');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Ficha Garantia Judicial ${esc(f.protocolo)} ${esc(f.tomador_razao_social)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,700&display=swap">
<style>
:root{--navy:#243444;--navy-2:#2f4458;--beige:#eac8ac;--line:#dfe4eb;--ink:#14202e;--muted:#5d6b7c}
*{box-sizing:border-box}
@page{size:A4;margin:12mm 12mm 14mm}
html,body{margin:0;background:#fff;color:var(--ink);font:12px/1.5 "IBM Plex Sans","Segoe UI",Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{background:linear-gradient(110deg,var(--navy),var(--navy-2));color:#fff;border-bottom:4px solid var(--beige);border-radius:10px 10px 0 0;padding:12px 18px;display:flex;align-items:center;gap:18px}
header svg{height:50px;width:auto;flex:none;display:block}
.brand{flex:1;border-left:1px solid rgba(234,200,172,.35);padding-left:18px;font-size:12px;opacity:.85;line-height:1.6}
.id{text-align:right;font-size:12px;line-height:1.6}
.id b{display:block;font-size:14px;color:var(--beige)}
main{display:grid;gap:8px;padding-top:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 16px}
h2{margin:0 0 6px;font:700 15px/1.2 "Source Serif 4",Georgia,serif;color:var(--navy)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 16px}
.f{break-inside:avoid}
.f>span{display:block;font-size:10.5px;color:var(--muted);font-weight:600}
.f b{font-weight:500;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.op{display:inline-block;margin-right:18px;font-size:12.5px;color:var(--muted);font-weight:400}
.fim{break-inside:avoid}
.op.sim{color:var(--ink);font-weight:600}
.total{background:var(--navy);color:#fff;border-radius:9px;padding:8px 14px;display:flex;justify-content:space-between;align-items:baseline;gap:16px;font-variant-numeric:tabular-nums;break-inside:avoid}
.total b{font-size:16px;color:var(--beige)}
.ass{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding-top:26px;break-inside:avoid}
.ass div{border-top:1px solid var(--ink);padding-top:4px;font-size:11px;color:var(--muted)}
footer{text-align:center;font-size:10.5px;color:var(--muted);padding-top:6px}
</style></head>
<body>
<header>
  ${logoBege}
  <div class="brand"><span>Corretora registrada na SUSEP nº 242160653</span><br><span>CNPJ 56.123.874/0001-90</span></div>
  <div class="id"><b>Ficha para Análise de Garantia Judicial</b>Protocolo ${esc(f.protocolo)}<br>Recebida em ${new Date(f.created_at).toLocaleDateString('pt-BR')}</div>
</header>
<main>
  <section class="card"><h2>Dados básicos do processo</h2><div class="grid">
    ${item(1, 'Nome e qualificação do autor (reclamante)', autor)}
    ${item(2, 'Nome e qualificação do réu (reclamada, tomadora da garantia)', reu)}
    ${item(3, 'Número do processo judicial', esc(f.processo_numero))}
    ${item(4, 'Tipo de ação', `Ação trabalhista. Recurso a apresentar: ${esc(f.recurso)}`)}
    ${item(5, 'Juízo', esc(f.processo_juizo))}
    ${item(6, 'Valor da causa', brl(f.valor_causa), 1)}
    ${item(7, 'Data de distribuição da ação', dataBr(f.data_distribuicao), 1)}
    ${item(8, 'Tipo de caução', marcas(f.tipo_caucao, ROTULO_CAUCAO), 4)}
  </div></section>
  <section class="card"><h2>Parecer jurídico</h2><div class="grid">
    ${item(9, 'Objeto do processo', esc(f.objeto), 4)}
    ${item(10, 'Histórico do processo', esc(f.historico), 4)}
    ${item(11, 'Linha de defesa sustentada', esc(f.linha_defesa), 4)}
    ${item(12, 'Classificação quanto à probabilidade de êxito', marcas(f.probabilidade_exito, ROTULO_EXITO), 4)}
  </div></section>
  <section class="card"><h2>Garantia</h2><div class="grid">
    <div class="total" style="grid-column:span 4"><span>13. Valor da garantia judicial a ser apresentada, com acréscimo de 30% (valor informado: ${brl(f.valor_base)}, data base ${dataBr(f.data_base)})</span><b>${brl(f.valor_garantia)}</b></div>
    ${item(14, 'Índice de reajuste adotado', esc(f.indice_reajuste))}
    ${item(15, 'Segurado (beneficiário) na apólice', f.segurado ? esc(f.segurado) : 'A confirmar')}
    ${item(16, 'Objetivo da garantia', esc(f.objetivo), 4)}
    ${f.observacoes ? `<div class="f" style="grid-column:span 4"><span>Observações</span><b>${esc(f.observacoes)}</b></div>` : ''}
  </div></section>
  <section class="card fim"><h2>Patrocinador da causa</h2><div class="grid">
    ${item(17, 'Nome', esc(f.advogado_nome))}
    ${item(18, 'Inscrição na OAB', `${esc(f.advogado_oab)} / ${esc(f.advogado_oab_uf)}`)}
    <div class="ass" style="grid-column:span 4"><div>Local e data</div><div>Assinatura: ${esc(f.advogado_nome)}</div></div>
  </div></section>
  <footer>
    Ficha gerada pela F&amp;G Seguro Garantia com as informações prestadas por ${esc(f.contato_nome)} (${esc(ROTULO_PAPEL[f.contato_papel])}) em ${new Date(f.created_at).toLocaleDateString('pt-BR')}.<br>
    Fábio Lima · F&amp;G Seguro Garantia · WhatsApp (15) 99861-8659 · fabio@fegsegurogarantia.com.br
  </footer>
</main>
</body></html>`;
}

/** Imprime a ficha num iframe escondido (o navegador oferece "Salvar como PDF"). */
export function imprimirFicha(f: FichaJudicial): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(htmlFicha(f));
  doc.close();
  const win = iframe.contentWindow!;
  const disparar = () => {
    // O título do documento vira o nome sugerido do PDF.
    const tituloAnterior = document.title;
    document.title = doc.title;
    win.focus();
    win.print();
    setTimeout(() => { document.title = tituloAnterior; iframe.remove(); }, 1000);
  };
  const fontes = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fontes?.ready) Promise.race([fontes.ready, new Promise(r => setTimeout(r, 1500))]).then(disparar);
  else setTimeout(disparar, 500);
}
