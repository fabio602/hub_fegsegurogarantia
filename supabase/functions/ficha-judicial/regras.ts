// Regras da ficha de garantia judicial (depósito recursal trabalhista).
//
// Código puro, sem rede nem banco, para poder ser testado sozinho
// (regras_test.ts). A Edge Function nunca confia no que o navegador validou:
// tudo o que o formulário confere é conferido de novo aqui.

export class Erro extends Error {
  constructor(msg: string, public status = 400, public campo = '') { super(msg); }
}

export const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** CNPJ numérico ou alfanumérico (formato novo da Receita, em vigor desde jul/2026). */
export function cnpjValido(entrada: unknown): boolean {
  const c = String(entrada ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let soma = 0, peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  return c.slice(12) === `${d1}${dv(c.slice(0, 12) + d1)}`;
}

export function cpfValido(entrada: unknown): boolean {
  const c = soDigitos(entrada);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (peso - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

/** Número único do CNJ (20 dígitos), com o dígito verificador (módulo 97). */
export function cnjValido(entrada: unknown): boolean {
  const d = soDigitos(entrada);
  if (d.length !== 20) return false;
  const resto = Number(BigInt(d.slice(0, 7) + d.slice(9) + '00') % 97n);
  return 98 - resto === Number(d.slice(7, 9));
}

export const fmtCnj = (d: string) => d.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
export const fmtCnpj = (c: string) => c.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
export const fmtCpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
export const fmtCep = (c: string) => c.replace(/^(\d{5})(\d{3})$/, '$1-$2');
export const fmtTelefone = (d: string) => d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
export const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dataBr = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');

export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
export const RECURSOS = ['Recurso Ordinário', 'Recurso de Revista', 'Agravo de Instrumento', 'Embargos', 'Outro'];
export const PAPEIS = ['advogado', 'empresa'] as const;
export const CAUCOES = ['nova', 'substituicao', 'adicional'] as const;
export const EXITOS = ['provavel', 'possivel', 'remota'] as const;

export const ROTULO_PAPEL: Record<string, string> = { advogado: 'Advogado da causa', empresa: 'Da empresa' };
export const ROTULO_CAUCAO: Record<string, string> = {
  nova: 'Nova garantia no processo', substituicao: 'Substituição de uma garantia já existente', adicional: 'Garantia adicional',
};
export const ROTULO_EXITO: Record<string, string> = { provavel: 'Provável', possivel: 'Possível', remota: 'Remota' };

/** Acréscimo de 30% pedido na ficha das seguradoras. Conta em centavos, sem erro de ponto flutuante. */
export function valorComAcrescimo(valorBase: number): number {
  const centavos = Math.round(valorBase * 100);
  return (centavos + Math.round(centavos * 0.3)) / 100;
}

export type Ficha = {
  contato_nome: string; contato_papel: string; contato_email: string; contato_telefone: string;
  tomador_cnpj: string; tomador_razao_social: string; tomador_cep: string; tomador_endereco: string;
  tomador_cidade: string; tomador_uf: string;
  processo_numero: string; processo_juizo: string; valor_causa: number; data_distribuicao: string;
  recurso: string; tipo_caucao: string;
  reclamante_nome: string; reclamante_documento: string; reclamante_endereco: string | null;
  objeto: string; historico: string; linha_defesa: string; probabilidade_exito: string;
  advogado_nome: string; advogado_oab: string; advogado_oab_uf: string;
  valor_base: number; valor_garantia: number; data_base: string; indice_reajuste: string;
  objetivo: string; segurado: string | null; observacoes: string | null;
};

/**
 * Lê e valida o corpo enviado pelo formulário. Devolve a ficha pronta para
 * gravar (valores normalizados) ou lança Erro com o campo que falhou.
 * `hoje` é a data de Brasília em ISO (aaaa-mm-dd).
 */
export function lerFicha(c: Record<string, unknown>, hoje: string): Ficha {
  const texto = (campo: string, rotulo: string, max = 200, obrigatorio = true): string => {
    const v = String(c[campo] ?? '').replace(/\s+/g, ' ').trim();
    if (!v && obrigatorio) throw new Erro(`Preencha: ${rotulo}.`, 400, campo);
    if (v.length > max) throw new Erro(`${rotulo}: use no máximo ${max} caracteres.`, 400, campo);
    return v;
  };
  const longo = (campo: string, rotulo: string, obrigatorio = true): string => {
    const v = String(c[campo] ?? '').replace(/\r\n/g, '\n').trim();
    if (!v && obrigatorio) throw new Erro(`Preencha: ${rotulo}.`, 400, campo);
    if (v.length > 4000) throw new Erro(`${rotulo}: use no máximo 4.000 caracteres.`, 400, campo);
    return v;
  };
  const opcao = (campo: string, rotulo: string, lista: readonly string[]): string => {
    const v = String(c[campo] ?? '');
    if (!lista.includes(v)) throw new Erro(`Escolha uma opção em: ${rotulo}.`, 400, campo);
    return v;
  };
  const valor = (campo: string, rotulo: string): number => {
    const n = typeof c[campo] === 'number' ? c[campo] as number : NaN;
    if (!Number.isFinite(n) || n <= 0) throw new Erro(`${rotulo}: informe um valor maior que zero.`, 400, campo);
    if (n > 999_999_999_999) throw new Erro(`${rotulo}: valor alto demais. Confira.`, 400, campo);
    return Math.round(n * 100) / 100;
  };
  const data = (campo: string, rotulo: string): string => {
    const v = String(c[campo] ?? '');
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) &&
      new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
    if (!ok) throw new Erro(`${rotulo}: data inválida.`, 400, campo);
    if (v > hoje) throw new Erro(`${rotulo}: a data não pode estar no futuro.`, 400, campo);
    if (v < '1990-01-01') throw new Erro(`${rotulo}: confira o ano.`, 400, campo);
    return v;
  };

  const contato_nome = texto('nome', 'seu nome completo');
  const contato_papel = opcao('papel', 'você é', PAPEIS);
  const contato_email = texto('email', 'e-mail', 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contato_email)) throw new Erro('Confira o e-mail.', 400, 'email');
  const tel = soDigitos(c.tel);
  if (tel.length !== 11 || tel[2] !== '9') throw new Erro('Informe o celular com DDD e o 9 na frente.', 400, 'tel');

  if (!cnpjValido(c.cnpj)) throw new Erro('CNPJ inválido. Confira os números.', 400, 'cnpj');
  const cnpj = String(c.cnpj).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const cep = soDigitos(c.cep);
  if (cep.length !== 8) throw new Erro('O CEP tem 8 dígitos.', 400, 'cep');

  if (!cnjValido(c.numero)) throw new Erro('Número de processo inválido. Use o padrão do CNJ, com 20 dígitos.', 400, 'numero');

  const doc = soDigitos(c.recDoc);
  const docOk = doc.length === 11 ? cpfValido(doc) : (doc.length === 14 && cnpjValido(doc));
  if (!docOk) throw new Erro('CPF ou CNPJ do reclamante inválido. Confira os números.', 400, 'recDoc');

  const oab = String(c.oab ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^\d{1,7}[A-Z]?$/.test(oab)) throw new Erro('Confira o número da OAB.', 400, 'oab');

  const valor_base = valor('valorBase', 'Valor a garantir');

  return {
    contato_nome, contato_papel, contato_email, contato_telefone: tel,
    tomador_cnpj: cnpj,
    tomador_razao_social: texto('razao', 'razão social'),
    tomador_cep: cep,
    tomador_endereco: texto('endereco', 'endereço da empresa', 300),
    tomador_cidade: texto('cidade', 'cidade', 120),
    tomador_uf: opcao('uf', 'UF da empresa', UFS),
    processo_numero: fmtCnj(soDigitos(c.numero)),
    processo_juizo: texto('juizo', 'vara e cidade'),
    valor_causa: valor('valorCausa', 'Valor da causa'),
    data_distribuicao: data('dataDist', 'Data de distribuição'),
    recurso: opcao('recurso', 'recurso que será apresentado', RECURSOS),
    tipo_caucao: opcao('caucao', 'tipo de garantia', CAUCOES),
    reclamante_nome: texto('recNome', 'nome do reclamante'),
    reclamante_documento: doc,
    reclamante_endereco: texto('recEnd', 'endereço do reclamante', 300, false) || null,
    objeto: longo('objeto', 'objeto do processo'),
    historico: longo('historico', 'histórico do processo'),
    linha_defesa: longo('defesa', 'linha de defesa'),
    probabilidade_exito: opcao('exito', 'probabilidade de êxito', EXITOS),
    advogado_nome: texto('advNome', 'nome do advogado'),
    advogado_oab: oab,
    advogado_oab_uf: opcao('oabUf', 'UF da OAB', UFS),
    valor_base,
    valor_garantia: valorComAcrescimo(valor_base),
    data_base: data('dataBase', 'Data base do valor'),
    indice_reajuste: texto('indice', 'índice de reajuste'),
    objetivo: longo('objetivo', 'objetivo da garantia'),
    segurado: texto('segurado', 'segurado', 200, false) || null,
    observacoes: longo('obs', 'observações', false) || null,
  };
}

// ── anexos ───────────────────────────────────────────────────────────────────
export const CATEGORIAS = ['sentenca', 'calculo', 'procuracao'] as const;
export const ROTULO_CATEGORIA: Record<string, string> = {
  sentenca: 'Sentença ou decisão recorrida', calculo: 'Cálculo da condenação', procuracao: 'Procuração do advogado',
};
export const EXTENSOES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
export const MAX_BYTES = 20 * 1024 * 1024; // igual ao limite do bucket

export function extensao(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome || '');
  return m ? m[1].toLowerCase() : '';
}

