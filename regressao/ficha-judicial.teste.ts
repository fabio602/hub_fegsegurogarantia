// Simula um cliente preenchendo o formulário do início ao fim (jsdom), com um
// servidor de mentira que usa as regras de verdade da Edge Function.
// Rodar: deno run -A --node-modules-dir=auto regressao/ficha-judicial.teste.ts

import { JSDOM } from "npm:jsdom";
import { lerFicha, lerArquivos } from "../supabase/functions/ficha-judicial/regras.ts";

const DIR = new URL("../sites/judicial/", import.meta.url).pathname;
const html = await Deno.readTextFile(DIR + "index.html");
const chamadas: Array<{ url: string; method: string; body: any }> = [];
let falharEnviarUmaVez = false;

function montar(storageInicial?: string) {
  const dom = new JSDOM(html.replace(/<script src=[^>]+><\/script>/g, ""), { runScripts: "outside-only", url: "https://judicial.fegsegurogarantia.com/", pretendToBeVisual: true });
  const w = dom.window as any;
  if (storageInicial) w.localStorage.setItem("fg-ficha-judicial-v1", storageInicial);
  w.fetch = async (url: string, opt: any = {}) => {
    const method = opt.method || "GET";
    const body = typeof opt.body === "string" ? JSON.parse(opt.body) : opt.body;
    chamadas.push({ url, method, body });
    const json = (o: unknown, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
    if (url.includes("brasilapi")) return json({ razao_social: "EMPRESA DA RECEITA LTDA", cep: "18550000", descricao_tipo_de_logradouro: "RUA", logradouro: "DAS ACACIAS", numero: "100", bairro: "CENTRO", municipio: "BOITUVA", uf: "SP" });
    if (url.includes("viacep")) return json({ logradouro: "Rua X", bairro: "Centro", localidade: "Boituva", uf: "SP" });
    if (url.includes("/storage/v1/object/upload/sign/")) return json({ Key: "ok" });
    if (url.includes("/functions/v1/ficha-judicial")) {
      // O servidor de mentira usa as regras de verdade do servidor.
      try {
        const f = lerFicha(body, "2026-11-24");
        if (body.acao === "preparar") {
          const arqs = lerArquivos(body.arquivos);
          return json({ success: true, lote: "3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d", bucket: "fichas-judiciais", arquivos: arqs.map((a) => ({ ...a, path: `2026-11/0123456789ab/3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d/${a.categoria}-x.pdf`, token: "tok" })) });
        }
        if (falharEnviarUmaVez) { falharEnviarUmaVez = false; return json({ success: false, error: "Erro interno." }, 500); }
        return json({ success: true, protocolo: "GJ-261124-1002", valor_garantia: f.valor_garantia, email: f.contato_email, email_enviado: true });
      } catch (e: any) { return json({ success: false, error: e.message, campo: e.campo }, e.status || 400); }
    }
    throw new Error("fetch inesperado: " + url);
  };
  w.eval(Deno.readTextFileSync(DIR + "regras.js"));
  w.eval(Deno.readTextFileSync(DIR + "app.js"));
  return w;
}
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function ok(c: unknown, msg: string) { if (!c) throw new Error("FALHOU: " + msg); console.log("ok  " + msg); }

let w = montar();
let d = w.document;
const $ = (s: string) => d.querySelector(s);
const texto = () => d.getElementById("conteudo").textContent;
const digitar = (key: string, valor: string) => { const i = d.getElementById("f-" + key); i.value = valor; i.dispatchEvent(new w.Event(i.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
const pilula = (key: string, rotulo: string) => { [...d.getElementById("f-" + key).children].find((b: any) => b.textContent === rotulo).click(); };
const botao = (rotulo: string) => [...d.querySelectorAll("#conteudo button")].find((b: any) => b.textContent === rotulo) as any;
const arquivo = (key: string, nome: string, tamanho: number) => { const i = d.getElementById("f-" + key); Object.defineProperty(i, "files", { value: [{ name: nome, size: tamanho }], configurable: true }); i.dispatchEvent(new w.Event("change", { bubbles: true })); };
const nota = (key: string) => d.getElementById("f-" + key + "-nota").textContent;

// Etapa 1
ok(texto().includes("Etapa 1 de 5") && texto().includes("Quem está preenchendo"), "abre na etapa 1");
ok(d.querySelectorAll("#etapas button").length === 5, "lateral com 5 etapas");
botao("Continuar").click();
ok(texto().includes("Faltam 10 itens nesta etapa"), "Continuar vazio mostra o total de pendências");
ok(d.activeElement.id === "f-nome", "foco vai para o primeiro campo com erro");
digitar("nome", "Marina Exemplo Duarte"); pilula("papel", "Advogado da causa");
digitar("email", "marina@exemplo"); ok(nota("email").includes("Confira o e-mail"), "e-mail incompleto é recusado");
digitar("email", "marina@exemplo.adv.br");
digitar("tel", "15999990000"); ok(d.getElementById("f-tel").value === "(15) 99999-0000", "máscara do celular");
digitar("cnpj", "11222333000182"); ok(nota("cnpj").includes("CNPJ inválido"), "CNPJ com dígito errado é recusado na hora");
digitar("cnpj", "11222333000181"); ok(d.getElementById("f-cnpj").value === "11.222.333/0001-81", "máscara do CNPJ");
await espera();
ok(d.getElementById("f-razao").value === "EMPRESA DA RECEITA LTDA" && d.getElementById("f-uf").value === "SP" && d.getElementById("f-cep").value === "18550-000", "CNPJ preenche razão social, CEP, endereço, cidade e UF");
ok(d.getElementById("f-endereco").value === "RUA DAS ACACIAS, 100, CENTRO", "endereço montado a partir do CNPJ");
// botão i
const bi = d.querySelector('[aria-controls="f-cnpj-ajuda"]') as any; bi.click();
ok(!d.getElementById("f-cnpj-ajuda").hasAttribute("hidden") && bi.getAttribute("aria-expanded") === "true", "botão i abre a explicação");
bi.click(); ok(d.getElementById("f-cnpj-ajuda").hasAttribute("hidden"), "botão i fecha a explicação");
botao("Continuar").click();
// Etapa 2
ok(texto().includes("Etapa 2 de 5"), "avança para a etapa 2");
digitar("numero", "00012342620265150111"); ok(nota("numero").includes("inválido"), "processo com dígito errado é recusado");
digitar("numero", "00012342520265150111"); ok(nota("numero").includes("TRT da 15ª Região"), "processo válido mostra o tribunal");
digitar("juizo", "Vara do Trabalho de Tietê"); digitar("valorCausa", "4800000"); ok(d.getElementById("f-valorCausa").value === "48.000,00", "máscara de valor");
digitar("dataDist", "2026-03-10"); digitar("recurso", "Recurso Ordinário"); pilula("caucao", "Nova garantia no processo");
digitar("recNome", "João Fictício da Silva"); digitar("recDoc", "52998224725");
botao("Continuar").click();
// Etapa 3
ok(texto().includes("Etapa 3 de 5") && d.getElementById("f-advNome").value === "Marina Exemplo Duarte", "etapa 3 já traz o nome do advogado quando é ele quem preenche");
digitar("objeto", "Horas extras."); digitar("historico", "Sentença de 02/11/2026.\nCondenação de R$ 30.000,00."); digitar("defesa", "Controle de jornada válido."); pilula("exito", "Possível");
digitar("oab", "123456"); digitar("oabUf", "SP");
botao("Continuar").click();
// Etapa 4
ok(texto().includes("Etapa 4 de 5"), "avança para a etapa 4");
digitar("valorBase", "2000000"); ok(nota("valorBase").includes("Acima do teto") && nota("valorBase").includes("14.411,57"), "valor acima do teto do TST gera aviso");
digitar("valorBase", "1300000"); ok(nota("valorBase").includes("Referência: teto"), "valor dentro do teto mostra só a referência");
ok(texto().includes("R$ 3.900,00") && texto().includes("R$ 16.900,00"), "conta dos 30% aparece na tela");
digitar("dataBase", "2026-11-02"); digitar("indice", "IPCA-E e SELIC"); digitar("objetivo", "Garantir o juízo.");
botao("Conferir a ficha").click();
ok(texto().includes("Faltam 2 itens"), "sem sentença e sem aceite não passa");
arquivo("docSentenca", "virus.exe", 100); ok(nota("docSentenca").includes("Use PDF"), "arquivo de tipo errado é recusado");
arquivo("docSentenca", "grande.pdf", 21 * 1024 * 1024); ok(nota("docSentenca").includes("20 MB"), "arquivo acima de 20 MB é recusado");
arquivo("docSentenca", "Sentença.pdf", 5000); ok(nota("docSentenca").includes("Anexado: Sentença.pdf"), "sentença anexada");
d.getElementById("aceite").click();
ok(JSON.parse(w.localStorage.getItem("fg-ficha-judicial-v1")).v.numero === "0001234-25.2026.5.15.0111", "rascunho salvo no aparelho");
botao("Conferir a ficha").click();
// Etapa 5
ok(texto().includes("Confira antes de enviar") && texto().includes("EMPRESA DA RECEITA LTDA") && texto().includes("R$ 16.900,00"), "tela de conferência com os dados");
chamadas.length = 0; falharEnviarUmaVez = true;
botao("Enviar ficha").click(); await espera(80);
ok(texto().includes("Não conseguimos concluir o envio"), "erro do servidor mostra mensagem e deixa tentar de novo");
const puts1 = chamadas.filter((c) => c.method === "PUT").length;
botao("Enviar ficha").click(); await espera(80);
ok(chamadas.filter((c) => c.method === "PUT").length === puts1 && chamadas.filter((c) => c.body?.acao === "preparar").length === 1, "nova tentativa reaproveita o envio, sem subir o arquivo de novo");
const env = chamadas.filter((c) => c.body?.acao === "enviar");
ok(env.length === 2 && env[0].body.lote === env[1].body.lote, "as duas tentativas usam o mesmo lote (servidor não duplica)");
ok(env[1].body.papel === "advogado" && env[1].body.caucao === "nova" && env[1].body.exito === "possivel" && env[1].body.valorBase === 13000 && env[1].body.valorCausa === 48000 && env[1].body.site === "", "dados chegam ao servidor no formato que ele espera");
ok(texto().includes("Recebemos a sua ficha") && texto().includes("GJ-261124-1002") && texto().includes("marina@exemplo.adv.br") && texto().includes("R$ 16.900,00"), "tela de confirmação com protocolo, e-mail e valor");
ok(texto().includes("Damos atenção imediata ao seu pedido e retornamos o mais breve possível."), "texto combinado na confirmação");
ok(w.localStorage.getItem("fg-ficha-judicial-v1") === null, "rascunho apagado depois do envio");
ok(!/sudaseg/i.test(d.documentElement.textContent), "nenhuma menção a seguradora");

// Rascunho recuperado em nova visita
w = montar(JSON.stringify({ v: { nome: "Carlos", email: "c@x.com" }, step: 0, aceite: false })); d = w.document;
ok(texto().includes("Recuperamos o que você já tinha preenchido") && d.getElementById("f-nome").value === "Carlos", "nova visita recupera o rascunho");
botao("Começar do zero").click();
ok(d.getElementById("f-nome").value === "" && !texto().includes("Recuperamos"), "Começar do zero limpa tudo");
console.log("\nTODOS OS TESTES PASSARAM");
