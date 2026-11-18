/**
 * Leitura da apólice de Seguro Residencial da Tokio Marine por regras: sem IA, sem rede.
 *
 * Recebe o texto das páginas (lib/pdf/lerDocumento.ts) e devolve os campos do
 * Registro de Venda do residencial já no formato da tela (CPF com máscara, datas
 * AAAA-MM-DD, valores "R$ 0,00"). Campo que não foi achado volta vazio: a tela não
 * inventa nada e mostra o que ficou faltando.
 *
 * Layout de referência: apólice "Tokio Marine Residencial - Apólice de Seguro"
 * (Seguro novo, nov/2026). O texto do unpdf separa "Segurado:" do nome, por isso o
 * nome é lido pela linha que termina em "Nome Social:". Se aparecer apólice que
 * venha errada, acrescente a variação aqui (uma regra por família de layout).
 */

export interface ApoliceTokioResidencial {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  apolice: string;
  data_emissao: string;
  vigencia_inicio: string;
  fim_vigencia: string;
  premio_total: string;
  forma_pagamento: string;
  parcelas: number;
  tipo_imovel: string;
  cep_imovel: string;
  endereco_imovel: string;
  numero_imovel: string;
  complemento_imovel: string;
  /** Limite máximo de garantia da apólice: informativo, não é o valor do imóvel */
  limite_maximo: string;
  /** Avisos para conferir (ex.: forma de pagamento deduzida) */
  avisos: string[];
}

const DATA = String.raw`(\d{2}/\d{2}/\d{4})`;

