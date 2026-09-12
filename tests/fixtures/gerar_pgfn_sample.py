#!/usr/bin/env python3
"""
Gera tests/fixtures/pgfn_sample.csv: 5.000 linhas sintéticas no formato dos
Dados Abertos da PGFN (separador ';', latin-1), cobrindo cada filtro do
scripts/radar/pgfn_ingest.py e incluindo CNPJs reais para o teste do
enriquecimento (radar-enrich-cnpj):

  indústrias (esperado: enriquecer e continuar 'novo'):
    33000167000101 Petrobras, 33592510000154 Vale, 33611500000119 Gerdau,
    07526557000100 Ambev, 51609238000150 Higident
  optante do Simples (esperado: excluido / simples_nacional):
    20648430000121 Asher Bruffer Administradora de Condomínios
  banco (esperado: excluido / financeiro, CNAE 64.22-1):
    00000000000191 Banco do Brasil (nome no fixture sem "BANCO", para passar
    pelo filtro de nome e ser barrado só no enriquecimento)

Determinístico (seed fixa). Rode: python tests/fixtures/gerar_pgfn_sample.py
"""
import csv
import random
from pathlib import Path

random.seed(20260912)
DESTINO = Path(__file__).with_name("pgfn_sample.csv")
TOTAL = 5000

CABECALHO = [
    "CPF_CNPJ", "TIPO_PESSOA", "TIPO_DEVEDOR", "NOME_DEVEDOR",
    "UF_UNIDADE_RESPONSAVEL", "UNIDADE_RESPONSAVEL", "NUMERO_INSCRICAO",
    "TIPO_SITUACAO_INSCRICAO", "SITUACAO_INSCRICAO", "RECEITA_PRINCIPAL",
    "DATA_INSCRICAO", "INDICADOR_AJUIZADO", "VALOR_CONSOLIDADO",
]

UFS = ["SP", "SP", "SP", "MG", "RJ", "PR", "RS", "SC", "BA", "GO"]
RECEITAS_OK = [
    "COFINS - CONTRIBUICAO PARA O FINANCIAMENTO DA SEGURIDADE SOCIAL",
    "PIS - PROGRAMA DE INTEGRACAO SOCIAL",
    "IPI - IMPOSTO SOBRE PRODUTOS INDUSTRIALIZADOS",
    "COFINS NAO CUMULATIVA",
    "PIS/PASEP NAO CUMULATIVO",
    "IPI VINCULADO A IMPORTACAO",
]
RECEITAS_FORA = ["IRPJ - IMPOSTO DE RENDA PESSOA JURIDICA", "CSLL", "MULTA ISOLADA", "CONTRIBUICAO PREVIDENCIARIA"]
RECEITAS_SIMPLES = ["SIMPLES NACIONAL", "SIMPLES NACIONAL - COFINS", "SIMPLES - PIS"]
TIPOS_SIT = ["BENEFICIO FISCAL", "EM COBRANCA", "GARANTIA", "PARCELAMENTO", "EM COBRANCA"]
SITUACOES = ["ATIVA EM COBRANCA", "ATIVA AJUIZADA", "GARANTIA REAL", "PARCELADA"]
NOMES_EXCLUIDOS = ["BANCO XYZ S A", "FINANCEIRA ALFA LTDA", "COOPERATIVA DE CREDITO BETA", "CONSORCIO NACIONAL GAMA",
                   "SEGURADORA DELTA S A", "MASSA FALIDA DE EPSILON LTDA", "PREFEITURA MUNICIPAL DE ZETA",
                   "FUNDACAO ETA", "ASSOCIACAO THETA", "IGREJA IOTA", "SINDICATO KAPPA", "ESTADO DE LAMBDA"]

REAIS = [
    ("33000167000101", "PETROLEO BRASILEIRO S A PETROBRAS", "RJ"),
    ("33592510000154", "VALE S A", "MG"),
    ("33611500000119", "GERDAU S A", "SP"),
    ("07526557000100", "AMBEV S A", "SP"),
    ("51609238000150", "HIGIDENT DO BRASIL IND E COM LTDA", "MG"),
    ("20648430000121", "ASHER BRUFFER ADMINISTRADORA DE CONDOMINIOS LTDA", "SP"),
    ("00000000000191", "BB PARTICIPACOES E NEGOCIOS", "DF"),
]

SUFIXOS = ["INDUSTRIA E COMERCIO LTDA", "METALURGICA LTDA", "QUIMICA S A", "ALIMENTOS LTDA", "TEXTIL LTDA",
           "PLASTICOS LTDA", "SIDERURGICA S A", "MOVEIS LTDA", "PAPEL E CELULOSE S A", "AUTOPECAS LTDA"]
PREFIXOS = ["AURORA", "BRASILIA", "CAMPINAS", "DELTA", "ESTRELA", "FENIX", "GLOBAL", "HORIZONTE", "IMPERIO",
            "JUPITER", "KRONOS", "LUMEN", "MERIDIAN", "NORDESTE", "OCEANO", "PLANALTO", "QUARTZO", "RIO VERDE",
            "SOLAR", "TITAN", "UNIVERSAL", "VALE DO SOL", "XINGU", "ZENITE"]


