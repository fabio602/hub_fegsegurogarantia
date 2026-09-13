#!/usr/bin/env python3
"""
Radar · Fase 2 · worker do PJe TRF3 (dossiê judicial).

Processo de longa duração que pega empresas da fila radar_pje_fila, consulta
a consulta pública do PJe TRF3 1º grau com um Chrome real (Playwright,
perfil persistente), grava execuções fiscais (1116) e embargos (1118) em
radar_processos, com advogados e as 15 movimentações mais recentes, e
consolida o dossiê da empresa.

Regras de ritmo (Akamai): toda navegação é feita clicando, como um humano,
com pausas entre requisições e entre empresas. Nunca usa fetch/XHR direto.
Se aparecer "Access Denied", a empresa vai para 'bloqueado', o worker dorme
60 minutos e tenta a mesma empresa de novo; no terceiro bloqueio do dia,
para até a próxima janela.

Uso (na raiz do repo, com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env):

    .venv/bin/python scripts/radar/pje_worker.py                 # fila, janela 07h-23h
    .venv/bin/python scripts/radar/pje_worker.py --headless      # sem janela
    .venv/bin/python scripts/radar/pje_worker.py --cnpj 56199714000710   # só essa empresa
    .venv/bin/python scripts/radar/pje_worker.py --cnpj ... --debug      # salva HTML/texto em data/radar/debug
    .venv/bin/python scripts/radar/pje_worker.py --cnpj ... --detalhes 30  # abre o detalhe de todos os processos

Especificação: docs/radar/RADAR-FASE2.md.
"""

from __future__ import annotations

import argparse
import os
import random
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from playwright.sync_api import Page, BrowserContext, TimeoutError as PwTimeout, sync_playwright

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

JANELA_INICIO_H = 7            # só trabalha entre 07:00 e 23:00 (hora local)
JANELA_FIM_H = 23
INTERVALO_ENTRE_EMPRESAS_S = 5 * 60
JITTER_EMPRESAS_S = 60
INTERVALO_ENTRE_REQUISICOES_S = 20
JITTER_REQUISICOES_S = 8
MAX_DETALHES_POR_EMPRESA = 8
TETO_DIARIO = 60
BLOQUEIO_ESPERA_S = 60 * 60
BLOQUEIOS_MAX_DIA = 3
MAX_TENTATIVAS_EMPRESA = 3
DATA_AUTUACAO_DE = "01/01/2021"
ANO_INICIAL = 2021
# sem nada desde 2021, a busca é repetida sem filtro de data; acima de 30
# resultados, quebra por ano a partir daqui
ANO_INICIAL_SEM_FILTRO = 2010

RAIZ = Path(__file__).resolve().parents[2]
PASTA_DADOS = RAIZ / "data" / "radar"
PERFIL_NAVEGADOR = PASTA_DADOS / "pje-profile"
ARQUIVO_LOG = PASTA_DADOS / "pje_worker.log"
PASTA_DEBUG = PASTA_DADOS / "debug"

URL_CONSULTA = "https://pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam"
VIEWPORT = {"width": 1366, "height": 800}
LOCALE = "pt-BR"
FUSO = "America/Sao_Paulo"
TZ = ZoneInfo(FUSO)

CLASSES = {"EXECUCAO FISCAL": (1116, "EXECUÇÃO FISCAL"),
           "EMBARGOS A EXECUCAO FISCAL": (1118, "EMBARGOS À EXECUÇÃO FISCAL")}
PAPEIS_EXECUTADO = {"EXECUTADO", "EMBARGANTE", "EXECUTADA"}
SUFIXOS = {"LTDA", "SA", "S A", "EIRELI", "ME", "EPP", "LIMITADA"}

RE_CNJ = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
RE_DATA = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
RE_MOV = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})\s*-\s*(.+)$")
RE_AVISO_30 = re.compile(r"somente os 30 primeiros", re.I)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def agora() -> datetime:
    return datetime.now(TZ)