export function nomeSeguro(nome: string): string {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (base || 'arquivo').slice(-90);
}

export type ArquivoPedido = { categoria: string; nome: string; tamanho: number; tipo: string };

/** Confere a lista de arquivos que o formulário quer enviar. A sentença é obrigatória. */
export function lerArquivos(entrada: unknown): ArquivoPedido[] {
  const lista = Array.isArray(entrada) ? entrada as Array<Record<string, unknown>> : [];
  const saida: ArquivoPedido[] = [];
  for (const a of lista) {
    const categoria = String(a.categoria ?? '');
    if (!(CATEGORIAS as readonly string[]).includes(categoria)) throw new Erro('Documento não reconhecido.', 400, 'arquivos');
    if (saida.some((x) => x.categoria === categoria)) throw new Erro('Envie um arquivo por documento.', 400, 'arquivos');
    const nome = String(a.nome ?? '');
    const ext = extensao(nome);
    if (!EXTENSOES[ext]) throw new Erro(`"${nome}" não é PDF, Word, JPG ou PNG.`, 400, categoria);
    const tamanho = Number(a.tamanho) || 0;
    if (tamanho <= 0) throw new Erro(`"${nome}" está vazio.`, 400, categoria);
    if (tamanho > MAX_BYTES) throw new Erro(`"${nome}" passa de 20 MB.`, 400, categoria);
    saida.push({ categoria, nome, tamanho, tipo: EXTENSOES[ext] });
  }
  if (!saida.some((x) => x.categoria === 'sentenca')) throw new Erro('Anexe a sentença ou decisão recorrida.', 400, 'sentenca');
  return saida;
}

/** Caminho de um anexo no bucket: aaaa-mm/<hash da origem>/<lote>/<categoria>-<nome>. */
export const RE_CAMINHO = /^\d{4}-\d{2}\/[a-f0-9]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(sentenca|calculo|procuracao)-[A-Za-z0-9._-]+$/;
export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
