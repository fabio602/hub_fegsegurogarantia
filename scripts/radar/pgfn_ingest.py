#!/usr/bin/env python3
"""
Radar · Fase 1 · Ingestão dos Dados Abertos da PGFN.

Lê os CSVs de "Devedores inscritos em Dívida Ativa da União" colocados em
data/pgfn/<AAAAMM>/, aplica os filtros da Fase 1 (pessoa jurídica, receita
PIS/COFINS/IPI, ajuizada, inscrita a partir de 2021, nome fora da lista de
exclusão), grava as inscrições aceitas em radar_inscricoes e, ao final,
consolida radar_empresas pela função SQL radar_consolidar_empresas.

Uso:
    python scripts/radar/pgfn_ingest.py --competencia 202506 --uf SP

    --uf         opcional. Restringe aos arquivos cujo nome contém a UF e, em
                 todo caso, às linhas cuja UF_UNIDADE_RESPONSAVEL é a UF.
    --pasta      opcional. Pasta dos CSVs (padrão: data/pgfn/<competencia>).
    --chunk      opcional. Linhas por chunk do pandas (padrão: 200000).

Lê .env na raiz do repo com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
Especificação: docs/radar/RADAR-FASE1.md.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]

COLUNAS = [
    "CPF_CNPJ", "TIPO_PESSOA", "TIPO_DEVEDOR", "NOME_DEVEDOR",
    "UF_UNIDADE_RESPONSAVEL", "UNIDADE_RESPONSAVEL", "NUMERO_INSCRICAO",
    "TIPO_SITUACAO_INSCRICAO", "SITUACAO_INSCRICAO", "RECEITA_PRINCIPAL",
    "DATA_INSCRICAO", "INDICADOR_AJUIZADO", "VALOR_CONSOLIDADO",
]

RECEITAS_ACEITAS = ("PIS", "COFINS", "IPI")
DATA_MINIMA = pd.Timestamp("2021-01-01")

NOMES_EXCLUIDOS = [
    "BANCO", "FINANCEIRA", "CREDITO", "CRÉDITO", "CONSORCIO", "CONSÓRCIO",
    "SEGURADORA", "SEGUROS", "CAPITALIZACAO", "MASSA FALIDA", "FALIDA",
    "PREFEITURA", "MUNICIPIO", "MUNICÍPIO", "ESTADO DE", "FUNDACAO",
    "FUNDAÇÃO", "ASSOCIACAO", "ASSOCIAÇÃO", "IGREJA", "SINDICATO",
]

LOTE_UPSERT = 1000

# Ordem em que os filtros são aplicados; o log mostra o descarte de cada um.
FILTROS = [
    ("pessoa_fisica", "TIPO_PESSOA diferente de pessoa jurídica"),
    ("cnpj_invalido", "CPF_CNPJ sem 14 dígitos"),
    ("receita_simples", "RECEITA_PRINCIPAL contém SIMPLES"),
    ("receita_fora", "RECEITA_PRINCIPAL sem PIS, COFINS ou IPI"),
    ("nao_ajuizado", "INDICADOR_AJUIZADO diferente de SIM"),
    ("data_antiga", "DATA_INSCRICAO anterior a 2021-01-01 ou inválida"),
    ("nome_excluido", "NOME_DEVEDOR na lista de exclusão"),
    ("uf_diferente", "UF_UNIDADE_RESPONSAVEL diferente da UF pedida"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalizar_nome_coluna(nome: str) -> str:
    """Maiúsculas, sem acento, sem BOM, espaços internos viram underscore."""
    s = unicodedata.normalize("NFKD", str(nome)).encode("ascii", "ignore").decode()
    s = s.replace("﻿", "").strip().upper()
    s = re.sub(r"\s+", "_", s)
    return s


def mapear_colunas(colunas_arquivo) -> dict[str, str]:
    """Devolve {nome_esperado: nome_no_arquivo}. Falha listando o que falta."""
    por_normalizado = {normalizar_nome_coluna(c): c for c in colunas_arquivo}
    mapa, faltando = {}, []
    for esperada in COLUNAS:
        if esperada in por_normalizado:
            mapa[esperada] = por_normalizado[esperada]
        else:
            faltando.append(esperada)
    if faltando:
        raise ValueError(
            "colunas ausentes no CSV: " + ", ".join(faltando)
            + ". Colunas encontradas: " + ", ".join(map(str, colunas_arquivo))
        )
    return mapa


def sem_acento_upper(serie: pd.Series) -> pd.Series:
    return (
        serie.fillna("").astype(str).str.upper()
        .str.normalize("NFKD").str.encode("ascii", "ignore").str.decode("ascii")
        .str.strip()
    )


def parse_data(serie: pd.Series) -> pd.Series:
    """Aceita dd/mm/aaaa e aaaa-mm-dd. O que não parsear vira NaT."""
    s = serie.fillna("").astype(str).str.strip().str.slice(0, 10)
    iso = s.str.match(r"^\d{4}-\d{2}-\d{2}$")
    out = pd.Series(pd.NaT, index=s.index, dtype="datetime64[ns]")
    out[iso] = pd.to_datetime(s[iso], format="%Y-%m-%d", errors="coerce")
    out[~iso] = pd.to_datetime(s[~iso], format="%d/%m/%Y", errors="coerce")
    return out


def parse_valor(serie: pd.Series) -> pd.Series:
    """'1.234.567,89' -> 1234567.89. Também aceita ponto decimal puro."""
    s = serie.fillna("0").astype(str).str.strip()
    com_virgula = s.str.contains(",", regex=False)
    s = s.where(~com_virgula, s.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    return pd.to_numeric(s, errors="coerce").fillna(0).round(2)


# ---------------------------------------------------------------------------
# Supabase REST (service role)
# ---------------------------------------------------------------------------

class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.sess = requests.Session()
        self.sess.headers.update({
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })

    def _check(self, r: requests.Response, contexto: str):
        if r.status_code >= 300:
            raise RuntimeError(f"{contexto}: HTTP {r.status_code} {r.text[:500]}")
        return r

    def inserir_ingestao(self, competencia: str, arquivo: str) -> int:
        r = self.sess.post(
            f"{self.base}/radar_ingestoes",
            json={"competencia": competencia, "arquivo": arquivo},
            headers={"Prefer": "return=representation"},
            timeout=30,
        )
        self._check(r, "radar_ingestoes insert")
        return r.json()[0]["id"]

    def atualizar_ingestao(self, ingestao_id: int, campos: dict):
        r = self.sess.patch(
            f"{self.base}/radar_ingestoes?id=eq.{ingestao_id}",
            json=campos,
            headers={"Prefer": "return=minimal"},
            timeout=30,
        )
        self._check(r, "radar_ingestoes update")

    def upsert_inscricoes(self, linhas: list[dict]):
        for i in range(0, len(linhas), LOTE_UPSERT):
            lote = linhas[i:i + LOTE_UPSERT]
            for tentativa in range(3):
                r = self.sess.post(
                    f"{self.base}/radar_inscricoes?on_conflict=competencia,numero_inscricao",
                    json=lote,
                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                    timeout=120,
                )
                if r.status_code < 300:
                    break
                if r.status_code in (429, 500, 502, 503, 504) and tentativa < 2:
                    time.sleep(2 * (tentativa + 1))
                    continue
                self._check(r, f"radar_inscricoes upsert (lote a partir de {i})")

    def consolidar(self, competencia: str) -> int:
        r = self.sess.post(
            f"{self.base}/rpc/radar_consolidar_empresas",
            json={"p_competencia": competencia},
            timeout=600,
        )
        self._check(r, "radar_consolidar_empresas")
        return int(r.json())


# ---------------------------------------------------------------------------
# Pipeline por arquivo
# ---------------------------------------------------------------------------

def filtrar_chunk(df: pd.DataFrame, mapa: dict[str, str], uf: str | None, descartes: dict[str, int]) -> pd.DataFrame:
    """Aplica os filtros na ordem de FILTROS, contando o descarte de cada um."""
    df = df.rename(columns={v: k for k, v in mapa.items()})[COLUNAS].copy()

    def aplicar(chave: str, mascara: pd.Series) -> None:
        nonlocal df
        descartes[chave] += int((~mascara).sum())
        df = df[mascara]

    # 2. pessoa jurídica
    tipo = sem_acento_upper(df["TIPO_PESSOA"])
    aplicar("pessoa_fisica", tipo.str.contains("JURIDICA", regex=False))
    if df.empty:
        return df

    # 3. cnpj só dígitos, 14 caracteres
    df["cnpj"] = df["CPF_CNPJ"].fillna("").astype(str).str.replace(r"\D", "", regex=True)
    aplicar("cnpj_invalido", df["cnpj"].str.len() == 14)
    if df.empty:
        return df
    df["valor_consolidado"] = parse_valor(df["VALOR_CONSOLIDADO"])

    # 4. receita: descarta SIMPLES, mantém PIS/COFINS/IPI
    receita = df["RECEITA_PRINCIPAL"].fillna("").astype(str).str.upper()
    aplicar("receita_simples", ~receita.str.contains("SIMPLES", regex=False))
    receita = receita[df.index]
    aceita = pd.Series(False, index=df.index)
    for termo in RECEITAS_ACEITAS:
        aceita |= receita.str.contains(termo, regex=False)
    aplicar("receita_fora", aceita)
    if df.empty:
        return df

    # 5. ajuizada
    ajuizado = sem_acento_upper(df["INDICADOR_AJUIZADO"])
    aplicar("nao_ajuizado", ajuizado == "SIM")
    if df.empty:
        return df

    # 6. data de inscrição >= 2021-01-01
    df["data_inscricao"] = parse_data(df["DATA_INSCRICAO"])
    aplicar("data_antiga", df["data_inscricao"] >= DATA_MINIMA)
    if df.empty:
        return df

    # 7. nome fora da lista de exclusão
    nome = df["NOME_DEVEDOR"].fillna("").astype(str).str.upper()
    excluido = pd.Series(False, index=df.index)
    for termo in NOMES_EXCLUIDOS:
        excluido |= nome.str.contains(termo, regex=False)
    aplicar("nome_excluido", ~excluido)

    # UF pedida na linha de comando
    if uf:
        aplicar("uf_diferente", sem_acento_upper(df["UF_UNIDADE_RESPONSAVEL"]) == uf)

    return df


def linhas_para_upsert(df: pd.DataFrame, competencia: str, ingestao_id: int) -> list[dict]:
    def texto(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        s = str(v).strip()
        return s or None

    saida = []
    for r in df.itertuples(index=False):
        saida.append({
            "ingestao_id": ingestao_id,
            "competencia": competencia,
            "cnpj": r.cnpj,
            "nome_devedor": texto(r.NOME_DEVEDOR) or "(sem nome)",
            "uf": texto(r.UF_UNIDADE_RESPONSAVEL),
            "unidade_responsavel": texto(r.UNIDADE_RESPONSAVEL),
            "numero_inscricao": texto(r.NUMERO_INSCRICAO),
            "tipo_situacao": texto(r.TIPO_SITUACAO_INSCRICAO),
            "situacao": texto(r.SITUACAO_INSCRICAO),
            "receita_principal": texto(r.RECEITA_PRINCIPAL),
            "data_inscricao": r.data_inscricao.strftime("%Y-%m-%d"),
            "ajuizado": True,
            "valor_consolidado": float(r.valor_consolidado),
        })
    return saida


def processar_arquivo(sb: Supabase, caminho: Path, competencia: str, uf: str | None, chunk: int) -> tuple[int, int]:
    inicio = time.time()
    print(f"\n== {caminho.name}")
    ingestao_id = sb.inserir_ingestao(competencia, caminho.name)
    lidas = aceitas = 0
    descartes = {chave: 0 for chave, _ in FILTROS}
    try:
        leitor = pd.read_csv(
            caminho, sep=";", encoding="latin-1", dtype=str,
            chunksize=chunk, on_bad_lines="warn", keep_default_na=False,
        )
        mapa = None
        for n, df in enumerate(leitor, start=1):
            if mapa is None:
                mapa = mapear_colunas(df.columns)
            lidas += len(df)
            filtrado = filtrar_chunk(df, mapa, uf, descartes)
            # sem numero_inscricao não dá para fazer o upsert
            filtrado = filtrado[filtrado["NUMERO_INSCRICAO"].fillna("").astype(str).str.strip() != ""]
            # dentro de um mesmo statement o Postgres não aceita a mesma chave duas vezes
            filtrado = filtrado.drop_duplicates(subset=["NUMERO_INSCRICAO"], keep="last")
            if not filtrado.empty:
                sb.upsert_inscricoes(linhas_para_upsert(filtrado, competencia, ingestao_id))
            aceitas += len(filtrado)
            print(f"   chunk {n}: {len(df):>8} lidas | {len(filtrado):>7} aceitas | {time.time() - inicio:6.1f}s")
        if mapa is None:
            raise ValueError("arquivo vazio (nem cabeçalho)")
        sb.atualizar_ingestao(ingestao_id, {
            "linhas_lidas": lidas, "linhas_aceitas": aceitas,
            "finalizado_em": pd.Timestamp.now('UTC').isoformat(),
        })
    except Exception as e:  # falha em um arquivo não interrompe os demais
        erro = f"{type(e).__name__}: {e}"[:2000]
        print(f"   ERRO: {erro}", file=sys.stderr)
        try:
            sb.atualizar_ingestao(ingestao_id, {
                "linhas_lidas": lidas, "linhas_aceitas": aceitas, "erro": erro,
                "finalizado_em": pd.Timestamp.now('UTC').isoformat(),
            })
        except Exception as e2:
            print(f"   ERRO ao registrar a falha: {e2}", file=sys.stderr)

    print(f"   lidas: {lidas} | aceitas: {aceitas} | tempo: {time.time() - inicio:.1f}s")
    print("   descartes por filtro:")
    for chave, descricao in FILTROS:
        if chave == "uf_diferente" and not uf:
            continue
        print(f"     {chave:<16} {descartes[chave]:>8}   {descricao}")
    return lidas, aceitas


def listar_arquivos(pasta: Path, uf: str | None) -> list[Path]:
    todos = sorted(p for p in pasta.glob("*.csv") if p.is_file())
    if not uf:
        return todos
    padrao = re.compile(rf"(^|[^A-Z0-9]){uf}([^A-Z0-9]|$)", re.IGNORECASE)
    por_nome = [p for p in todos if padrao.search(p.stem)]
    # Sem arquivo por UF (base particionada de outro jeito), lê todos e
    # filtra pela coluna UF_UNIDADE_RESPONSAVEL.
    return por_nome or todos


def main() -> int:
    ap = argparse.ArgumentParser(description="Ingestão PGFN para o Radar (Fase 1)")
    ap.add_argument("--competencia", required=True, help="AAAAMM da base, ex: 202506")
    ap.add_argument("--uf", help="UF, ex: SP (opcional)")
    ap.add_argument("--pasta", help="pasta dos CSVs (padrão: data/pgfn/<competencia>)")
    ap.add_argument("--chunk", type=int, default=200_000, help="linhas por chunk (padrão 200000)")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{6}", args.competencia):
        ap.error("--competencia deve ter o formato AAAAMM")
    uf = args.uf.strip().upper() if args.uf else None
    if uf and not re.fullmatch(r"[A-Z]{2}", uf):
        ap.error("--uf deve ter 2 letras")

    load_dotenv(RAIZ / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env da raiz (veja .env.example)", file=sys.stderr)
        return 2

    pasta = Path(args.pasta) if args.pasta else RAIZ / "data" / "pgfn" / args.competencia
    if not pasta.is_dir():
        print(f"pasta não encontrada: {pasta}", file=sys.stderr)
        return 2
    arquivos = listar_arquivos(pasta, uf)
    if not arquivos:
        print(f"nenhum .csv em {pasta}", file=sys.stderr)
        return 2

    print(f"Radar · ingestão PGFN · competência {args.competencia}" + (f" · UF {uf}" if uf else ""))
    print(f"pasta: {pasta} | arquivos: {len(arquivos)} | chunk: {args.chunk}")

    sb = Supabase(url, key)
    inicio = time.time()
    total_lidas = total_aceitas = 0
    for caminho in arquivos:
        lidas, aceitas = processar_arquivo(sb, caminho, args.competencia, uf, args.chunk)
        total_lidas += lidas
        total_aceitas += aceitas

    print(f"\n== consolidando radar_empresas ({args.competencia})")
    try:
        n = sb.consolidar(args.competencia)
        print(f"   empresas inseridas/atualizadas: {n}")
    except Exception as e:
        print(f"   ERRO na consolidação: {e}", file=sys.stderr)
        return 1

    print(f"\ntotal: {total_lidas} lidas | {total_aceitas} aceitas | {time.time() - inicio:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
