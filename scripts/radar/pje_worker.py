#!/usr/bin/env python3
"""
Radar · Fase 2 · worker do PJe TRF3 (dossiê judicial).

Processo de longa duração que pega empresas da fila radar_pje_fila, consulta a
consulta pública do PJe TRF3 1º grau, grava execuções fiscais (1116) e embargos
(1118) em radar_processos, com advogados e as 15 movimentações mais recentes, e
consolida o dossiê da empresa.

Desde 20/09/2026 a consulta pública é um aplicativo Angular
(pje1g-consultapublica.trf3.jus.br) que consome uma API REST pública em JSON,
sem autenticação e sem captcha. O worker chama essa API em vez de raspar HTML:
sem cliques, sem popup, sem parse de texto.

O Chrome real (Playwright, perfil persistente, janela escondida) continua sendo
aberto só para obter e renovar os cookies do Akamai — a API responde
HTTP/2 INTERNAL_ERROR para cliente sem esses cookies. As chamadas saem por
context.request.get, que reusa cookies e cabeçalhos do contexto.

Uso (na raiz do repo, com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env):

    .venv/bin/python scripts/radar/pje_worker.py                 # fila, janela 07h-23h
    .venv/bin/python scripts/radar/pje_worker.py --headless      # sem janela
    .venv/bin/python scripts/radar/pje_worker.py --cnpj 56199714000710   # só essa empresa
    .venv/bin/python scripts/radar/pje_worker.py --cnpj ... --debug      # salva o JSON bruto em data/radar/debug
    .venv/bin/python scripts/radar/pje_worker.py --cnpj ... --detalhes 30  # detalha todos os processos

Especificação: docs/radar/RADAR-FASE2.md e docs/radar/RADAR-PJE-API.md.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from playwright.sync_api import BrowserContext, TimeoutError as PwTimeout, sync_playwright

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

JANELA_INICIO_H = 7            # só trabalha entre 07:00 e 23:00 (hora local)
JANELA_FIM_H = 23
# A API custa cerca de 1 + 4 x N chamadas por empresa (uma busca e quatro
# chamadas por processo detalhado), contra dezenas de cliques da tela antiga.
INTERVALO_ENTRE_EMPRESAS_S = 60
JITTER_EMPRESAS_S = 30
INTERVALO_ENTRE_REQUISICOES_S = 6
JITTER_REQUISICOES_S = 4
MAX_DETALHES_POR_EMPRESA = 8
MAX_MOVIMENTOS_POR_PROCESSO = 15
TETO_DIARIO = 150
BLOQUEIO_ESPERA_S = 60 * 60
BLOQUEIOS_MAX_DIA = 3
MAX_TENTATIVAS_EMPRESA = 3
DATA_AUTUACAO_DE = "2021-01-01"
ANO_INICIAL = 2021
# sem nada desde 2021, a busca é repetida sem filtro de data; se nem a paginação
# der conta, quebra por ano a partir daqui
ANO_INICIAL_SEM_FILTRO = 2010
# a busca devolve 30 por página; páginas além disso vêm por ?page=N.
# Chegar neste teto significa que nem a paginação deu conta: aí quebra por ano.
MAX_PAGINAS_BUSCA = 10
# participantes vêm 10 por página; processos com muita parte precisam da 2ª
# página para não perder o advogado (e criar alerta falso de "sem advogado")
MAX_PAGINAS_POLO = 5

RAIZ = Path(__file__).resolve().parents[2]
PASTA_DADOS = RAIZ / "data" / "radar"
PERFIL_NAVEGADOR = PASTA_DADOS / "pje-profile"
ARQUIVO_LOG = PASTA_DADOS / "pje_worker.log"
PASTA_DEBUG = PASTA_DADOS / "debug"

URL_BASE = "https://pje1g-consultapublica.trf3.jus.br"
API = URL_BASE + "/v1"
VIEWPORT = {"width": 1366, "height": 800}
JANELA_POSICAO = "-2400,-2400"   # fora da área visível; headless não passa pelo Akamai
LOCALE = "pt-BR"
FUSO = "America/Sao_Paulo"
TZ = ZoneInfo(FUSO)

CLASSES = {1116: "EXECUÇÃO FISCAL", 1118: "EMBARGOS À EXECUÇÃO FISCAL"}
# a listagem identifica a classe pela sigla; o código é confirmado no detalhe,
# lendo os parênteses de classeJudicial ("EXECUÇÃO FISCAL (1116)")
SIGLAS = {"EXFIS": 1116, "EMBEXEFIS": 1118}
NOMES_CLASSE = {"EXECUCAO FISCAL": 1116, "EMBARGOS A EXECUCAO FISCAL": 1118}
PAPEIS_EXECUTADO = {"EXECUTADO", "EMBARGANTE", "EXECUTADA"}

RE_CNJ = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
RE_OAB = re.compile(r"OAB\s*([A-Z]{2}\s?\d+)", re.I)
RE_DOC = re.compile(r"\b(CNPJ|CPF):\s*([\d.\-/X*]+)", re.I)
RE_ULTIMA_MOV = re.compile(r"^(.*?)\s*\((\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})\)\s*$", re.S)
RE_AVISO_CORTE = re.compile(r"somente os \d+ primeiros", re.I)
# nome social: "FULANA registrado(a) civilmente como FULANO" — fica só o nome social
RE_NOME_CIVIL = re.compile(r"\s+registrad[oa]\(a\)\s+civilmente\s+como\s+.*$", re.I)

# Multiplicador das pausas. Qualquer bloqueio dobra o ritmo pelo resto do dia.
_fator_pausa = [1.0, None]   # [fator, dia em que vale]


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


def fator_pausa() -> float:
    """Fator atual das pausas, zerado na virada do dia."""
    hoje = agora().date()
    if _fator_pausa[1] != hoje:
        _fator_pausa[0], _fator_pausa[1] = 1.0, hoje
    return _fator_pausa[0]


def dobrar_pausas() -> None:
    fator_pausa()          # garante que o dia está atualizado antes de dobrar
    _fator_pausa[0] *= 2.0
    log(f"   ritmo: pausas dobradas pelo resto do dia (fator {_fator_pausa[0]:.0f}x)")


def pausa(base: float, jitter: float, motivo: str) -> None:
    f = fator_pausa()
    t = max(1.0, base * f + random.uniform(-jitter, jitter) * f)
    log(f"   pausa {t:.0f}s ({motivo})")
    time.sleep(t)


def pausa_requisicao(motivo: str) -> None:
    pausa(INTERVALO_ENTRE_REQUISICOES_S, JITTER_REQUISICOES_S, motivo)


def datahora_br_para_iso(d: str, h: str) -> str:
    """'07/06/2023', '14:03:11' -> ISO com fuso de Brasília."""
    dt = datetime.strptime(f"{d} {h}", "%d/%m/%Y %H:%M:%S").replace(tzinfo=TZ)
    return dt.isoformat()


def so_data(iso: str | None) -> str | None:
    """'2025-01-09T15:44:35.029263' -> '2025-01-09'."""
    if not iso:
        return None
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(iso))
    return m.group(1) if m else None


def chave_recencia(numero_cnj: str) -> tuple[int, int]:
    """Ano de autuação e sequencial, tirados do próprio número CNJ (NNNNNNN-DD.AAAA...)."""
    m = re.match(r"(\d{7})-\d{2}\.(\d{4})", numero_cnj)
    return (int(m.group(2)), int(m.group(1))) if m else (0, 0)


def nome_arquivo(s: str) -> str:
    return re.sub(r"[^\w.-]", "_", s or "x")


def salvar_debug(nome: str, conteudo: str) -> None:
    try:
        PASTA_DEBUG.mkdir(parents=True, exist_ok=True)
        (PASTA_DEBUG / nome).write_text(conteudo, encoding="utf-8")
    except OSError:
        pass


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
# Cliente da API da consulta pública
# ---------------------------------------------------------------------------

class PjeApi:
    """Chamadas à API JSON da consulta pública, pelo contexto do navegador.

    O navegador é aberto só para ter os cookies do Akamai; as requisições saem
    por context.request.get, que os reusa. Nunca usa fetch dentro da página."""

    def __init__(self, context: BrowserContext, debug: bool = False):
        self.context = context
        self.debug = debug
        self.app_anterior = app_da_frente()

    def abrir_spa(self) -> None:
        """Carrega o aplicativo uma vez para renovar os cookies do Akamai."""
        page = self.context.pages[0] if self.context.pages else self.context.new_page()
        pausa_requisicao("abrir consulta")
        page.goto(URL_BASE + "/", wait_until="domcontentloaded", timeout=90_000)
        try:
            page.wait_for_load_state("networkidle", timeout=30_000)
        except PwTimeout:
            pass
        titulo = (page.title() or "")
        if "access denied" in titulo.lower():
            raise Bloqueado(f"Access Denied ao abrir {page.url}")

    def _get(self, caminho: str, motivo: str, debug_nome: str | None = None) -> dict:
        pausa_requisicao(motivo)
        url = f"{API}/{caminho}"
        r = self.context.request.get(
            url, headers={"Accept": "application/json", "Referer": URL_BASE + "/"}, timeout=60_000)
        corpo = ""
        try:
            corpo = r.text()
        except Exception:
            pass
        if r.status == 403 or "access denied" in corpo[:2000].lower() or "edgesuite.net" in corpo[:2000].lower():
            raise Bloqueado(f"Access Denied em {caminho} (HTTP {r.status})")
        if r.status != 200:
            raise RuntimeError(f"{motivo}: HTTP {r.status} em {caminho}")
        try:
            dados = json.loads(corpo)
        except ValueError:
            raise RuntimeError(f"{motivo}: resposta não é JSON em {caminho}: {corpo[:200]}")
        if self.debug and debug_nome:
            salvar_debug(debug_nome, json.dumps(dados, ensure_ascii=False, indent=2))
        if dados.get("status") != "ok":
            raise RuntimeError(f"{motivo}: status {dados.get('status')!r} em {caminho}: {str(dados)[:200]}")
        return dados

    # --- endpoints ----------------------------------------------------------

    def buscar(self, cnpj: str, data_de: str | None = None, data_ate: str | None = None, page: int = 0) -> dict:
        q = f"processos?page={page}&documento={re.sub(r'[^0-9]', '', cnpj)}"
        if data_de:
            q += f"&dataAutuacaoInicio={data_de}"
        if data_ate:
            q += f"&dataAutuacaoFim={data_ate}"
        periodo = f"{data_de or 'sem data'}{(' a ' + data_ate) if data_ate else ''}"
        nome = f"busca_{cnpj}_{nome_arquivo(periodo)}_p{page}.json"
        return self._get(q, f"busca {cnpj} ({periodo}, pág. {page})", nome)

    def dados(self, id_processo: str, numero: str) -> dict:
        d = self._get(f"processos/{id_processo}/dados", f"dados {numero}", f"dados_{nome_arquivo(numero)}.json")
        return d.get("result") or {}

    def polo(self, id_processo: str, lado: str, numero: str) -> list[dict]:
        """lado = 'poloAtivo' ou 'poloPassivo'. Pagina enquanto houver página.
        HTTP 500 em alguns processos: trata como lista vazia e segue."""
        itens: list[dict] = []
        pagina = 0
        while pagina < MAX_PAGINAS_POLO:
            nome = f"{lado}_{nome_arquivo(numero)}_p{pagina}.json"
            try:
                d = self._get(f"processos/{id_processo}/{lado}?page={pagina}", f"{lado} {numero}", nome)
            except Bloqueado:
                raise
            except RuntimeError as e:
                log(f"   {numero}: {lado} indisponível ({e}); seguindo sem essas partes")
                break
            itens.extend(d.get("result") or [])
            pi = d.get("pageInfo") or {}
            if pagina + 1 >= int(pi.get("last") or 1):
                break
            pagina += 1
        return itens

    def movimentacoes(self, id_processo: str, numero: str) -> tuple[list[dict], int | None]:
        """Primeira página (15 por página, em ordem decrescente) e o total."""
        d = self._get(f"processos/{id_processo}/movimentacoes?page=0", f"movimentações {numero}",
                      f"movimentacoes_{nome_arquivo(numero)}.json")
        pi = d.get("pageInfo") or {}
        total = int(pi["count"]) if str(pi.get("count") or "").isdigit() else None
        return (d.get("result") or []), total


# ---------------------------------------------------------------------------
# Normalização das respostas
# ---------------------------------------------------------------------------

def classe_do_item(item: dict) -> tuple[int, str] | None:
    """Código e nome da classe a partir da sigla (ou do nome sem acento)."""
    sigla = sem_acento(item.get("classeSigla") or "").replace(" ", "")
    if sigla in SIGLAS:
        cod = SIGLAS[sigla]
        return cod, CLASSES[cod]
    nome = sem_acento(item.get("classe") or "")
    for chave, cod in NOMES_CLASSE.items():
        if nome.startswith(chave):
            return cod, CLASSES[cod]
    return None


def normalizar_listagem(item: dict, busca: tuple) -> dict | None:
    """Item da busca -> linha com as chaves que gravar_listagem espera.
    Devolve None para classes fora de 1116/1118."""
    numero = item.get("numeroProcesso") or ""
    if not RE_CNJ.fullmatch(numero.strip()):
        return None
    classe = classe_do_item(item)
    if not classe:
        return None
    partes = item.get("partes") or {}
    ativo = (partes.get("poloAtivo") or {}).get("nomeParte")
    passivo = (partes.get("poloPassivo") or {}).get("nomeParte")
    texto, data, hora = None, None, None
    bruto = (item.get("ultimaMovimentacao") or "").strip()
    if bruto:
        m = RE_ULTIMA_MOV.match(bruto)
        if m:
            texto, data, hora = (m.group(1).strip() or None), m.group(2), m.group(3)
        else:
            texto = bruto
    return {
        "numero_cnj": numero.strip(), "classe_codigo": classe[0], "classe_nome": classe[1],
        "assunto": item.get("assunto") or None,
        "id_processo": item.get("idProcesso"),
        "polo_ativo_nome": ativo, "polo_passivo_nome": passivo,
        "ultima_movimentacao_texto": texto, "ultima_movimentacao_data": data, "ultima_movimentacao_hora": hora,
        "busca": busca,
    }


def normalizar_participante(p: dict) -> dict:
    """Participante da API -> dict no formato que gravar_detalhe espera.
    A OAB e o documento vêm dentro de 'participante'
    ('FULANO - OAB SP455504 - CPF: 453.XXX.XXX-XX (ADVOGADO)')."""
    bruto = p.get("participante") or ""
    oab = RE_OAB.search(bruto)
    doc = RE_DOC.search(bruto)
    return {
        "nome": RE_NOME_CIVIL.sub("", (p.get("nome") or "").strip()).strip() or None,
        "papel": sem_acento(p.get("tipo") or "").strip(),
        "oab": re.sub(r"\s+", "", oab.group(1)).upper() if oab else None,
        "doc_tipo": doc.group(1).upper() if doc else None,
        "doc": doc.group(2) if doc else None,
    }


def montar_detalhe(dados: dict, passivo_bruto: list[dict], ativo_bruto: list[dict],
                   movs_brutos: list[dict], total_movs: int | None) -> dict:
    """Junta /dados, /poloPassivo, /poloAtivo e /movimentacoes no mesmo formato
    que gravar_detalhe já gravava a partir do HTML."""
    classe_txt = dados.get("classeJudicial") or ""
    cod = re.search(r"\((\d{3,4})\)\s*$", classe_txt)
    passivo = [normalizar_participante(p) for p in passivo_bruto]
    ativo = [normalizar_participante(p) for p in ativo_bruto]

    movs = []
    for m in movs_brutos:
        texto = (m.get("movimento") or "").strip()
        quando = (m.get("dataAtualizacao") or "").strip()
        mm = re.match(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})", quando)
        if not texto or not mm:
            continue
        movs.append({"ocorrido_em": datahora_br_para_iso(mm.group(1), mm.group(2)), "texto": texto})

    # Nos embargos a empresa é EMBARGANTE e fica no polo ativo do processo.
    # O worker guarda os lados em relação à empresa: 'passivo' = lado do
    # executado (empresa e seus advogados), 'ativo' = lado da Fazenda.
    lado_empresa, lado_fazenda = passivo, ativo
    if not any(p["papel"] in PAPEIS_EXECUTADO for p in passivo) and any(p["papel"] in PAPEIS_EXECUTADO for p in ativo):
        lado_empresa, lado_fazenda = ativo, passivo
    passivo, ativo = lado_empresa, lado_fazenda
    executado = next((p for p in passivo if p["papel"] in PAPEIS_EXECUTADO), None) or (passivo[0] if passivo else None)

    numero = (dados.get("numeroProcesso") or "").strip()
    return {
        "numero_cnj": numero or None,
        "data_distribuicao": so_data(dados.get("dataDistribuicao")),
        "classe_codigo": int(cod.group(1)) if cod else None,
        "classe_nome": re.sub(r"\s*\(\d{3,4}\)\s*$", "", classe_txt).strip() or None,
        "assunto": (dados.get("assunto") or "").strip() or None,
        "jurisdicao": (dados.get("jurisdicao") or "").strip() or None,
        "orgao_julgador": (dados.get("orgaoJulgador") or "").strip() or None,
        "polo_passivo_nome": executado["nome"] if executado else None,
        "cnpj_mascarado": executado["doc"] if executado and executado["doc_tipo"] == "CNPJ" else None,
        "passivo": passivo, "ativo": ativo, "movimentos": movs,
        "qtd_movimentacoes": total_movs if total_movs is not None else (len(movs) or None),
    }


def cnpj_confere(cnpj: str, parsed: dict) -> bool | None:
    """True se algum EXECUTADO/EMBARGANTE com CNPJ bate nos 3 primeiros dígitos
    (o CNPJ vem mascarado, '16.4XX.XXX/XXXX-XX', então só esses são visíveis);
    False se há CNPJ e nenhum bate; None se não dá para conferir."""
    prefixo = re.sub(r"\D", "", cnpj)[:3]
    docs = [re.sub(r"\D", "", p["doc"] or "")[:3] for p in parsed["passivo"]
            if p["papel"] in PAPEIS_EXECUTADO and p["doc_tipo"] == "CNPJ" and p["doc"]]
    docs = [d for d in docs if len(d) == 3]
    if not docs:
        return None
    return prefixo in docs


# ---------------------------------------------------------------------------
# Gravação
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
            reg["ultima_movimentacao_em"] = datahora_br_para_iso(
                l["ultima_movimentacao_data"], l.get("ultima_movimentacao_hora") or "00:00:00")
        # execução fiscal: União X empresa (empresa é o polo passivo);
        # embargos: empresa X União (a empresa embargante está no polo ativo, mas é o executado)
        nome = l["polo_passivo_nome"] if l["classe_codigo"] == 1116 else l["polo_ativo_nome"]
        if nome:
            reg["polo_passivo_nome"] = nome.strip()
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
    for m in parsed["movimentos"][:MAX_MOVIMENTOS_POR_PROCESSO]:
        k = (m["ocorrido_em"], m["texto"])
        if k in vistos:
            continue
        vistos.add(k)
        movs.append({"processo_id": processo_id, **m})
    if movs:
        sb.insert("radar_processo_movimentos", movs)


# ---------------------------------------------------------------------------
# Fluxo por empresa
# ---------------------------------------------------------------------------

def buscar_periodo(api: PjeApi, cnpj: str, de: str | None, ate: str | None = None) -> tuple[int, list[dict], bool]:
    """Busca paginada num período. Devolve (total no período, itens das classes
    1116/1118, se a paginação bateu no teto).

    O pageInfo da primeira página não dá para confiar: com mais de 30 processos
    ela devolve last=1 e count=30 e só a partir de ?page=1 a API admite o total
    real (verificado em 20/09/2026: Procomp diz 30 na página 0 e 42 na página 1).
    Quem sinaliza que há mais é o aviso "somente os 30 primeiros" em messages[],
    então a paginação segue enquanto a página vier cheia e houver aviso."""
    periodo = f"{de or 'sem data'}{(' a ' + ate) if ate else ''}"
    itens: list[dict] = []
    total, pagina, cheia = 0, 0, False
    while pagina < MAX_PAGINAS_BUSCA:
        d = api.buscar(cnpj, de, ate, page=pagina)
        pi = d.get("pageInfo") or {}
        if str(pi.get("count") or "").isdigit():
            total = max(total, int(pi["count"]))
        brutos = d.get("result") or []
        for bruto in brutos:
            item = normalizar_listagem(bruto, (de, ate))
            if item:
                itens.append(item)
        tamanho = int(pi.get("size") or 30)
        ultima = int(pi.get("last") or 1)
        truncada = any(RE_AVISO_CORTE.search(m or "") for m in (d.get("messages") or []))
        pagina += 1
        cheia = len(brutos) >= tamanho
        # página incompleta é sempre a última; sem aviso, vale o pageInfo.last
        if not cheia or (not truncada and pagina >= ultima):
            break
    no_teto = pagina >= MAX_PAGINAS_BUSCA and cheia
    log(f"   busca {periodo}: {total} resultados em {pagina} pág., {len(itens)} das classes 1116/1118"
        + (" (teto de páginas atingido)" if no_teto else ""))
    return total, itens, no_teto


def processar_empresa(sb: Supabase, context: BrowserContext, emp: dict, debug: bool = False,
                      max_detalhes: int = MAX_DETALHES_POR_EMPRESA) -> dict:
    """Consulta o PJe para uma empresa e grava tudo. Levanta Bloqueado se o Akamai barrar."""
    cnpj = emp["cnpj"]
    inicio = time.time()
    api = PjeApi(context, debug=debug)
    api.abrir_spa()

    log(f"-> {cnpj} {emp.get('razao_social') or emp['nome_devedor']}")
    encontrados: dict[str, dict] = {}

    def guardar(itens: list[dict]) -> None:
        for l in itens:
            encontrados[l["numero_cnj"]] = l

    def por_ano(ano_inicial: int) -> None:
        log(f"   paginação insuficiente: repetindo por ano de {ano_inicial} a {agora().year}")
        for ano in range(ano_inicial, agora().year + 1):
            _, itens, _ = buscar_periodo(api, cnpj, f"{ano}-01-01", f"{ano}-12-31")
            guardar(itens)

    # 1) desde 2021 (decisão 66: a busca é sempre por CNPJ)
    total, itens, no_teto = buscar_periodo(api, cnpj, DATA_AUTUACAO_DE)
    guardar(itens)
    if no_teto:
        por_ano(ANO_INICIAL)
    # 2) sem nada das classes desde 2021, repete sem filtro de data
    if not encontrados:
        log("   nenhum processo 1116/1118 desde 2021: repetindo sem filtro de data")
        total2, itens2, no_teto2 = buscar_periodo(api, cnpj, None)
        guardar(itens2)
        total = max(total, total2)
        if no_teto2:
            por_ano(ANO_INICIAL_SEM_FILTRO)

    linhas = list(encontrados.values())
    log(f"   listagem: {len(linhas)} processos das classes 1116/1118")
    ids = gravar_listagem(sb, cnpj, linhas) if linhas else {}

    detalhes, homonimos = 0, 0
    # os N mais recentes pelo número CNJ
    escolhidos = sorted(linhas, key=lambda l: chave_recencia(l["numero_cnj"]), reverse=True)[:max_detalhes]
    for l in escolhidos:
        numero, idp = l["numero_cnj"], l.get("id_processo")
        if not idp:
            log(f"   {numero}: sem idProcesso na listagem, pulando o detalhe")
            continue
        try:
            dados = api.dados(idp, numero)
        except Bloqueado:
            raise
        except RuntimeError as e:
            log(f"   {numero}: detalhe indisponível ({e}); pulando")
            continue
        passivo = api.polo(idp, "poloPassivo", numero)
        ativo = api.polo(idp, "poloAtivo", numero)
        movs, total_movs = api.movimentacoes(idp, numero)
        parsed = montar_detalhe(dados, passivo, ativo, movs, total_movs)

        confere = cnpj_confere(cnpj, parsed)
        if confere is False:
            homonimos += 1
            log(f"   {numero}: HOMÔNIMO (CNPJ {parsed.get('cnpj_mascarado')} não bate com {cnpj[:3]}), apagado")
            sb.delete("radar_processos", {"numero_cnj": f"eq.{numero}"})
            encontrados.pop(numero, None)
            continue
        gravar_detalhe(sb, ids[numero], parsed)
        detalhes += 1
        log(f"   {numero}: {parsed.get('orgao_julgador') or '?'} | dist. {parsed.get('data_distribuicao')} | "
            f"{len([p for p in parsed['passivo'] if p['oab']])} adv | "
            f"{min(MAX_MOVIMENTOS_POR_PROCESSO, len(parsed['movimentos']))} mov gravadas de {parsed.get('qtd_movimentacoes')}")

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


def _osascript(script: str) -> str:
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        return (r.stdout or "").strip()
    except Exception:
        return ""


def app_da_frente() -> str:
    return _osascript('tell application "System Events" to get name of first process whose frontmost is true')


def esconder_navegador(app_anterior: str | None = None) -> None:
    """Esconde (Cmd+H) o processo do Chrome do worker e devolve o foco ao app
    que estava na frente. O macOS não deixa a janela ficar fora da tela
    (--window-position é puxado de volta) e o Chrome ativa ao abrir, então o
    jeito é esconder o processo pelo System Events, identificado pelo PID do
    Chrome que usa o perfil do worker. Falha silenciosa se não houver permissão
    de automação: o worker segue com a janela visível."""
    try:
        r = subprocess.run(["pgrep", "-f", f"user-data-dir=.*{PERFIL_NAVEGADOR.name}"], capture_output=True, text=True, timeout=5)
        pids = [p for p in r.stdout.split() if p.isdigit()]
    except Exception:
        pids = []
    for pid in pids:
        _osascript(f'tell application "System Events" to set visible of (first process whose unix id is {pid}) to false')
    if app_anterior and app_anterior != "Google Chrome":
        _osascript(f'tell application "System Events" to set frontmost of process "{app_anterior}" to true')


def abrir_navegador(pw, headless: bool) -> BrowserContext:
    PERFIL_NAVEGADOR.mkdir(parents=True, exist_ok=True)
    app_anterior = app_da_frente()
    # A janela nasce fora da área visível (o PJe rejeita headless, decisão 67)
    # e não pede foco: o worker roda em segundo plano sem atrapalhar quem usa o Mac.
    context = pw.chromium.launch_persistent_context(
        str(PERFIL_NAVEGADOR), channel="chrome", headless=headless, viewport=VIEWPORT,
        locale=LOCALE, timezone_id=FUSO, ignore_default_args=["--enable-automation"],
        args=[
            "--disable-blink-features=AutomationControlled",
            f"--window-position={JANELA_POSICAO}",
            f"--window-size={VIEWPORT['width']},{VIEWPORT['height']}",
            "--no-first-run",
            "--no-default-browser-check",
        ],
    )
    esconder_navegador(app_anterior)
    return context


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
            dobrar_pausas()
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
    ap.add_argument("--debug", action="store_true", help="salva o JSON bruto das chamadas em data/radar/debug")
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
