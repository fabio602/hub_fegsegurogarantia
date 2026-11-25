// Regras do formulário: máscaras, validações, etapas, textos de ajuda e tetos.
// O servidor (Edge Function ficha-judicial) confere tudo de novo; aqui é para o
// cliente ver o erro na hora. Ao mudar uma regra, mude também em
// supabase/functions/ficha-judicial/regras.ts.

var UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
function dg(s) { return (s || '').replace(/\D/g, ''); }
function pat(p, c) { var o = '', i = 0; for (var k = 0; k < p.length && i < c.length; k++) { o += p[k] === '#' ? c[i++] : p[k]; } return o; }
function okCnpj(s) {
  var c = (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  function dv(b) { var sum = 0, w = 2; for (var i = b.length - 1; i >= 0; i--) { sum += (b.charCodeAt(i) - 48) * w; w = w === 9 ? 2 : w + 1; } var r = sum % 11; return r < 2 ? 0 : 11 - r; }
  var d1 = dv(c.slice(0, 12)); return c.slice(12) === '' + d1 + dv(c.slice(0, 12) + d1);
}
function okCpf(s) {
  var c = dg(s); if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  function dv(b, w) { var sum = 0; for (var i = 0; i < b.length; i++) sum += Number(b[i]) * (w - i); var r = (sum * 10) % 11; return r === 10 ? 0 : r; }
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}
function okCnj(s) {
  var d = dg(s); if (d.length !== 20) return false;
  var r = Number(BigInt(d.slice(0, 7) + d.slice(9) + '00') % 97n);
  return 98 - r === Number(d.slice(7, 9));
}
function money(digits) { return digits ? (Number(digits) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; }
var MASK = {
  cnpj: function (s) { return pat('##.###.###/####-##', s.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14)); },
  doc: function (s) { var c = dg(s).slice(0, 14); return c.length > 11 ? pat('##.###.###/####-##', c) : pat('###.###.###-##', c); },
  cnj: function (s) { return pat('#######-##.####.#.##.####', dg(s).slice(0, 20)); },
  cep: function (s) { return pat('#####-###', dg(s).slice(0, 8)); },
  tel: function (s) { return pat('(##) #####-####', dg(s).slice(0, 11)); },
  money: function (s) { return money(dg(s).slice(0, 13)); },
  oab: function (s) { return dg(s).slice(0, 7); }
};
var CHECK = {
  email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Confira o e-mail. Exemplo: nome@empresa.com.br'; },
  tel: function (v) { var d = dg(v); return d.length === 11 && d[2] === '9' ? '' : 'Informe o celular com DDD e o 9 na frente. Exemplo: (15) 99999-0000'; },
  cnpj: function (v) { return okCnpj(v) ? '' : 'CNPJ inválido. Confira os números.'; },
  doc: function (v) { var d = dg(v); return (d.length === 11 ? okCpf(v) : okCnpj(v)) ? '' : 'CPF ou CNPJ inválido. Confira os números.'; },
  cnj: function (v) { return okCnj(v) ? '' : 'Número de processo inválido. Use o padrão do CNJ, com 20 dígitos.'; },
  cep: function (v) { return dg(v).length === 8 ? '' : 'O CEP tem 8 dígitos.'; },
  money: function (v) { return Number(dg(v)) > 0 ? '' : 'Informe um valor maior que zero.'; },
  past: function (v) { return v <= new Date().toISOString().slice(0, 10) ? '' : 'A data não pode estar no futuro.'; }
};
function F(key, label, span, o) { o = o || {}; o.key = key; o.label = label; o.span = span; return o; }
var STEPS = [
  { label: 'Você e a empresa', title: 'Quem está preenchendo', lead: 'Pode ser o advogado da causa ou alguém da empresa. É com esta pessoa que vamos falar.', groups: [
    { title: 'Seus dados', fields: [
      F('nome', 'Seu nome completo', 3), F('papel', 'Você é', 3, { kind: 'pills', options: ['Advogado da causa', 'Da empresa'] }),
      F('email', 'E-mail', 3, { type: 'email', check: 'email', ph: 'nome@empresa.com.br', hint: 'A confirmação e a cópia da ficha vão para este e-mail.' }),
      F('tel', 'Celular com DDD', 3, { mask: 'tel', check: 'tel', mode: 'tel', ph: '(15) 99999-0000' }) ] },
    { title: 'Empresa que vai contratar a garantia (a reclamada)', fields: [
      F('cnpj', 'CNPJ', 2, { mask: 'cnpj', check: 'cnpj', ph: '00.000.000/0000-00', ok: 'CNPJ válido' }), F('razao', 'Razão social', 4),
      F('cep', 'CEP', 2, { mask: 'cep', check: 'cep', mode: 'numeric', ph: '00000-000' }), F('endereco', 'Endereço, número e bairro', 4),
      F('cidade', 'Cidade', 4), F('uf', 'UF', 2, { kind: 'select', options: UFS }) ] } ] },
  { label: 'O processo', title: 'Dados do processo', lead: 'Copie os dados como estão no processo. O número é conferido na hora.', groups: [
    { title: 'Processo', fields: [
      F('numero', 'Número do processo', 3, { mask: 'cnj', check: 'cnj', mode: 'numeric', ph: '0000000-00.0000.5.00.0000' }), F('juizo', 'Vara e cidade', 3, { ph: 'Ex.: 2ª Vara do Trabalho de Sorocaba' }),
      F('valorCausa', 'Valor da causa (R$)', 2, { mask: 'money', check: 'money', mode: 'numeric', ph: '0,00' }), F('dataDist', 'Data de distribuição da ação', 2, { type: 'date', check: 'past' }),
      F('recurso', 'Recurso que será apresentado', 2, { kind: 'select', options: ['Recurso Ordinário', 'Recurso de Revista', 'Embargos', 'Agravo de Instrumento', 'Recurso Extraordinário', 'Outro'] }),
      F('caucao', 'Esta garantia é', 6, { kind: 'pills', options: ['Nova garantia no processo', 'Substituição de uma garantia já existente', 'Garantia adicional'] }) ] },
    { title: 'Reclamante (quem move a ação contra a empresa)', fields: [
      F('recNome', 'Nome completo do reclamante', 4), F('recDoc', 'CPF do reclamante', 2, { mask: 'doc', check: 'doc', mode: 'numeric', ph: '000.000.000-00', hint: 'Se for sindicato ou empresa, digite o CNPJ.' }),
      F('recEnd', 'Endereço do reclamante, como consta no processo', 6, { optional: true }) ] } ] },
  { label: 'Parecer do advogado', title: 'Parecer do advogado', lead: 'A seguradora analisa o risco por estas respostas. Se você não é o advogado, peça a ele estes textos antes de continuar.', groups: [
    { title: 'Sobre a causa', fields: [
      F('objeto', 'Objeto do processo', 6, { kind: 'area', ph: 'O que o reclamante pede. Ex.: horas extras, verbas rescisórias, reversão de justa causa.' }),
      F('historico', 'Histórico do processo', 6, { kind: 'area', ph: 'O que já aconteceu: sentença, data, valor arbitrado da condenação, recursos já apresentados.' }),
      F('defesa', 'Linha de defesa sustentada', 6, { kind: 'area', ph: 'Os principais argumentos do recurso.' }),
      F('exito', 'Probabilidade de êxito do recurso', 6, { kind: 'pills', options: ['Provável', 'Possível', 'Remota'] }) ] },
    { title: 'Advogado que patrocina a causa', fields: [
      F('advNome', 'Nome do advogado', 3), F('oab', 'Número da OAB', 2, { mask: 'oab', mode: 'numeric' }), F('oabUf', 'UF', 1, { kind: 'select', options: UFS }) ] } ] },
  { label: 'Valor e documentos', title: 'Valor da garantia e documentos', lead: 'Informe o valor sem o acréscimo. A conta dos 30% é feita aqui, à vista.', groups: [
    { title: 'Valor', fields: [
      F('valorBase', 'Valor a garantir, sem acréscimo (R$)', 2, { mask: 'money', check: 'money', mode: 'numeric', ph: '0,00' }), F('dataBase', 'Data base do valor', 2, { type: 'date', check: 'past' }),
      F('indice', 'Índice de reajuste adotado', 2, { ph: 'Ex.: IPCA-E e SELIC' }),
      F('objetivo', 'Objetivo da garantia', 6, { kind: 'area', ph: 'Ex.: garantir o juízo para interpor Recurso Ordinário, em substituição ao depósito recursal.' }),
      F('segurado', 'Quem deve constar como segurado (beneficiário) na apólice', 6, { optional: true, hint: 'Na dúvida, deixe em branco. Confirmamos com você e com a seguradora.' }) ] },
    { title: 'Documentos', fields: [
      F('docSentenca', 'Sentença ou decisão recorrida', 2, { kind: 'file' }), F('docCalculo', 'Cálculo da condenação', 2, { kind: 'file', optional: true }), F('docProcuracao', 'Procuração do advogado', 2, { kind: 'file', optional: true }),
      F('obs', 'Algo mais que devemos saber?', 6, { kind: 'area', optional: true }) ] } ] }
];
// Tetos do depósito recursal (TST, Ato SEGJUD.GP nº 381/2026, em vigor desde 1º/8/2026).
// O TST atualiza todo ano, em agosto: trocar aqui os valores e o texto da fonte.
var TETO_FONTE = 'TST, Ato SEGJUD.GP nº 381/2026, em vigor desde 1º/8/2026';
var TETOS = { 'Recurso Ordinário': 1441157, 'Recurso de Revista': 2882314, 'Embargos': 2882314 };
var HELP = {
  cnpj: 'CNPJ da empresa que é parte no processo e vai contratar a garantia (a reclamada). Se o processo tem mais de uma empresa, informe a que vai apresentar o recurso.',
  razao: 'Nome da empresa como está no cartão CNPJ.',
  numero: 'É o número único do processo, com 20 dígitos, no padrão 0000000-00.0000.5.00.0000. Aparece no cabeçalho da sentença e de qualquer peça do processo.',
  juizo: 'A vara onde o processo tramita e a cidade. Está no cabeçalho da sentença. Exemplo: 2ª Vara do Trabalho de Sorocaba.',
  valorCausa: 'Valor que o reclamante deu à causa na petição inicial. Não é o valor da condenação nem o da garantia.',
  dataDist: 'Data em que a ação foi ajuizada (distribuída). Aparece na capa do processo.',
  recurso: 'O recurso que a empresa vai apresentar e que exige a garantia. Na dúvida, pergunte ao advogado.',
  caucao: 'Nova: o processo ainda não tem garantia. Substituição: já existe um depósito ou outra garantia e a apólice entra no lugar. Adicional: complementa uma garantia que já existe.',
  recNome: 'A pessoa que entrou com a ação contra a empresa. Use o nome completo, como está no processo.',
  recDoc: 'O CPF do reclamante aparece na petição inicial e, em geral, na sentença.',
  objeto: 'Em poucas linhas, o que o reclamante está pedindo. Exemplo: horas extras, verbas rescisórias, reversão de justa causa.',
  historico: 'O que já aconteceu no processo: data da sentença, o que foi decidido, valor arbitrado da condenação e recursos já apresentados.',
  defesa: 'Os principais argumentos que a empresa vai sustentar no recurso.',
  exito: 'Avaliação do advogado sobre a chance de o recurso ser acolhido. A seguradora usa esta resposta na análise.',
  valorBase: 'O valor que o advogado indicou para garantir o recurso (por exemplo, o do depósito recursal), sem somar os 30%. A soma aparece logo abaixo. Quando o recurso tem teto de depósito recursal definido pelo TST, o teto aparece embaixo do campo, só como referência.',
  dataBase: 'A data a que esse valor se refere. Exemplo: a data da sentença ou do cálculo.',
  indice: 'O índice usado para atualizar o valor no processo. Costuma estar na sentença ou no cálculo. Exemplo: IPCA-E e SELIC.',
  objetivo: 'Para que a garantia vai servir no processo. Exemplo: garantir o juízo para interpor Recurso Ordinário, em substituição ao depósito recursal.',
  segurado: 'É quem recebe a indenização se a garantia for acionada. Se não souber, deixe em branco.',
  docSentenca: 'A decisão contra a qual a empresa vai recorrer, com todas as páginas. PDF, Word ou foto legível, até 20 MB.',
  docCalculo: 'A planilha de cálculo da condenação, se houver.',
  docProcuracao: 'A procuração que dá poderes ao advogado no processo.'
};
