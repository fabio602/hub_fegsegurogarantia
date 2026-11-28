// Teste da leitura por regras do comprovante de PIX do repasse
// (lib/repasse/lerComprovantePix.ts). Roda com:
//   deno run regressao/comprovante-pix.teste.ts
//   node --experimental-strip-types regressao/comprovante-pix.teste.ts
import { lerComprovantePix, conferirComprovante } from '../lib/repasse/lerComprovantePix.ts';

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) !== JSON.stringify(esperado)) {
    falhas++;
    console.error(`FALHOU ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
  }
}

// 1) Sicoob, PDF só com imagem, texto vindo do OCR (comprovante real de 25/11/2026,
//    com os tropeços do OCR mantidos: "sicooB", "BCOC6", pontuação do CNPJ trocada).
const sicoob = `“sicooB

Comprovante de envio Pix

R$ 28,64

Transferido em 25/11/2026 às 15:18:42

0) Comprovante para simples
conferência gerado em
25/11/2026 às 15:18:44

Recebedor

Nome

F & G CORRETORA DE SEGUROS
LTDA

CPF/CNPJ
****3,.874/0001-**

Instituição
BCOC6 S.A.

Pagador

Nome
BORDIM E ZANOLLA IMOBILIARIA
LTDA

CPF/CNPJ
**,**3.414/0001-**

Instituição

CC COOPLIVRE

ID da Transação:
E493893072026112518180FvCCqkSI2u
`;
const l1 = lerComprovantePix(sicoob);
igual('sicoob valor', l1.valor, 28.64);
igual('sicoob data', l1.data, '2026-11-25');
igual('sicoob recebedor', l1.recebedor, 'F & G CORRETORA DE SEGUROS LTDA');
igual('sicoob pagador', l1.pagador, 'BORDIM E ZANOLLA IMOBILIARIA LTDA');
igual('sicoob id', l1.idTransacao, 'E493893072026112518180FvCCqkSI2u');
igual('sicoob confere', conferirComprovante(l1, { valor: 28.64, imobiliaria: 'Bordim e Zanolla' }),
  { valorConfere: true, pagadorConfere: true, recebedorConfere: true, confere: true });
igual('sicoob valor diferente', conferirComprovante(l1, { valor: 29.64, imobiliaria: 'Bordim e Zanolla' }).confere, false);
igual('sicoob outra imobiliaria', conferirComprovante(l1, { valor: 28.64, imobiliaria: 'Imobiliária Central' }).pagadorConfere, false);

// 2) Formato "Origem / Destino" com "Nome:" na mesma linha (texto de PDF).
const origemDestino = `Comprovante de transferência Pix
Valor: R$ 1.234,56
Data: 03/12/2026 10:02

Destino
Nome: F&G CORRETORA DE SEGUROS LTDA
CNPJ: 56.123.874/0001-90
Instituição: BANCO C6 S.A.

Origem
Nome: BORDIM E ZANOLLA IMOBILIARIA LTDA
CNPJ: **.***.414/0001-**

ID da transação: E00000000202612031302abcdEFGH123
`;
const l2 = lerComprovantePix(origemDestino);
igual('origem/destino valor', l2.valor, 1234.56);
igual('origem/destino data', l2.data, '2026-12-03');
igual('origem/destino recebedor', l2.recebedor, 'F&G CORRETORA DE SEGUROS LTDA');
igual('origem/destino pagador', l2.pagador, 'BORDIM E ZANOLLA IMOBILIARIA LTDA');
igual('origem/destino confere', conferirComprovante(l2, { valor: 1234.56, imobiliaria: 'Bordim e Zanolla' }).confere, true);

// 3) Recebedor errado (PIX para outra empresa): não confere.
const outro = origemDestino.replace('F&G CORRETORA DE SEGUROS LTDA', 'OUTRA EMPRESA LTDA');
igual('recebedor errado', conferirComprovante(lerComprovantePix(outro), { valor: 1234.56, imobiliaria: 'Bordim e Zanolla' }).recebedorConfere, false);

// 4) Texto que não é comprovante: tudo null, nada inventado, e não confere.
const l4 = lerComprovantePix('foto borrada sem nada legível');
igual('ilegível', l4, { valor: null, data: null, pagador: null, recebedor: null, idTransacao: null });
igual('ilegível não confere', conferirComprovante(l4, { valor: 10, imobiliaria: 'X' }),
  { valorConfere: null, pagadorConfere: null, recebedorConfere: null, confere: false });

if (falhas) { console.error(`${falhas} falha(s)`); throw new Error('comprovante-pix: falhou'); }
console.log('comprovante-pix: 100%');