def log(msg: str) -> None:
    linha = f"[{agora().strftime('%d/%m/%Y %H:%M:%S')}] {msg}"
    print(linha, flush=True)
    try:
        PASTA_DADOS.mkdir(parents=True, exist_ok=True)
        with ARQUIVO_LOG.open("a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def sem_acento(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()


def pausa(base: float, jitter: float, motivo: str) -> None:
    t = max(1.0, base + random.uniform(-jitter, jitter))
    log(f"   pausa {t:.0f}s ({motivo})")
    time.sleep(t)


def pausa_requisicao(motivo: str) -> None:
    pausa(INTERVALO_ENTRE_REQUISICOES_S, JITTER_REQUISICOES_S, motivo)


def data_br_para_iso(d: str | None) -> str | None:
    """'07/06/2023' -> '2023-06-07'."""
    if not d:
        return None
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", d)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def datahora_br_para_iso(d: str, h: str) -> str:
    """'07/06/2023', '14:03:11' -> ISO com fuso de Brasília."""
    dt = datetime.strptime(f"{d} {h}", "%d/%m/%Y %H:%M:%S").replace(tzinfo=TZ)
    return dt.isoformat()


def nomes_de_busca(razao_social: str | None, nome_devedor: str) -> list[str]:
    """Nomes a tentar, em ordem. A busca por "Nome da parte" do PJe TRF3 é por
    nome exato (verificado em 13/09/2026: sem o "LTDA" a Convenção devolve zero),
    então o primeiro candidato é a razão social como está; depois o nome da PGFN;
    por último a forma sem pontuação e sem sufixo, prevista na especificação."""
    candidatos: list[str] = []

    def add(n: str | None) -> None:
        n = re.sub(r"\s+", " ", (n or "")).strip()
        if n and n.upper() not in [c.upper() for c in candidatos]:
            candidatos.append(n)

    for n in (razao_social, nome_devedor):
        add(n)
        # "LTDA." vs "LTDA": o ponto final muda o resultado numa busca exata
        add(re.sub(r"[.\s]+$", "", n or ""))
        # sem o apóstrofo (LARRU'S -> LARRUS) e com apóstrofo curvo
        add(re.sub(r"[.\s]+$", "", (n or "").replace("'", "")))
    add(nome_de_busca(razao_social, nome_devedor))
    return candidatos


def nome_de_busca(razao_social: str | None, nome_devedor: str) -> str:
    """Remove pontuação e sufixos societários no fim para a busca ficar tolerante."""
    nome = (razao_social or nome_devedor or "").strip()
    # apóstrofo fica (LARRU'S); o resto da pontuação vira espaço
    limpo = re.sub(r"[^\w\s']", " ", nome, flags=re.UNICODE)
    limpo = re.sub(r"\s+", " ", limpo).strip()
    palavras = limpo.split(" ")
    if len(palavras) < 2:
        return limpo or nome
    while len(palavras) > 1:
        if palavras[-1].upper() in SUFIXOS:
            palavras.pop()
        elif len(palavras) > 2 and " ".join(palavras[-2:]).upper() in SUFIXOS:
            palavras = palavras[:-2]
        else:
            break
    return " ".join(palavras)


def classe_da_linha(texto: str) -> tuple[int, str] | None:
    t = sem_acento(texto)
    if "EMBARGOS A EXECUCAO FISCAL" in t:
        return CLASSES["EMBARGOS A EXECUCAO FISCAL"]
    if "EXECUCAO FISCAL" in t:
        return CLASSES["EXECUCAO FISCAL"]
    return None


def chave_recencia(numero_cnj: str) -> tuple[int, int]:
    """Ano de autuação e sequencial, tirados do próprio número CNJ (NNNNNNN-DD.AAAA...)."""
    m = re.match(r"(\d{7})-\d{2}\.(\d{4})", numero_cnj)
    return (int(m.group(2)), int(m.group(1))) if m else (0, 0)


class Bloqueado(Exception):
    """Akamai respondeu Access Denied."""


class SemFila(Exception):
    pass


# ---------------------------------------------------------------------------
# Supabase (REST, service role)
# ---------------------------------------------------------------------------

class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.sess = requests.Session()
        self.sess.headers.update({"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})

    ESPERAS_S = (5, 15, 30)

    def _req(self, metodo: str, caminho: str, ctx: str, **kw) -> requests.Response:
        """Requisição com 3 novas tentativas em 5xx, 429, timeout ou erro de rede
        (o PostgREST do plano Free devolve 504 de vez em quando)."""
        kw.setdefault("timeout", 60)
        ultimo = None
        for i, espera in enumerate((*self.ESPERAS_S, None)):
            try:
                r = self.sess.request(metodo, f"{self.base}/{caminho}", **kw)
            except requests.RequestException as e:
                ultimo = f"{ctx}: rede: {str(e)[:200]}"
            else:
                if r.status_code < 300:
                    return r
                ultimo = f"{ctx}: HTTP {r.status_code} {r.text[:300]}"
                if r.status_code < 500 and r.status_code != 429:
                    break
            if espera is None:
                break
            log(f"   supabase: {ultimo}; nova tentativa em {espera}s")
            time.sleep(espera)
        raise RuntimeError(ultimo)

    def get(self, tabela: str, **params) -> list[dict]:
        return self._req("GET", tabela, f"get {tabela}", params=params).json()

    def patch(self, tabela: str, filtros: dict, campos: dict) -> None:
        self._req("PATCH", tabela, f"patch {tabela}", params=filtros, json=campos, headers={"Prefer": "return=minimal"})

    def insert(self, tabela: str, linhas: list[dict] | dict) -> list[dict]:
        return self._req("POST", tabela, f"insert {tabela}", json=linhas, headers={"Prefer": "return=representation"}).json()

    def upsert(self, tabela: str, linhas: list[dict] | dict, on_conflict: str) -> list[dict]:
        if not linhas:
            return []
        return self._req("POST", tabela, f"upsert {tabela}", params={"on_conflict": on_conflict}, json=linhas,
                         headers={"Prefer": "resolution=merge-duplicates,return=representation"}).json()

    def delete(self, tabela: str, filtros: dict) -> None:
        self._req("DELETE", tabela, f"delete {tabela}", params=filtros, headers={"Prefer": "return=minimal"})

    def rpc(self, funcao: str, args: dict) -> None:
        self._req("POST", f"rpc/{funcao}", f"rpc {funcao}", json=args)

    # --- fila ---------------------------------------------------------------

    def proxima_da_fila(self) -> dict | None:
        linhas = self.get("radar_pje_fila", select="id,cnpj,prioridade,tentativas", status="eq.pendente",
                          order="prioridade.desc,criado_em.asc", limit=1)
        if not linhas:
            return None
        fila = linhas[0]
        self.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"},
                   {"status": "processando", "iniciado_em": agora().isoformat(), "erro": None})
        return fila

    def fila_da_empresa(self, cnpj: str) -> dict | None:
        linhas = self.get("radar_pje_fila", select="id,cnpj,prioridade,tentativas,status", cnpj=f"eq.{cnpj}", limit=1)
        return linhas[0] if linhas else None

    def concluidas_hoje(self) -> int:
        inicio_dia = agora().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        r = self._req("GET", "radar_pje_fila", "contagem do dia",
                      params={"select": "id", "finalizado_em": f"gte.{inicio_dia}", "limit": 1},
                      headers={"Prefer": "count=exact"})
        return int((r.headers.get("content-range") or "*/0").split("/")[-1] or 0)

    def empresa(self, cnpj: str) -> dict | None:
        linhas = self.get("radar_empresas", select="cnpj,nome_devedor,razao_social,dossie_status", cnpj=f"eq.{cnpj}", limit=1)
        return linhas[0] if linhas else None


# ---------------------------------------------------------------------------
# Navegador
# ---------------------------------------------------------------------------

def verificar_bloqueio(page: Page) -> None:
    try:
        titulo = page.title() or ""
        corpo = page.content() or ""
    except Exception:
        return
    if "access denied" in titulo.lower() or "edgesuite.net" in corpo.lower():
        raise Bloqueado(f"Access Denied em {page.url}")


def salvar_debug(nome: str, conteudo: str) -> None:
    try:
        PASTA_DEBUG.mkdir(parents=True, exist_ok=True)
        (PASTA_DEBUG / nome).write_text(conteudo, encoding="utf-8")
    except OSError:
        pass


class ConsultaPje:
    """Uma sessão de consulta pública para uma empresa."""

    def __init__(self, page: Page, debug: bool = False):
        self.page = page
        self.debug = debug

    # --- formulário ---------------------------------------------------------

    def abrir(self) -> None:
        pausa_requisicao("abrir consulta")
        self.page.goto(URL_CONSULTA, wait_until="domcontentloaded", timeout=90_000)
        self.page.wait_for_load_state("networkidle", timeout=60_000)
        verificar_bloqueio(self.page)
        self.page.wait_for_selector('input[type="text"]', state="visible", timeout=30_000)
        if self.debug:
            salvar_debug("formulario.html", self.page.content())

    def _id_input(self, padrao: str, indice: int = 0) -> str | None:
        return self.page.evaluate(
            """([padrao, indice]) => {
                const re = new RegExp(padrao, 'i');
                const els = Array.from(document.querySelectorAll('input')).filter(i => re.test(i.id || '') || re.test(i.name || ''));
                return els[indice] ? els[indice].id : null;
            }""", [padrao, indice])

    def _preencher_por_valor(self, id_input: str, valor: str) -> None:
        """Preenche via valor do input (máscara de data não aceita tecla a tecla)."""
        self.page.evaluate(
            """([id, valor]) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.focus();
                el.value = valor;
                for (const t of ['input', 'change', 'keyup', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
            }""", [id_input, valor])
        atual = self.page.evaluate("id => (document.getElementById(id) || {}).value || ''", id_input)
        if atual != valor:
            self.page.locator(f'[id="{id_input}"]').fill(valor)

    def preencher(self, criterio: tuple[str, str], data_de: str | None, data_ate: str | None = None) -> None:
        """criterio = ('cnpj', 14 dígitos) ou ('nome', nome exato da parte).
        data_de None = sem filtro de data (os campos ficam em branco)."""
        tipo, valor = criterio
        if tipo == "cnpj":
            # radio CNPJ (o segundo de tipoMascaraDocumento) e o campo documentoParte;
            # a máscara é aplicada pelo próprio formulário, então vão só os dígitos, tecla a tecla
            radios = self.page.locator('input[name="tipoMascaraDocumento"]')
            if radios.count() < 2:
                raise RuntimeError("radio de CNPJ não encontrado")
            radios.nth(1).click()
            self.page.wait_for_timeout(500)
            campo = self.page.locator('[id="fPP:dpDec:documentoParte"]')
            campo.click()
            campo.fill("")
            self.page.keyboard.type(re.sub(r"\D", "", valor), delay=40)
        else:
            id_nome = self._id_input("nomeParte")
            if id_nome:
                campo = self.page.locator(f'[id="{id_nome}"]')
            else:
                campo = self.page.get_by_label(re.compile("Nome da parte", re.I))
            campo.fill("")
            campo.fill(valor)

        # Só os inputs visíveis do calendário (InputDate). O hidden InputCurrentDate
        # ("mm/aaaa" do calendário) não pode ser mexido: zerá-lo faz o servidor
        # ignorar o formulário inteiro e devolver milhões de resultados.
        id_de = self._id_input("autuacaoInicioInputDate$")
        id_ate = self._id_input("autuacaoFimInputDate$")
        if not id_de:
            raise RuntimeError("campo Data de Autuação não encontrado")
        if data_de:
            self._preencher_por_valor(id_de, data_de)
        if data_ate:
            if not id_ate:
                raise RuntimeError("campo Data de Autuação (até) não encontrado")
            self._preencher_por_valor(id_ate, data_ate)
        self.page.keyboard.press("Tab")

    def pesquisar(self) -> int | None:
        """Clica em Pesquisar, espera o ajax terminar e devolve o total do rodapé."""
        pausa_requisicao("pesquisar")
        botao = self.page.locator('[id="fPP:searchProcessos"]')
        if botao.count() == 0:
            botao = self.page.get_by_role("button", name=re.compile("PESQUISAR", re.I))
        try:
            with self.page.expect_response(lambda r: "listView.seam" in r.url and r.request.method == "POST", timeout=90_000):
                botao.first.click()
        except PwTimeout:
            log("   aviso: resposta da pesquisa não observada em 90 s; seguindo pelo estado da página")
        self._esperar_resultado()
        verificar_bloqueio(self.page)
        if self.debug:
            salvar_debug(f"listagem_{agora().strftime('%H%M%S')}.html", self.page.content())
        total = self.total_resultados()
        if total is not None and total > 500:
            # a consulta sem critério devolve milhões de linhas: sinal de que o formulário não foi aplicado
            raise RuntimeError(f"pesquisa devolveu {total} resultados: critério não aplicado")
        return total

    def _esperar_resultado(self) -> None:
        """Espera o indicador de ajax do a4j sumir e a tabela ser re-renderizada."""
        try:
            self.page.wait_for_function(
                """() => { const s = document.getElementById('_viewRoot:status.start');
                          return !s || s.style.display === 'none' || s.offsetParent === null; }""",
                timeout=60_000)
        except PwTimeout:
            pass
        time.sleep(2)

    def total_resultados(self) -> int | None:
        m = re.search(r"(\d+)\s+resultados? encontrados?", self.page.locator("body").inner_text())
        return int(m.group(1)) if m else None

    # --- listagem -----------------------------------------------------------

    def aviso_30(self) -> bool:
        return bool(RE_AVISO_30.search(self.page.locator("body").inner_text()))

    def linhas(self) -> list[dict]:
        """Uma entrada por processo da listagem (célula 2: classe / número - assunto / partes;
        célula 3: última movimentação com data e hora entre parênteses)."""
        brutas = self.page.evaluate(
            """() => Array.from(document.querySelectorAll('[id="fPP:processosTable"] tbody tr')).map(tr => {
                const a = tr.querySelector('a[onclick*="openPopUp"]');
                const onclick = a ? (a.getAttribute('onclick') || '') : '';
                const m = onclick.match(/ca=([^'"&)]+)/);
                return {
                    token: m ? m[1] : null,
                    cells: Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()),
                };
            })""")
        saida, vistos = [], set()
        for b in brutas:
            cells = b["cells"]
            if len(cells) < 2:
                continue
            principal = cells[1]
            m = RE_CNJ.search(principal)
            if not m:
                continue
            numero = m.group(0)
            if numero in vistos:
                continue
            classe = classe_da_linha(principal.split("\n")[0])
            if not classe:
                continue
            vistos.add(numero)
            linhas_cel = [l.strip() for l in principal.split("\n") if l.strip()]
            assunto, partes = None, None
            for l in linhas_cel:
                if numero in l:
                    assunto = l.split(numero, 1)[1].strip(" -") or None
                elif " X " in l.upper():
                    partes = l
            ultima_texto, ultima_data, ultima_hora = None, None, None
            if len(cells) >= 3 and cells[2]:
                mm = re.search(r"\((\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})\)\s*$", cells[2])
                if mm:
                    ultima_data, ultima_hora = mm.group(1), mm.group(2)
                    ultima_texto = cells[2][:mm.start()].strip() or None
                else:
                    ultima_texto = cells[2].strip() or None
                    d = RE_DATA.search(cells[2])
                    ultima_data = d.group(1) if d else None
            saida.append({
                "numero_cnj": numero, "classe_codigo": classe[0], "classe_nome": classe[1],
                "assunto": assunto, "partes": partes, "token": b["token"],
                "ultima_movimentacao_texto": ultima_texto, "ultima_movimentacao_data": ultima_data,
                "ultima_movimentacao_hora": ultima_hora,
            })
        return saida

    # --- detalhe ------------------------------------------------------------

    def abrir_detalhe(self, token: str, numero: str) -> str:
        """Clica em Ver Detalhes, captura o popup e devolve o texto da página."""
        pausa_requisicao(f"detalhe {numero}")
        link = self.page.locator(f'a[onclick*="{token}"]').first
        with self.page.expect_popup(timeout=60_000) as info:
            link.click()
        popup = info.value
        try:
            popup.wait_for_load_state("domcontentloaded", timeout=60_000)
            try:
                popup.wait_for_load_state("networkidle", timeout=30_000)
            except PwTimeout:
                pass
            verificar_bloqueio(popup)
            # espera o corpo ter as movimentações (ou pelo menos o número do processo)
            limite = time.time() + 30
            texto = ""
            while time.time() < limite:
                texto = popup.locator("body").inner_text()
                if "Movimenta" in texto or "Documentos" in texto:
                    break
                time.sleep(1)
            if self.debug:
                salvar_debug(f"detalhe_{numero}.html", popup.content())
                salvar_debug(f"detalhe_{numero}.txt", texto)
            return texto
        finally:
            try:
                popup.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Parse da página de detalhe (texto)
# ---------------------------------------------------------------------------

ROTULOS = ["Número Processo", "Data da Distribuição", "Classe Judicial", "Assunto", "Jurisdição",
           "Órgão Julgador", "Polo ativo", "Polo Passivo", "Movimentações do Processo", "Documentos juntados"]


def _linhas(texto: str) -> list[str]:
    return [re.sub(r"\s+", " ", l).strip() for l in texto.splitlines()]


def _movimentos(texto: str) -> list[dict]:
    """Linhas "dd/mm/aaaa hh:mm:ss - texto" da seção Movimentações. A coluna
    Documento vem como linha indentada por tabulação logo abaixo do movimento
    e não é movimento: fica de fora."""
    dentro, saida = False, []
    for bruta in texto.splitlines():
        l = re.sub(r"[ \t]+", " ", bruta).strip()
        la = sem_acento(l)
        if not dentro:
            if la.startswith("MOVIMENTACOES"):
                dentro = True
            continue
        if la.startswith("DOCUMENTOS JUNTADOS"):
            break
        if bruta.startswith("\t"):
            continue
        m = RE_MOV.match(l)
        if m:
            saida.append({"ocorrido_em": datahora_br_para_iso(m.group(1), m.group(2)), "texto": m.group(3).strip()})
    return saida


def campo(linhas: list[str], rotulo: str) -> str | None:
    """Valor de um rótulo: na mesma linha após ':' ou na linha seguinte não vazia."""
    r = sem_acento(rotulo)
    for i, l in enumerate(linhas):
        la = sem_acento(l)
        if la.startswith(r):
            resto = l[len(rotulo):].strip(" :") if la.startswith(r) else ""
            if resto:
                return resto
            for j in range(i + 1, min(i + 4, len(linhas))):
                if linhas[j] and not any(sem_acento(linhas[j]).startswith(sem_acento(x)) for x in ROTULOS):
                    return linhas[j]
            return None
    return None


def secao(linhas: list[str], inicio: str, fins: list[str]) -> list[str]:
    ini = sem_acento(inicio)
    fins_a = [sem_acento(f) for f in fins]
    dentro, saida = False, []
    for l in linhas:
        la = sem_acento(l)
        if not dentro:
            if la.startswith(ini):
                dentro = True
            continue
        if any(la.startswith(f) for f in fins_a):
            break
        if l:
            saida.append(l)
    return saida


def participantes(linhas: list[str]) -> list[dict]:
    saida = []
    for l in linhas:
        papel = re.search(r"\(([A-ZÇÃÕÉÁÍÓÚ ]+)\)\s*$", l)
        if not papel:
            continue
        nome = re.split(r"\s+-\s+(?=(?:OAB|CNPJ|CPF)\b)", l, maxsplit=1)[0].strip()
        oab = re.search(r"OAB\s*([A-Z]{2})\s?(\d+)", l)
        doc = re.search(r"(CNPJ|CPF):\s*([\d.\-/X*]+)", l, re.I)
        saida.append({
            "nome": nome, "papel": sem_acento(papel.group(1)).strip(),
            "oab": f"{oab.group(1)}{oab.group(2)}" if oab else None,
            "doc_tipo": doc.group(1).upper() if doc else None,
            "doc": doc.group(2) if doc else None,
        })
    return saida


def parse_detalhe(texto: str) -> dict:
    linhas = _linhas(texto)
    classe_txt = campo(linhas, "Classe Judicial") or ""
    cod = re.search(r"\((\d{4})\)", classe_txt)
    passivo = participantes(secao(linhas, "Polo Passivo", ["Movimentações", "Documentos", "Polo ativo"]))
    ativo = participantes(secao(linhas, "Polo ativo", ["Polo Passivo", "Movimentações", "Documentos"]))
    movs = _movimentos(texto)
    # total de movimentações: paginador ("de N", "N resultados") se existir
    total = None
    bloco = " ".join(secao(linhas, "Movimentações", ["Documentos juntados"]))
    for pad in (r"\bde\s+(\d+)\s*(?:resultados?|registros?|movimenta)", r"(\d+)\s+(?:resultados?|registros?|movimenta[cç][oõ]es)\b", r"\b(\d+)\s*/\s*(\d+)\b"):
        m = re.search(pad, bloco, re.I)
        if m:
            total = int(m.group(m.lastindex))
            break
    # Nos embargos a empresa é EMBARGANTE e fica no "Polo ativo" da página.
    # O worker guarda os lados em relação à empresa: 'passivo' = lado do
    # executado (empresa e seus advogados), 'ativo' = lado da Fazenda.
    lado_empresa, lado_fazenda = passivo, ativo
    if not any(p["papel"] in PAPEIS_EXECUTADO for p in passivo) and any(p["papel"] in PAPEIS_EXECUTADO for p in ativo):
        lado_empresa, lado_fazenda = ativo, passivo
    passivo, ativo = lado_empresa, lado_fazenda
    executado = next((p for p in passivo if p["papel"] in PAPEIS_EXECUTADO), None) or (passivo[0] if passivo else None)
    m_num = RE_CNJ.search(campo(linhas, "Número Processo") or "") or RE_CNJ.search(texto)
    m_dist = RE_DATA.search(campo(linhas, "Data da Distribuição") or "")
    return {
        "numero_cnj": m_num.group(0) if m_num else None,
        "data_distribuicao": data_br_para_iso(m_dist.group(1)) if m_dist else None,
        "classe_codigo": int(cod.group(1)) if cod else None,
        "classe_nome": re.sub(r"\s*\(\d{4}\)\s*$", "", classe_txt).strip() or None,
        "assunto": campo(linhas, "Assunto"),
        "jurisdicao": campo(linhas, "Jurisdição"),
        "orgao_julgador": campo(linhas, "Órgão Julgador"),
        "polo_passivo_nome": executado["nome"] if executado else None,
        "cnpj_mascarado": executado["doc"] if executado and executado["doc_tipo"] == "CNPJ" else None,
        "passivo": passivo, "ativo": ativo, "movimentos": movs,
        "qtd_movimentacoes": total if total is not None else (len(movs) or None),
    }


def cnpj_confere(cnpj: str, parsed: dict) -> bool | None:
    """True se algum EXECUTADO/EMBARGANTE com CNPJ bate nos 3 primeiros dígitos;
    False se há CNPJ e nenhum bate; None se não dá para conferir."""
    prefixo = re.sub(r"\D", "", cnpj)[:3]
    docs = [re.sub(r"\D", "", p["doc"] or "")[:3] for p in parsed["passivo"]
            if p["papel"] in PAPEIS_EXECUTADO and p["doc_tipo"] == "CNPJ" and p["doc"]]
    docs = [d for d in docs if len(d) == 3]
    if not docs:
        return None
    return prefixo in docs


# ---------------------------------------------------------------------------
# Fluxo por empresa
# ---------------------------------------------------------------------------

def gravar_listagem(sb: Supabase, cnpj: str, linhas: list[dict]) -> dict[str, int]:
    """Upsert por numero_cnj só com os dados da listagem. Devolve numero -> id."""
    registros = []
    for l in linhas:
        reg = {
            "cnpj": cnpj, "numero_cnj": l["numero_cnj"], "classe_codigo": l["classe_codigo"],
            "classe_nome": l["classe_nome"], "assunto": l["assunto"],
            "ultima_movimentacao_texto": l["ultima_movimentacao_texto"], "capturado_em": agora().isoformat(),
        }
        if l["ultima_movimentacao_data"]:
            reg["ultima_movimentacao_em"] = datahora_br_para_iso(l["ultima_movimentacao_data"], l.get("ultima_movimentacao_hora") or "00:00:00")
        if l.get("partes"):
            partes = re.split(r"\s+X\s+", l["partes"], maxsplit=1)
            if len(partes) == 2:
                # execução fiscal: União X empresa (empresa é o polo passivo);
                # embargos: empresa X União (a empresa embargante está no polo ativo, mas é o executado)
                reg["polo_passivo_nome"] = (partes[1] if l["classe_codigo"] == 1116 else partes[0]).strip()
        registros.append(reg)
    ids = {}
    for i in range(0, len(registros), 50):
        for r in sb.upsert("radar_processos", registros[i:i + 50], on_conflict="numero_cnj"):
            ids[r["numero_cnj"]] = r["id"]
    return ids


def gravar_detalhe(sb: Supabase, processo_id: int, parsed: dict) -> None:
    campos = {k: parsed[k] for k in ("data_distribuicao", "classe_codigo", "classe_nome", "assunto", "jurisdicao",
                                      "orgao_julgador", "polo_passivo_nome", "cnpj_mascarado", "qtd_movimentacoes")
              if parsed.get(k) is not None}
    if parsed["movimentos"]:
        campos["ultima_movimentacao_em"] = parsed["movimentos"][0]["ocorrido_em"]
        campos["ultima_movimentacao_texto"] = parsed["movimentos"][0]["texto"]
    campos["capturado_em"] = agora().isoformat()
    sb.patch("radar_processos", {"id": f"eq.{processo_id}"}, campos)

    advs = {}
    for polo, lista in (("passivo", parsed["passivo"]), ("ativo", parsed["ativo"])):
        for p in lista:
            if p["papel"] == "ADVOGADO" or p["oab"]:
                advs[(p["nome"], p["oab"])] = {"processo_id": processo_id, "nome": p["nome"], "oab": p["oab"], "polo": polo}
    sb.delete("radar_processo_advogados", {"processo_id": f"eq.{processo_id}"})
    if advs:
        sb.insert("radar_processo_advogados", list(advs.values()))

    sb.delete("radar_processo_movimentos", {"processo_id": f"eq.{processo_id}"})
    vistos, movs = set(), []
    for m in parsed["movimentos"][:15]:
        k = (m["ocorrido_em"], m["texto"])
        if k in vistos:
            continue
        vistos.add(k)
        movs.append({"processo_id": processo_id, **m})
    if movs:
        sb.insert("radar_processo_movimentos", movs)


def processar_empresa(sb: Supabase, context: BrowserContext, emp: dict, debug: bool = False,
                      max_detalhes: int = MAX_DETALHES_POR_EMPRESA) -> dict:
    """Consulta o PJe para uma empresa e grava tudo. Levanta Bloqueado se o Akamai barrar."""
    cnpj = emp["cnpj"]
    candidatos = nomes_de_busca(emp.get("razao_social"), emp["nome_devedor"])
    inicio = time.time()
    page = context.pages[0] if context.pages else context.new_page()
    consulta = ConsultaPje(page, debug=debug)

    log(f"-> {cnpj} {emp.get('razao_social') or emp['nome_devedor']}")
    encontrados: dict[str, dict] = {}

    busca_atual: list = [None]  # (crit, de, ate) da listagem que está na tela

    def buscar(crit: tuple[str, str], de: str | None, ate: str | None = None) -> tuple[int, list[dict]]:
        periodo = f"{de or 'sem data'}{(' a ' + ate) if ate else ''}"
        log(f"   busca por {crit[0]}: \"{crit[1]}\" ({periodo})")
        consulta.abrir()
        consulta.preencher(crit, de, ate)
        total = consulta.pesquisar() or 0
        brutas = consulta.linhas()
        busca_atual[0] = (crit, de, ate)
        for b in brutas:
            b["busca"] = (crit, de, ate)
        log(f"   {total} resultados, {len(brutas)} das classes 1116/1118")
        return total, brutas

    def guardar(brutas: list[dict]) -> None:
        for l in brutas:
            encontrados[l["numero_cnj"]] = l

    def acima_de_30(total: int) -> bool:
        return consulta.aviso_30() or total > 30

    def por_ano(crit: tuple[str, str], ano_inicial: int) -> None:
        log(f"   mais de 30 resultados: repetindo por ano de {ano_inicial} a {agora().year}")
        for ano in range(ano_inicial, agora().year + 1):
            _, brutas = buscar(crit, f"01/01/{ano}", f"31/12/{ano}")
            guardar(brutas)
            if consulta.aviso_30():
                log(f"   ano {ano} ainda com mais de 30 resultados; ficam os 30 primeiros")

    def desde_2021_e_sem_data(crit: tuple[str, str]) -> int:
        """Busca desde 2021; sem linha das classes, repete sem data. Devolve o maior total visto."""
        total, brutas = buscar(crit, DATA_AUTUACAO_DE)
        if brutas:
            guardar(brutas)
            if acima_de_30(total):
                por_ano(crit, ANO_INICIAL)
            return total
        log("   nenhum processo 1116/1118 desde 2021: repetindo sem filtro de data")
        total2, brutas = buscar(crit, None)
        guardar(brutas)
        if brutas and acima_de_30(total2):
            por_ano(crit, ANO_INICIAL_SEM_FILTRO)
        return max(total, total2)

    # 1) busca principal pelo CNPJ (decisão 66)
    total_cnpj = desde_2021_e_sem_data(("cnpj", cnpj))

    # 2) fallback pelo nome exato, só se o CNPJ não devolveu nada (de classe nenhuma)
    if total_cnpj == 0 and not encontrados:
        log("   CNPJ sem resultado no PJe: tentando pelo nome")
        for nome in candidatos:
            total_nome = desde_2021_e_sem_data(("nome", nome))
            if total_nome or encontrados:
                break

    linhas = list(encontrados.values())
    log(f"   listagem: {len(linhas)} processos das classes 1116/1118")
    ids = gravar_listagem(sb, cnpj, linhas) if linhas else {}

    detalhes, homonimos = 0, 0
    if linhas:
        # os N mais recentes, agrupados pela busca que os listou para refazer
        # cada listagem uma vez só (a quebra por ano deixa só o último ano na tela)
        escolhidos = sorted(linhas, key=lambda l: chave_recencia(l["numero_cnj"]), reverse=True)[:max_detalhes]
        escolhidos.sort(key=lambda l: (str(l.get("busca")), -chave_recencia(l["numero_cnj"])[0], -chave_recencia(l["numero_cnj"])[1]))
        for l in escolhidos:
            if not l["token"]:
                continue
            if l.get("busca") != busca_atual[0] or page.locator(f'a[onclick*="{l["token"]}"]').count() == 0:
                crit, de, ate = l["busca"]
                _, brutas = buscar(crit, de, ate)
                novo = next((b["token"] for b in brutas if b["numero_cnj"] == l["numero_cnj"]), None)
                if not novo:
                    log(f"   {l['numero_cnj']}: não reapareceu na listagem, pulando o detalhe")
                    continue
                l["token"] = novo
            texto = consulta.abrir_detalhe(l["token"], l["numero_cnj"])
            parsed = parse_detalhe(texto)
            confere = cnpj_confere(cnpj, parsed)
            if confere is False:
                homonimos += 1
                log(f"   {l['numero_cnj']}: HOMÔNIMO (CNPJ {parsed.get('cnpj_mascarado')} não bate com {cnpj[:3]}), apagado")
                sb.delete("radar_processos", {"numero_cnj": f"eq.{l['numero_cnj']}"})
                continue
            gravar_detalhe(sb, ids[l["numero_cnj"]], parsed)
            detalhes += 1
            log(f"   {l['numero_cnj']}: {parsed.get('orgao_julgador') or '?'} | dist. {parsed.get('data_distribuicao')} | "
                f"{len([p for p in parsed['passivo'] if p['oab']])} adv | {min(15, len(parsed['movimentos']))} mov gravadas de {parsed.get('qtd_movimentacoes')}")

    sb.rpc("radar_consolidar_dossie", {"p_cnpj": cnpj})
    restantes = len(linhas) - homonimos
    resultado = {"processos": restantes, "detalhes": detalhes, "homonimos": homonimos, "tempo_s": round(time.time() - inicio)}
    log(f"<- {cnpj} {emp.get('razao_social') or emp['nome_devedor']} | processos {restantes} | detalhes {detalhes} | "
        f"homônimos {homonimos} | {resultado['tempo_s']}s")
    return resultado


# ---------------------------------------------------------------------------
# Laço principal
# ---------------------------------------------------------------------------

def dentro_da_janela() -> bool:
    h = agora().hour
    return JANELA_INICIO_H <= h < JANELA_FIM_H


def dormir_ate_janela() -> None:
    a = agora()
    alvo = a.replace(hour=JANELA_INICIO_H, minute=0, second=0, microsecond=0)
    if a.hour >= JANELA_INICIO_H:
        alvo += timedelta(days=1)
    seg = max(60, (alvo - a).total_seconds())
    log(f"fora da janela ({JANELA_INICIO_H:02d}h-{JANELA_FIM_H:02d}h): dormindo até {alvo.strftime('%d/%m %H:%M')}")
    time.sleep(seg)


def abrir_navegador(pw, headless: bool) -> BrowserContext:
    PERFIL_NAVEGADOR.mkdir(parents=True, exist_ok=True)
    return pw.chromium.launch_persistent_context(
        str(PERFIL_NAVEGADOR), channel="chrome", headless=headless, viewport=VIEWPORT,
        locale=LOCALE, timezone_id=FUSO, ignore_default_args=["--enable-automation"],
        args=["--disable-blink-features=AutomationControlled"],
    )


class ControleBloqueio:
    def __init__(self):
        self.dia = agora().date()
        self.qtd = 0

    def registrar(self) -> int:
        if agora().date() != self.dia:
            self.dia, self.qtd = agora().date(), 0
        self.qtd += 1
        return self.qtd


def executar_com_bloqueio(sb: Supabase, pw, headless: bool, emp: dict, fila: dict | None, ctrl: ControleBloqueio,
                          debug: bool, max_detalhes: int = MAX_DETALHES_POR_EMPRESA) -> dict | None:
    """Roda a empresa; em bloqueio, marca, dorme 60 min e tenta de novo. Devolve None se desistiu por hoje."""
    while True:
        context = abrir_navegador(pw, headless)
        try:
            return processar_empresa(sb, context, emp, debug=debug, max_detalhes=max_detalhes)
        except Bloqueado as b:
            n = ctrl.registrar()
            log(f"!! BLOQUEIO {n}/{BLOQUEIOS_MAX_DIA} do dia em {agora().strftime('%H:%M:%S')}: {b} (empresa {emp['cnpj']})")
            if fila:
                sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"},
                         {"status": "bloqueado", "erro": f"Access Denied em {agora().strftime('%d/%m/%Y %H:%M:%S')}"})
            if n >= BLOQUEIOS_MAX_DIA:
                log("!! terceiro bloqueio do dia: parando até a próxima janela")
                return None
            log(f"   dormindo {BLOQUEIO_ESPERA_S // 60} min antes de tentar a mesma empresa")
            time.sleep(BLOQUEIO_ESPERA_S)
            if fila:
                sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"}, {"status": "processando", "erro": None})
        finally:
            try:
                context.close()
            except Exception:
                pass


def finalizar_fila(sb: Supabase, fila: dict, cnpj: str, resultado: dict | None, erro: Exception | None) -> None:
    fim = agora().isoformat()
    if erro is None and resultado is not None:
        sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"},
                 {"status": "concluido" if resultado["processos"] > 0 else "sem_processos", "finalizado_em": fim, "erro": None})
        return
    tentativas = int(fila.get("tentativas") or 0) + 1
    if tentativas >= MAX_TENTATIVAS_EMPRESA:
        sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"},
                 {"status": "erro", "tentativas": tentativas, "finalizado_em": fim, "erro": str(erro)[:500]})
        sb.patch("radar_empresas", {"cnpj": f"eq.{cnpj}"}, {"dossie_status": "erro", "atualizado_em": fim})
    else:
        sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"},
                 {"status": "pendente", "tentativas": tentativas, "erro": str(erro)[:500]})


