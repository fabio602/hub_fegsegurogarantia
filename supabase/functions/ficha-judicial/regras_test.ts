// deno test supabase/functions/ficha-judicial/regras_test.ts
import { cnpjValido, cpfValido, cnjValido, valorComAcrescimo, lerFicha, lerArquivos, RE_CAMINHO, Erro, nomeSeguro } from "./regras.ts";

function igual(a: unknown, b: unknown, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
}
function falha(fn: () => unknown, campo: string) {
  try { fn(); } catch (e) {
    if (e instanceof Erro && e.campo === campo) return;
    throw new Error(`esperava erro no campo ${campo}, veio ${e instanceof Erro ? e.campo + ': ' + e.message : e}`);
  }
  throw new Error(`esperava erro no campo ${campo}, mas passou`);
}

const BASE: Record<string, unknown> = {
  nome: 'Marina Exemplo Duarte', papel: 'advogado', email: 'Marina@Exemplo.adv.br', tel: '(15) 99999-0000',
  cnpj: '11.222.333/0001-81', razao: 'Empresa Fictícia de Serviços Ltda', cep: '18550-000',
  endereco: 'Rua das Acácias, 100, Centro', cidade: 'Boituva', uf: 'SP',
  numero: '0001234-25.2026.5.15.0111', juizo: 'Vara do Trabalho de Tietê', valorCausa: 48000, dataDist: '2026-03-10',
  recurso: 'Recurso Ordinário', caucao: 'nova', recNome: 'João Fictício da Silva', recDoc: '529.982.247-25', recEnd: '',
  objeto: 'Horas extras.', historico: 'Sentença de 02/11/2026.', defesa: 'Controle de jornada válido.', exito: 'possivel',
  advNome: 'Marina Exemplo Duarte', oab: '123456', oabUf: 'SP', valorBase: 13000, dataBase: '2026-11-02',
  indice: 'IPCA-E e SELIC', objetivo: 'Garantir o juízo.', segurado: '', obs: '',
};
const HOJE = '2026-11-24';
const com = (extra: Record<string, unknown>) => ({ ...BASE, ...extra });

