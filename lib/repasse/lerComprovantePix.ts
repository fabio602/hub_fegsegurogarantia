/**
 * Leitura por regras (sem IA) do comprovante de PIX que a imobiliária anexa no
 * portal para o repasse do seguro. Recebe o texto do comprovante, que vem de
 * lib/pdf/lerDocumento.ts (texto do PDF ou OCR local, quando o comprovante é
 * foto ou um PDF que só tem a imagem, como o do Sicoob).
 *
 * O resultado é uma AJUDA para a conferência do Fábio, nunca a baixa: comprovante
 * de envio não prova que o dinheiro entrou, e quem confirma é ele, olhando o
 * extrato. Campo que não foi achado fica null; nada é adivinhado.
 *
 * Cada banco escreve de um jeito ("Pagador/Recebedor", "Origem/Destino",
 * "Quem pagou/Quem recebeu"). Ao aparecer um formato novo que a leitura não
 * pega, acrescente o rótulo nas listas abaixo e um caso no teste
 * regressao/comprovante-pix.teste.ts.
 */

export interface LeituraComprovante {
  valor: number | null;
  /** AAAA-MM-DD */
  data: string | null;
  pagador: string | null;
  recebedor: string | null;
  /** Identificador do PIX (E + 31 caracteres). Por OCR pode vir com letra trocada. */
  idTransacao: string | null;
}

export interface ConferenciaComprovante {
  valorConfere: boolean | null;
  pagadorConfere: boolean | null;
  recebedorConfere: boolean | null;
  /** true só quando os três conferem */
  confere: boolean;
}

const ROTULOS_PAGADOR = ['pagador', 'origem', 'quem pagou', 'dados do pagador', 'dados de quem pagou', 'de'];
const ROTULOS_RECEBEDOR = ['recebedor', 'destino', 'quem recebeu', 'favorecido', 'dados do recebedor', 'dados de quem recebeu', 'para'];
/** Linhas que encerram o nome (o próximo campo do bloco). */
const FIM_DO_NOME = /^(cpf|cnpj|institui|banco|ag[eê]ncia|conta|chave|tipo|id\b|identificador|autentica|data|valor|pagador|recebedor|origem|destino|quem\s|favorecido|dados\s)/i;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s: string) => semAcento(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function nomeDoBloco(linhas: string[], rotulos: string[]): string | null {
  for (let i = 0; i < linhas.length; i++) {
    const atual = chave(linhas[i]);
    if (!rotulos.includes(atual)) continue;
    const partes: string[] = [];
    for (let j = i + 1; j < linhas.length && j <= i + 5; j++) {
      const l = linhas[j].trim();
      if (!l) continue;
      if (chave(l) === 'nome') continue;
      // "Nome: FULANO" na mesma linha
      const mesmaLinha = l.match(/^nome\s*[:\-]\s*(.+)$/i);
      if (mesmaLinha) { partes.push(mesmaLinha[1].trim()); continue; }
      if (FIM_DO_NOME.test(semAcento(l)) || /\d{3}[.\s]?\d{3}|\*\*/.test(l)) break;
      partes.push(l);
      if (partes.length === 2) break; // razão social quebrada em duas linhas
    }
    const nome = partes.join(' ').replace(/\s+/g, ' ').trim();
    if (nome.length >= 3) return nome;
  }
  return null;
}

export function lerComprovantePix(texto: string): LeituraComprovante {
  const t = String(texto || '').replace(/\r/g, '');
  const linhas = t.split('\n').map((l) => l.trim());

  const mValor = t.match(/R\$\s*([\d.]{1,12},\d{2})/);
  const valor = mValor ? Number(mValor[1].replace(/\./g, '').replace(',', '.')) : null;

  const mData = t.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const data = mData ? `${mData[3]}-${mData[2]}-${mData[1]}` : null;

  const mId = t.match(/\bE[0-9A-Za-z]{31}\b/);

  return {
    valor: valor !== null && Number.isFinite(valor) ? valor : null,
    data,
    pagador: nomeDoBloco(linhas, ROTULOS_PAGADOR),
    recebedor: nomeDoBloco(linhas, ROTULOS_RECEBEDOR),
    idTransacao: mId ? mId[0] : null,
  };
}

const IGNORAR = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'e', 'de', 'da', 'do', 'dos', 'das', 'imobiliaria', 'imoveis', 'negocios', 'imobiliarios', 'administradora']);
const palavras = (s: string) => chave(s).split(' ').filter((p) => p.length >= 3 && !IGNORAR.has(p));

/** O pagador é a imobiliária? Basta uma palavra forte do nome em comum (ex.: "Bordim"). */
function nomesBatem(lido: string, cadastro: string): boolean {
  const a = new Set(palavras(lido));
  return palavras(cadastro).some((p) => a.has(p));
}

/** O recebedor é a F&G? Aceita a razão social com o "&" lido de vários jeitos pelo OCR. */
function ehFG(recebedor: string): boolean {
  const c = chave(recebedor);
  return /\bf\s?(e|g|8)?\s?g\b.*corretora/.test(c) || /\bfg\b.*corretora/.test(c) || c.includes('f g corretora') || c.includes('feg seguro');
}

export function conferirComprovante(
  l: LeituraComprovante,
  esperado: { valor: number | null; imobiliaria: string | null },
): ConferenciaComprovante {
  const valorConfere = l.valor === null || esperado.valor === null
    ? null
    : Math.abs(l.valor - Number(esperado.valor)) < 0.005;
  const pagadorConfere = !l.pagador || !esperado.imobiliaria ? null : nomesBatem(l.pagador, esperado.imobiliaria);
  const recebedorConfere = !l.recebedor ? null : ehFG(l.recebedor);
  return {
    valorConfere,
    pagadorConfere,
    recebedorConfere,
    confere: valorConfere === true && pagadorConfere === true && recebedorConfere === true,
  };
}