def modo_cnpj(sb: Supabase, pw, headless: bool, cnpj: str, debug: bool, max_detalhes: int) -> int:
    cnpj = re.sub(r"\D", "", cnpj)
    emp = sb.empresa(cnpj)
    if not emp:
        log(f"CNPJ {cnpj} não está em radar_empresas")
        return 2
    fila = sb.fila_da_empresa(cnpj)
    ctrl = ControleBloqueio()
    if fila:
        sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"}, {"status": "processando", "iniciado_em": agora().isoformat()})
    try:
        resultado = executar_com_bloqueio(sb, pw, headless, emp, fila, ctrl, debug, max_detalhes)
    except Exception as e:  # erro inesperado
        log(f"!! erro em {cnpj}: {e!r}")
        if fila:
            finalizar_fila(sb, fila, cnpj, None, e)
        return 1
    if resultado is None:
        return 3
    if fila:
        finalizar_fila(sb, fila, cnpj, resultado, None)
    return 0


def modo_fila(sb: Supabase, pw, headless: bool, debug: bool) -> None:
    ctrl = ControleBloqueio()
    while True:
        if not dentro_da_janela():
            dormir_ate_janela()
            continue
        feitas = sb.concluidas_hoje()
        if feitas >= TETO_DIARIO:
            log(f"teto diário atingido ({feitas}/{TETO_DIARIO}); dormindo até a próxima janela")
            dormir_ate_janela()
            continue
        fila = sb.proxima_da_fila()
        if not fila:
            log("fila vazia; verificando de novo em 30 min")
            time.sleep(30 * 60)
            continue
        emp = sb.empresa(fila["cnpj"])
        if not emp:
            sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"}, {"status": "erro", "erro": "empresa não encontrada", "finalizado_em": agora().isoformat()})
            continue
        try:
            resultado = executar_com_bloqueio(sb, pw, headless, emp, fila, ctrl, debug)
        except Exception as e:
            log(f"!! erro em {fila['cnpj']}: {e!r}")
            finalizar_fila(sb, fila, fila["cnpj"], None, e)
            pausa(INTERVALO_ENTRE_EMPRESAS_S, JITTER_EMPRESAS_S, "próxima empresa")
            continue
        if resultado is None:
            # terceiro bloqueio do dia: a empresa fica 'bloqueado' e volta amanhã
            sb.patch("radar_pje_fila", {"id": f"eq.{fila['id']}"}, {"status": "pendente"})
            dormir_ate_janela()
            continue
        finalizar_fila(sb, fila, fila["cnpj"], resultado, None)
        pausa(INTERVALO_ENTRE_EMPRESAS_S, JITTER_EMPRESAS_S, "próxima empresa")