Deno.test('CNPJ: numérico, alfanumérico e inválidos', () => {
  igual(cnpjValido('56.123.874/0001-90'), true); igual(cnpjValido('12.ABC.345/01DE-35'), true);
  igual(cnpjValido('56.123.874/0001-91'), false); igual(cnpjValido('00.000.000/0000-00'), false); igual(cnpjValido(''), false);
});
Deno.test('CPF', () => {
  igual(cpfValido('529.982.247-25'), true); igual(cpfValido('529.982.247-26'), false); igual(cpfValido('111.111.111-11'), false);
});
Deno.test('CNJ: números reais de fichas anteriores e dígito trocado', () => {
  igual(cnjValido('0001090-03.2026.5.17.0012'), true); igual(cnjValido('0021191-05.2025.5.04.0741'), true);
  igual(cnjValido('0000358-20.2024.5.12.0048'), true); igual(cnjValido('0000358-21.2024.5.12.0048'), false); igual(cnjValido('123'), false);
});
Deno.test('acréscimo de 30% em centavos', () => {
  igual(valorComAcrescimo(13000), 16900); igual(valorComAcrescimo(7205.79), 9367.53); igual(valorComAcrescimo(0.01), 0.01);
  igual(valorComAcrescimo(1234.56), 1604.93);
});
Deno.test('ficha válida é normalizada', () => {
  const f = lerFicha(BASE, HOJE);
  igual(f.contato_email, 'marina@exemplo.adv.br'); igual(f.contato_telefone, '15999990000'); igual(f.tomador_cnpj, '11222333000181');
  igual(f.tomador_cep, '18550000'); igual(f.processo_numero, '0001234-25.2026.5.15.0111'); igual(f.reclamante_documento, '52998224725');
  igual(f.valor_garantia, 16900); igual(f.reclamante_endereco, null); igual(f.segurado, null); igual(f.observacoes, null);
});
Deno.test('valor da garantia nunca vem do navegador', () => {
  igual(lerFicha(com({ valor_garantia: 1, valorGarantia: 1 }), HOJE).valor_garantia, 16900);
});
Deno.test('cada trava recusa o campo certo', () => {
  falha(() => lerFicha(com({ nome: '  ' }), HOJE), 'nome');
  falha(() => lerFicha(com({ papel: 'outro' }), HOJE), 'papel');
  falha(() => lerFicha(com({ email: 'marina@exemplo' }), HOJE), 'email');
  falha(() => lerFicha(com({ tel: '(15) 3263-0000' }), HOJE), 'tel');
  falha(() => lerFicha(com({ cnpj: '11.222.333/0001-82' }), HOJE), 'cnpj');
  falha(() => lerFicha(com({ cep: '1855' }), HOJE), 'cep');
  falha(() => lerFicha(com({ uf: 'XX' }), HOJE), 'uf');
  falha(() => lerFicha(com({ numero: '0001234-26.2026.5.15.0111' }), HOJE), 'numero');
  falha(() => lerFicha(com({ valorCausa: '48.000,00' }), HOJE), 'valorCausa');
  falha(() => lerFicha(com({ valorBase: -1 }), HOJE), 'valorBase');
  falha(() => lerFicha(com({ dataDist: '2026-11-25' }), HOJE), 'dataDist');
  falha(() => lerFicha(com({ dataBase: '2026-02-30' }), HOJE), 'dataBase');
  falha(() => lerFicha(com({ recurso: 'Apelação' }), HOJE), 'recurso');
  falha(() => lerFicha(com({ caucao: '' }), HOJE), 'caucao');
  falha(() => lerFicha(com({ recDoc: '529.982.247-26' }), HOJE), 'recDoc');
  falha(() => lerFicha(com({ exito: 'certa' }), HOJE), 'exito');
  falha(() => lerFicha(com({ oab: 'abc' }), HOJE), 'oab');
  falha(() => lerFicha(com({ objeto: 'x'.repeat(4001) }), HOJE), 'objeto');
  falha(() => lerFicha(com({ razao: 'x'.repeat(201) }), HOJE), 'razao');
});
Deno.test('reclamante com CNPJ (sindicato) é aceito', () => {
  igual(lerFicha(com({ recDoc: '56.123.874/0001-90' }), HOJE).reclamante_documento, '56123874000190');
});
Deno.test('arquivos: sentença obrigatória, tipos e tamanho', () => {
  igual(lerArquivos([{ categoria: 'sentenca', nome: 'Sentença final.PDF', tamanho: 1000 }])[0].tipo, 'application/pdf');
  falha(() => lerArquivos([{ categoria: 'calculo', nome: 'c.pdf', tamanho: 10 }]), 'sentenca');
  falha(() => lerArquivos([{ categoria: 'sentenca', nome: 'virus.exe', tamanho: 10 }]), 'sentenca');
  falha(() => lerArquivos([{ categoria: 'sentenca', nome: 's.pdf', tamanho: 21 * 1024 * 1024 }]), 'sentenca');
  falha(() => lerArquivos([{ categoria: 'sentenca', nome: 's.pdf', tamanho: 1 }, { categoria: 'sentenca', nome: 't.pdf', tamanho: 1 }]), 'arquivos');
  falha(() => lerArquivos([{ categoria: 'outro', nome: 's.pdf', tamanho: 1 }]), 'arquivos');
});
Deno.test('caminho do anexo: só o formato gerado pela function', () => {
  const lote = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
  igual(RE_CAMINHO.test(`2026-11/0123456789ab/${lote}/sentenca-${nomeSeguro('Sentença final.PDF')}`), true);
  igual(RE_CAMINHO.test(`2026-11/0123456789ab/${lote}/../x/sentenca-a.pdf`), false);
  igual(RE_CAMINHO.test(`2026-11/0123456789ab/${lote}/outro-a.pdf`), false);
  igual(RE_CAMINHO.test(`p12/2026-11/${lote}/sentenca-a.pdf`), false);
});
