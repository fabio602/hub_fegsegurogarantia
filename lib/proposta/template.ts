// Monta o HTML da proposta comercial de Seguro Garantia (o que o cliente recebe em PDF).
// Documento autônomo, com CSS próprio: é impresso dentro de um iframe, fora do
// shell do HUB, para não herdar o sidebar nem a escala de 80% do index.css.
import logoBege from './logo-bege.svg?raw';
import { FECHAMENTO, INCLUSO, ordenarMotivos, paragrafoMotivo } from './estruturacao.ts';

export interface DadosProposta {
  numero: string;
  emitidaEm: Date;
  tomadorNome: string;
  tomadorCnpj?: string | null;
  responsavel?: string | null;
  vigenciaInicio?: string | null; // AAAA-MM-DD
  vigenciaFim?: string | null;
  importanciaSegurada: number;
  premio: number;
  honorarios: number;
  total: number;
  observacoes?: string | null;
  motivosEstruturacao?: string[] | null;
  clausulaEspecial?: string | null;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const esc = (s?: string | null) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function campo(rotulo: string, valor?: string | null, larg = 1): string {
  if (!valor || !valor.trim()) return '';
  return `<div class="f" style="grid-column:span ${larg}"><span>${rotulo}</span><b>${esc(valor)}</b></div>`;
}

// Quadro que explica o honorário: só sai com honorário e ao menos um motivo marcado.
function quadroEstruturacao(d: DadosProposta): string {
  const motivos = ordenarMotivos(d.motivosEstruturacao);
  if (d.honorarios <= 0 || motivos.length === 0) return '';
  const li = (t: string) => `<li>${esc(t)}</li>`;
  return `<section class="card est"><h2>Estruturação do Seguro</h2>
    <p>A estruturação é o trabalho de preparar a empresa para conseguir o limite necessário junto às seguradoras. Ela envolve:</p>
    <ol>${INCLUSO.map(li).join('')}</ol>
    <h3>Por que este caso exige estruturação</h3>
    ${motivos.map(m => `<p>${esc(paragrafoMotivo(m, d.clausulaEspecial))}</p>`).join('')}
    ${FECHAMENTO.map(t => `<p class="nota">${esc(t)}</p>`).join('')}
  </section>`;
}

export function htmlProposta(d: DadosProposta): string {
  const vig = d.vigenciaInicio || d.vigenciaFim;
  const obs = (d.observacoes ?? '').trim();
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Proposta ${esc(d.numero)} ${esc(d.tomadorNome)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,700&display=swap">
<style>
:root{--navy:#243444;--navy-2:#2f4458;--beige:#eac8ac;--line:#dfe4eb;--ink:#14202e;--muted:#5d6b7c}
*{box-sizing:border-box}
@page{size:A4;margin:12mm 12mm 14mm}
html,body{margin:0;background:#fff;color:var(--ink);font:12.5px/1.5 "IBM Plex Sans","Segoe UI",Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{background:linear-gradient(110deg,var(--navy),var(--navy-2));color:#fff;border-bottom:4px solid var(--beige);border-radius:10px 10px 0 0;padding:12px 18px;display:flex;align-items:center;gap:18px}
.logo{height:50px;width:auto;flex:none;display:block}
.brand{flex:1;border-left:1px solid rgba(234,200,172,.35);padding-left:18px;font-size:12px;opacity:.85;line-height:1.6}
.brand span{white-space:nowrap}
.id{text-align:right;font-size:12px;line-height:1.6}
.id b{display:block;font-size:14px;color:var(--beige);letter-spacing:.06em;text-transform:uppercase}
main{display:grid;gap:8px;padding-top:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 16px;break-inside:avoid}
h2{margin:0 0 6px;font:700 15px/1.2 "Source Serif 4",Georgia,serif;color:var(--navy)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 16px}
.f span{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:500}
.f b{font-weight:500;font-size:13px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:4px 12px;border-bottom:2px solid var(--line)}
td{padding:6px 12px;border-bottom:1px solid var(--line)}
th:last-child,td:last-child{text-align:right}
tr.total td{background:var(--navy);color:#fff;font-weight:600;font-size:15px;border:0}
tr.total td:first-child{border-radius:9px 0 0 9px}
tr.total td:last-child{border-radius:0 9px 9px 0}
.obs{white-space:pre-wrap;margin:0}
.est p{margin:0 0 5px}
.est ol{margin:0 0 6px;padding-left:20px}
.est li{margin-bottom:2px}
.est h3{margin:8px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
.est .nota{font-size:11.5px;color:var(--muted)}
.sig p{margin:0;font-size:11px;color:var(--muted)}
footer{text-align:center;font-size:11.5px;color:var(--muted);padding-top:4px}
footer b{color:var(--navy)}
</style></head>
<body>
<header>
  ${logoBege}
  <div class="brand"><span>Corretora registrada na SUSEP nº 242160653</span><br><span>CNPJ 56.123.874/0001-90 · Boituva/SP</span></div>
  <div class="id"><b>Proposta Comercial</b>Nº ${esc(d.numero)}<br>Emitida em ${d.emitidaEm.toLocaleDateString('pt-BR')}</div>
</header>
<main>
  <section class="card"><h2>Dados do Tomador</h2><div class="grid">
    ${campo('Empresa', d.tomadorNome, 2)}${campo('CNPJ', d.tomadorCnpj)}${campo('Responsável', d.responsavel)}
  </div></section>
  ${vig ? `<section class="card"><h2>Vigência da Garantia</h2><div class="grid">${campo('Início', data(d.vigenciaInicio))}${campo('Fim', data(d.vigenciaFim))}</div></section>` : ''}
  <section class="card"><h2>Resumo da Proposta</h2>
    <table><thead><tr><th>Descrição</th><th>Valor (R$)</th></tr></thead><tbody>
      <tr><td>Importância Segurada (IS)</td><td>${brl(d.importanciaSegurada)}</td></tr>
      <tr><td>Prêmio da Garantia</td><td>${brl(d.premio)}</td></tr>
      ${d.honorarios > 0 ? `<tr><td>Honorários de Estruturação e Suporte Técnico</td><td>${brl(d.honorarios)}</td></tr>` : ''}
      <tr class="total"><td>Valor Total da Proposta</td><td>${brl(d.total)}</td></tr>
    </tbody></table>
  </section>
  ${quadroEstruturacao(d)}
  ${obs ? `<section class="card"><h2>Observações</h2><p class="obs">${esc(obs)}</p></section>` : ''}
  <section class="card sig"><h2>Condições e Sigilo</h2>
    <p>Esta proposta é confidencial e destinada exclusivamente ao tomador indicado. As informações e os materiais elaborados pela F&amp;G Seguro Garantia não podem ser repassados a terceiros sem autorização prévia da corretora. Os valores dependem da aprovação final da seguradora e da manutenção das condições informadas até a emissão. Os dados recebidos são tratados conforme a LGPD (Lei 13.709/2018) e usados apenas para análise de crédito, subscrição e emissão da garantia.</p>
  </section>
  <footer>
    Proposta válida por <b>3 dias úteis</b> · Pagamento à vista via <b>PIX</b> para emissão da apólice.<br>
    O boleto é quitado pela corretora e o comprovante encaminhado ao tomador.<br><br>
    <b>Fábio Lima</b> · CEO · F&amp;G Seguro Garantia<br>
    WhatsApp (15) 99861-8659 · fabio@fegsegurogarantia.com.br · fegsegurogarantia.com.br
  </footer>
</main>
</body></html>`;
}

/** Imprime a proposta num iframe escondido (o navegador oferece "Salvar como PDF"). */
export function imprimirProposta(d: DadosProposta): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(htmlProposta(d));
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
  // Espera a fonte carregar (sem travar se a rede falhar).
  const fontes = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fontes?.ready) Promise.race([fontes.ready, new Promise(r => setTimeout(r, 1500))]).then(disparar);
  else setTimeout(disparar, 500);
}