const iso = (dmy: string | undefined) => {
  const m = dmy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

const brl = (valor: string | undefined) => (valor ? `R$ ${valor.trim()}` : '');

const PALAVRAS_MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
/** "RUA ANTONIO PICCO NETO" → "Rua Antonio Picco Neto" (o PDF vem todo em maiúsculas) */
const tituloCase = (s: string) =>
  s.toLowerCase().split(/\s+/).filter(Boolean)
    .map((p, i) => (i > 0 && PALAVRAS_MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');

const limpar = (s: string | undefined) => (s || '').replace(/\s+/g, ' ').trim();

export function ehApoliceTokioResidencial(texto: string): boolean {
  return /tokio\s+marine/i.test(texto) && /residencial/i.test(texto) && /Local do Risco:/i.test(texto);
}

export function extrairApoliceTokioResidencial(paginas: string[]): ApoliceTokioResidencial {
  const texto = paginas.join('\n');
  // Dados do segurado e do pagamento ficam antes do bloco do corretor (que tem
  // telefone e endereço da própria F&G: não podem cair no cadastro do cliente).
  const corte = texto.search(/Nome Corretor:/i);
  const frente = corte > 0 ? texto.slice(0, corte) : texto;
  const avisos: string[] = [];

  // Nome: "MARCELA ... Nome Social:" (com ou sem "Segurado:" na frente)
  let nome = '';
  const mNome = frente.match(/(?:Segurado:[ \t]*)?([A-ZÀ-Ü][A-ZÀ-Ü'.\- ]{3,}?)[ \t]*\n?[ \t]*Nome Social:/);
  if (mNome) nome = limpar(mNome[1]);

  const cpf = frente.match(/CPF:\s*(\d{3}\.\d{3}\.\d{3}-\d{2})/)?.[1] || '';
  const email = (frente.match(/E-mail:\s*([^\s@]+@[^\s@]+\.[^\s@]+)/i)?.[1] || '').toLowerCase();
  const telefone = limpar(frente.match(/Celular:\s*(\(\d{2}\)\s*\d{4,5}-?\d{4})/i)?.[1]);

  // Número: "Apólice: 09754136". Guardado sem zeros à esquerda, como o resto do HUB
  // e o Repasse (numero_apolice) já fazem.
  const numero = frente.match(/Ap[óo]lice:\s*0*(\d{5,})/i)?.[1]
    || frente.match(/Ap[óo]lice\s+n[ºo°]\s*0*(\d{5,})/i)?.[1] || '';

  const mVig = frente.match(new RegExp(String.raw`a partir das .{0,20}?dia\s+${DATA}\s+até .{0,20}?dia\s+${DATA}`, 'i'))
    || frente.match(new RegExp(String.raw`De\s+${DATA}\s+Até:?\s*${DATA}`, 'i'));
  const vigencia_inicio = iso(mVig?.[1]);
  const fim_vigencia = iso(mVig?.[2]);
  const data_emissao = iso(frente.match(new RegExp(String.raw`Data da Emiss[ãa]o:\s*${DATA}`, 'i'))?.[1]);

  const premio = frente.match(/Pr[êe]mio Total:\s*R\$\s*([\d.]+,\d{2})/i)?.[1];

  // Forma de pagamento
  const parcelas = (frente.match(/^\s*\d{2}ª\s+[\d.]+,\d{2}/gm) || []).length;
  const cobranca = limpar(frente.match(/Cobran[çc]a:\s*([^\n]+)/i)?.[1]).toLowerCase();
  let forma_pagamento = '';
  if (/cart[ãa]o/.test(cobranca)) forma_pagamento = 'Cartão de Crédito';
  else if (/d[ée]bito/.test(cobranca)) forma_pagamento = 'Débito Automático';
  else if (/pix/.test(cobranca)) forma_pagamento = 'PIX';
  else if (/boleto|carn[êe]|ficha/.test(cobranca)) {
    forma_pagamento = parcelas > 1 ? 'Boleto Mensal' : 'Boleto Anual';
    avisos.push(`Forma de pagamento deduzida do boleto com ${parcelas || 1} parcela(s): confira.`);
  } else if (cobranca) {
    avisos.push(`Forma de cobrança "${cobranca}" não reconhecida: escolha à mão.`);
  }

  // Tipo de imóvel
  const tipoPdf = limpar(frente.match(/Tipo de Im[óo]vel:\s*([^\n]+)/i)?.[1]).toLowerCase();
  let tipo_imovel = '';
  if (/apart/.test(tipoPdf)) tipo_imovel = 'Apartamento';
  else if (/condom/.test(tipoPdf)) tipo_imovel = 'Casa em condomínio';
  else if (/casa/.test(tipoPdf)) tipo_imovel = 'Casa';
  else if (/comerc/.test(tipoPdf)) tipo_imovel = 'Comercial';
  else if (tipoPdf) avisos.push(`Tipo de imóvel "${tipoPdf}" não reconhecido: escolha à mão.`);

  // Local do risco (o imóvel segurado, que pode ser diferente do endereço do segurado)
  let cep_imovel = '', endereco_imovel = '', numero_imovel = '', complemento_imovel = '';
  const iRisco = frente.search(/Local do Risco:/i);
  if (iRisco >= 0) {
    const risco = frente.slice(iRisco, iRisco + 600);
    const rua = limpar(risco.match(/Local do Risco:\s*(.+?)\s+N[úu]mero Logradouro:/i)?.[1]);
    numero_imovel = limpar(risco.match(/N[úu]mero Logradouro:[ \t]*([^\s\n]*)/i)?.[1]);
    complemento_imovel = limpar(risco.match(/Complemento:[ \t]*(.*?)[ \t]*Bairro:/i)?.[1]);
    const bairro = limpar(risco.match(/Bairro:[ \t]*([^\n]+?)(?:[ \t]{2,}|\n|$)/i)?.[1]);
    const mCid = risco.match(/Cidade:\s*(.+?)\s+CEP:\s*(\d{5}-?\d{3})\s+UF:\s*([A-Z]{2})/i);
    const cidade = limpar(mCid?.[1]);
    cep_imovel = mCid?.[2] ? mCid[2].replace(/^(\d{5})-?(\d{3})$/, '$1-$2') : '';
    const uf = mCid?.[3]?.toUpperCase() || '';

    // A Tokio abrevia o logradouro do risco ("EST MUNICIPAL..."). Se o endereço do
    // segurado é o mesmo imóvel (mesmo CEP e número), usa o nome completo dele.
    let ruaFinal = rua;
    const mSeg = frente.slice(0, iRisco).match(/Endere[çc]o:\s*([^\n,]+),\s*(\S+)[\s\S]{0,200}?CEP:\s*(\d{5}-?\d{3})/i);
    if (mSeg && mSeg[3].replace(/\D/g, '') === cep_imovel.replace(/\D/g, '') && limpar(mSeg[2]) === numero_imovel) {
      ruaFinal = limpar(mSeg[1]);
    }
    const partes = [tituloCase(ruaFinal), tituloCase(bairro)].filter(Boolean);
    const local = cidade ? `${tituloCase(cidade)}${uf ? `/${uf}` : ''}` : '';
    endereco_imovel = [...partes, local].filter(Boolean).join(', ');
  }

  const limite = frente.match(/Limite M[áa]ximo de Garantia:\s*R\$\s*([\d.]+,\d{2})/i)?.[1];

  return {
    nome, cpf, telefone, email,
    apolice: numero,
    data_emissao, vigencia_inicio, fim_vigencia,
    premio_total: brl(premio),
    forma_pagamento, parcelas,
    tipo_imovel, cep_imovel, endereco_imovel, numero_imovel, complemento_imovel,
    limite_maximo: brl(limite),
    avisos,
  };
}
