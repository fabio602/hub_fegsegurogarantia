#!/usr/bin/env python3
"""
Radar · enriquecimento local pela BrasilAPI.

Mesma lógica da Edge Function radar-enrich-cnpj (mesmos campos, mesmas
exclusões, mesmo tratamento de 404), rodando no Mac sem limite de lote:
a Edge Function do plano Free para aos 150 s e faz 70 CNPJs por hora; com
30 mil empresas isso levaria semanas. Aqui a fila inteira roda de uma vez,
na ordem de score, com pausa de 1200 ms entre consultas.

Uso (na raiz do repo, com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env):

    nohup .venv/bin/python scripts/radar/enrich_local.py > data/pgfn/enrich_202606.log 2>&1 &

    --limite N   para depois de N CNPJs (padrão: sem limite)
    --pausa MS   pausa entre consultas em ms (padrão 1200)

Retomável: só pega quem tem enriquecido_em nulo e status 'novo', então pode
ser interrompido (Ctrl+C ou kill) e rodado de novo. Pode rodar junto com o
cron radar-enrich-hourly: os dois usam a mesma seleção e as gravações são
idempotentes.

BrasilAPI 429 ou 5xx: registra enriquecimento_erro, espera 60 s e tenta o
mesmo CNPJ de novo (até 5 vezes; depois pula e ele volta na próxima rodada).
Timeout/erro de rede: mesma coisa. 404: exclui como cnpj_nao_encontrado.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
BRASILAPI_CNPJ = "https://brasilapi.com.br/api/cnpj/v1"
TIMEOUT_S = 10
ESPERA_429_S = 60
MAX_TENTATIVAS = 5
LOTE_SELECAO = 500
LOG_A_CADA = 100


def agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%d/%m %H:%M:%S')}] {msg}", flush=True)


def texto(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def montar_telefone(ddd_telefone_1) -> str | None:
    d = re.sub(r"\D", "", str(ddd_telefone_1 or ""))
    if len(d) < 10:
        return None
    ddd, num = d[:2], d[2:]
    meio = 5 if len(num) == 9 else 4
    return f"({ddd}) {num[:meio]}-{num[meio:]}"


def montar_socios(qsa) -> list[dict]:
    if not isinstance(qsa, list):
        return []
    saida = []
    for s in qsa:
        nome = texto((s or {}).get("nome_socio"))
        if nome:
            saida.append({"nome": nome, "qualificacao": texto((s or {}).get("qualificacao_socio"))})
    return saida


def sem_acento(s: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKD", s.upper()).encode("ascii", "ignore").decode()


def em_recuperacao(*nomes) -> bool:
    """Nome da PGFN ou razão social com RECUPERACAO JUDICIAL / EM RECUPERACAO (migração 078)."""
    t = sem_acento(" | ".join(n or "" for n in nomes))
    return "RECUPERACAO JUDICIAL" in t or "EM RECUPERACAO" in t


def motivo_exclusao(c: dict) -> str | None:
    """Recuperação judicial e, na ordem da especificação: Simples/MEI, CNAE 64/65, cadastro não ativo."""
    if em_recuperacao(c.get("nome_devedor"), c.get("razao_social")):
        return "recuperacao_judicial"
    if c["optante_simples"] is True or c["optante_mei"] is True:
        return "simples_nacional"
    cnae = re.sub(r"\D", "", c["cnae_principal"] or "").rjust(7, "0")
    if cnae.startswith(("64", "65")):
        return "financeiro"
    if (c["situacao_cadastral"] or "").strip().upper() != "ATIVA":
        return "cadastro_inativo"
    return None


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.sess = requests.Session()
        self.sess.headers.update({"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})

    def _check(self, r: requests.Response, ctx: str) -> requests.Response:
        if r.status_code >= 300:
            raise RuntimeError(f"{ctx}: HTTP {r.status_code} {r.text[:300]}")
        return r

    def pendentes(self, ignorar: set[str]) -> tuple[list[dict], int]:
        """Próximo lote sem enriquecimento, por score, e quantos faltam no total."""
        r = self.sess.get(
            f"{self.base}/radar_empresas",
            params={"select": "cnpj,status,nome_devedor", "enriquecido_em": "is.null", "status": "eq.novo",
                    "order": "score.desc,valor_total.desc", "limit": LOTE_SELECAO},
            headers={"Prefer": "count=exact"}, timeout=60,
        )
        self._check(r, "seleção")
        total = int((r.headers.get("content-range") or "*/0").split("/")[-1] or 0)
        return [e for e in r.json() if e["cnpj"] not in ignorar], total

    def atualizar(self, cnpj: str, campos: dict) -> None:
        r = self.sess.patch(f"{self.base}/radar_empresas", params={"cnpj": f"eq.{cnpj}"},
                            json=campos, headers={"Prefer": "return=minimal"}, timeout=60)
        self._check(r, f"update {cnpj}")

    def recalcular_score(self, cnpj: str) -> None:
        r = self.sess.post(f"{self.base}/rpc/radar_atualizar_score", json={"p_cnpj": cnpj}, timeout=60)
        self._check(r, f"score {cnpj}")


def consultar(sess: requests.Session, cnpj: str) -> tuple[int, dict | None, str | None]:
    """(status, dados, erro). status 0 = timeout/rede."""
    try:
        r = sess.get(f"{BRASILAPI_CNPJ}/{cnpj}", timeout=TIMEOUT_S,
                     headers={"Accept": "application/json", "User-Agent": "feg-hub-radar-local/1.0"})
    except requests.Timeout:
        return 0, None, "timeout"
    except requests.RequestException as e:
        return 0, None, f"rede: {str(e)[:120]}"
    if r.status_code != 200:
        return r.status_code, None, None
    try:
        return 200, r.json(), None
    except ValueError:
        return 0, None, "json invalido"


def main() -> int:
    ap = argparse.ArgumentParser(description="Enriquecimento local do Radar pela BrasilAPI")
    ap.add_argument("--limite", type=int, default=0, help="para depois de N CNPJs (0 = sem limite)")
    ap.add_argument("--pausa", type=int, default=1200, help="pausa entre consultas em ms (padrão 1200)")
    args = ap.parse_args()

    load_dotenv(RAIZ / ".env")
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env da raiz", file=sys.stderr)
        return 2

    sb = Supabase(url, key)
    api = requests.Session()
    pausa_s = args.pausa / 1000
    inicio = time.time()
    pulados: set[str] = set()
    st = {"processadas": 0, "enriquecidas": 0, "mantidas_novo": 0, "recuperacao_judicial": 0, "simples_nacional": 0, "financeiro": 0,
          "cadastro_inativo": 0, "cnpj_nao_encontrado": 0, "esperas": 0, "pulados": 0, "erros_gravacao": 0}

    lote, faltam = sb.pendentes(pulados)
    log(f"início: {faltam} empresas sem enriquecimento (status novo); pausa {args.pausa} ms"
        + (f"; limite {args.limite}" if args.limite else ""))

    proxima_consulta = 0.0
    while lote:
        for emp in lote:
            if args.limite and st["processadas"] >= args.limite:
                lote = []
                break
            cnpj = emp["cnpj"]

            # pausa medida entre consultas à BrasilAPI (gravações correm no meio)
            espera = proxima_consulta - time.time()
            if espera > 0:
                time.sleep(espera)

            tentativas = 0
            while True:
                tentativas += 1
                status, dados, erro = consultar(api, cnpj)
                proxima_consulta = time.time() + pausa_s
                if status == 200 or status == 404 or (400 <= status < 500 and status != 429):
                    break
                # 429, 5xx, timeout ou rede: registra, espera e tenta de novo
                codigo = erro or f"http_{status}"
                try:
                    sb.atualizar(cnpj, {"enriquecimento_erro": codigo, "atualizado_em": agora_iso()})
                except Exception as e:
                    log(f"   erro ao registrar {codigo} em {cnpj}: {e}")
                if tentativas >= MAX_TENTATIVAS:
                    log(f"   {cnpj}: {codigo} pela {tentativas}ª vez, pulando (volta na próxima rodada)")
                    pulados.add(cnpj)
                    st["pulados"] += 1
                    status = -1
                    break
                st["esperas"] += 1
                log(f"   {cnpj}: {codigo}, esperando {ESPERA_429_S} s (tentativa {tentativas}/{MAX_TENTATIVAS})")
                time.sleep(ESPERA_429_S)
            if status == -1:
                continue

            st["processadas"] += 1
            try:
                if dados is None:
                    # 404 (ou outro 4xx): CNPJ não existe na base da Receita
                    sb.atualizar(cnpj, {
                        "enriquecimento_erro": "nao_encontrado", "enriquecido_em": agora_iso(),
                        "status": "excluido", "motivo_exclusao": "cnpj_nao_encontrado", "atualizado_em": agora_iso(),
                    })
                    sb.recalcular_score(cnpj)
                    st["cnpj_nao_encontrado"] += 1
                else:
                    d = dados
                    cadastro = {
                        "razao_social": texto(d.get("razao_social")),
                        "nome_fantasia": texto(d.get("nome_fantasia")),
                        "cnae_principal": texto(d.get("cnae_fiscal")),
                        "cnae_descricao": texto(d.get("cnae_fiscal_descricao")),
                        "porte": texto(d.get("porte")),
                        "optante_simples": d.get("opcao_pelo_simples") if isinstance(d.get("opcao_pelo_simples"), bool) else None,
                        "optante_mei": d.get("opcao_pelo_mei") if isinstance(d.get("opcao_pelo_mei"), bool) else None,
                        "situacao_cadastral": texto(d.get("descricao_situacao_cadastral")),
                        "municipio": texto(d.get("municipio")),
                        "email": (texto(d.get("email")) or "").lower() or None,
                        "telefone": montar_telefone(d.get("ddd_telefone_1")),
                        "socios": montar_socios(d.get("qsa")),
                        "enriquecido_em": agora_iso(),
                        "enriquecimento_erro": None,
                        "atualizado_em": agora_iso(),
                    }
                    motivo = motivo_exclusao({**cadastro, "nome_devedor": emp.get("nome_devedor")})
                    muda_status = bool(motivo) and emp["status"] == "novo"
                    if muda_status:
                        cadastro.update({"status": "excluido", "motivo_exclusao": motivo})
                    sb.atualizar(cnpj, cadastro)
                    sb.recalcular_score(cnpj)
                    st["enriquecidas"] += 1
                    if muda_status:
                        st[motivo] += 1
                    else:
                        st["mantidas_novo"] += 1
            except Exception as e:
                st["erros_gravacao"] += 1
                log(f"   erro ao gravar {cnpj}: {e}")

            if st["processadas"] % LOG_A_CADA == 0:
                decorrido = time.time() - inicio
                ritmo = st["processadas"] / decorrido if decorrido else 0
                restante = max(0, faltam - st["processadas"])
                horas = f" (~{restante / ritmo / 3600:.1f} h)" if ritmo else ""
                log(f"{st['processadas']} processadas | novo {st['mantidas_novo']} | simples {st['simples_nacional']} | "
                    f"financeiro {st['financeiro']} | inativo {st['cadastro_inativo']} | 404 {st['cnpj_nao_encontrado']} | "
                    f"esperas {st['esperas']} | pulados {st['pulados']} | {ritmo:.2f}/s | faltam ~{restante}{horas}")
        else:
            lote, faltam_agora = sb.pendentes(pulados)
            faltam = faltam_agora + st["processadas"]

    decorrido = time.time() - inicio
    log(f"fim: {st['processadas']} processadas em {decorrido / 60:.1f} min | enriquecidas {st['enriquecidas']} | "
        f"novo {st['mantidas_novo']} | simples {st['simples_nacional']} | financeiro {st['financeiro']} | "
        f"inativo {st['cadastro_inativo']} | 404 {st['cnpj_nao_encontrado']} | esperas {st['esperas']} | "
        f"pulados {st['pulados']} | erros de gravação {st['erros_gravacao']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("interrompido; rode de novo para continuar de onde parou")
        sys.exit(130)