def cnpj_fake(i: int) -> str:
    return f"{10000000 + i:08d}0001{(i * 7) % 100:02d}"


def valor(faixa: str) -> str:
    v = {
        "baixo": random.uniform(5_000, 299_999),
        "medio": random.uniform(300_000, 999_999),
        "alto": random.uniform(1_000_000, 4_999_999),
        "grande": random.uniform(5_000_000, 40_000_000),
    }[faixa]
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def data(ano_ini: int, ano_fim: int) -> str:
    return f"{random.randint(1, 28):02d}/{random.randint(1, 12):02d}/{random.randint(ano_ini, ano_fim)}"


def linha(cnpj, nome, uf, receita, data_insc, ajuizado="SIM", tipo_pessoa="Pessoa jurídica",
          tipo_sit=None, faixa=None, num=None):
    return [
        cnpj, tipo_pessoa, "PRINCIPAL", nome, uf, f"PFN-{uf}", num or f"{random.randint(10, 99)} {random.randint(1, 9)} {random.randint(10**7, 10**8 - 1)}-{random.randint(10, 99)}",
        tipo_sit or random.choice(TIPOS_SIT), random.choice(SITUACOES), receita, data_insc, ajuizado,
        valor(faixa or random.choice(["baixo", "baixo", "medio", "alto", "grande"])),
    ]


def main():
    linhas = []
    seq = 0

    def num():
        nonlocal seq
        seq += 1
        return f"{seq:02d} {seq % 9 + 1} {seq:08d}-{seq % 97:02d}"

    # Empresas reais: 3 inscrições cada, uma com GARANTIA, valor alto (score alto = enriquecidas primeiro)
    for cnpj, nome, uf in REAIS:
        for k, tipo in enumerate(["GARANTIA", "EM COBRANCA", "BENEFICIO FISCAL"]):
            linhas.append(linha(cnpj, nome, uf, RECEITAS_OK[k % 3], data(2022, 2025), tipo_sit=tipo,
                                faixa="grande" if k == 0 else "alto", num=num()))

    # Aceitas: ~1.900 linhas sintéticas em ~600 CNPJs (várias inscrições por empresa)
    for i in range(600):
        cnpj = cnpj_fake(i)
        nome = f"{random.choice(PREFIXOS)} {random.choice(SUFIXOS)} {i:03d}"
        uf = random.choice(UFS)
        for _ in range(random.choice([1, 2, 3, 4, 5])):
            linhas.append(linha(cnpj, nome, uf, random.choice(RECEITAS_OK), data(2021, 2026), num=num()))

    def encher(qtd, fabrica):
        for i in range(qtd):
            linhas.append(fabrica(i))

    # Descartes, um bloco por filtro
    encher(450, lambda i: linha(f"***.{random.randint(100,999)}.{random.randint(100,999)}-**", f"PESSOA FISICA {i}", random.choice(UFS),
                                random.choice(RECEITAS_OK), data(2021, 2025), tipo_pessoa="Pessoa física", num=num()))
    encher(120, lambda i: linha(f"{random.randint(10**10, 10**11 - 1)}", f"CNPJ CURTO LTDA {i}", random.choice(UFS),
                                random.choice(RECEITAS_OK), data(2021, 2025), num=num()))
    encher(500, lambda i: linha(cnpj_fake(1000 + i), f"OPTANTE SIMPLES LTDA {i}", random.choice(UFS),
                                random.choice(RECEITAS_SIMPLES), data(2021, 2025), num=num()))
    encher(700, lambda i: linha(cnpj_fake(2000 + i), f"OUTRA RECEITA LTDA {i}", random.choice(UFS),
                                random.choice(RECEITAS_FORA), data(2021, 2025), num=num()))
    encher(500, lambda i: linha(cnpj_fake(3000 + i), f"NAO AJUIZADA LTDA {i}", random.choice(UFS),
                                random.choice(RECEITAS_OK), data(2021, 2025), ajuizado="NAO", num=num()))
    encher(500, lambda i: linha(cnpj_fake(4000 + i), f"INSCRICAO ANTIGA LTDA {i}", random.choice(UFS),
                                random.choice(RECEITAS_OK), data(2012, 2020), num=num()))
    encher(200, lambda i: linha(cnpj_fake(5000 + i), f"{random.choice(NOMES_EXCLUIDOS)} {i}", random.choice(UFS),
                                random.choice(RECEITAS_OK), data(2021, 2025), num=num()))

    # completa até 5.000 com aceitas extras
    while len(linhas) < TOTAL:
        i = len(linhas)
        linhas.append(linha(cnpj_fake(6000 + i), f"{random.choice(PREFIXOS)} {random.choice(SUFIXOS)} X{i}",
                            random.choice(UFS), random.choice(RECEITAS_OK), data(2021, 2026), num=num()))
    linhas = linhas[:TOTAL]
    random.shuffle(linhas)

    with DESTINO.open("w", encoding="latin-1", newline="") as f:
        w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        w.writerow(CABECALHO)
        w.writerows(linhas)
    print(f"{DESTINO}: {len(linhas)} linhas")


if __name__ == "__main__":
    main()