def main() -> int:
    ap = argparse.ArgumentParser(description="Worker do PJe TRF3 para o Radar (Fase 2)")
    ap.add_argument("--cnpj", help="processa só essa empresa, ignorando fila e teto")
    ap.add_argument("--headless", action="store_true", help="Chrome sem janela")
    ap.add_argument("--debug", action="store_true", help="salva HTML e texto das páginas em data/radar/debug")
    ap.add_argument("--detalhes", type=int, default=MAX_DETALHES_POR_EMPRESA,
                    help=f"com --cnpj: quantos detalhes abrir (padrão {MAX_DETALHES_POR_EMPRESA}; use 30 para abrir todos)")
    args = ap.parse_args()

    load_dotenv(RAIZ / ".env")
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env da raiz", file=sys.stderr)
        return 2
    sb = Supabase(url, key)
    log(f"pje_worker iniciado ({'headless' if args.headless else 'com janela'}; perfil {PERFIL_NAVEGADOR.relative_to(RAIZ)})")

    with sync_playwright() as pw:
        if args.cnpj:
            return modo_cnpj(sb, pw, args.headless, args.cnpj, args.debug, max(1, args.detalhes))
        try:
            modo_fila(sb, pw, args.headless, args.debug)
        except KeyboardInterrupt:
            log("interrompido")
    return 0


if __name__ == "__main__":
    sys.exit(main())
