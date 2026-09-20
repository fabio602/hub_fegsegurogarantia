# -*- coding: utf-8 -*-
"""Aplica no `prospecting-cadence` a identidade por trilha da migração 088.

COMO USAR

    cd ~/Documents/FG/hub
    python3 patch-cadencia-saude.py
    supabase functions deploy prospecting-cadence

Depois confira, sem enviar nada:

    curl -s -X POST "$SUPABASE_URL/functions/v1/prospecting-cadence" \\
      -H 'Content-Type: application/json' \\
      -d '{"modo":"preview","trilha":"garantia"}'   | grep -o 'F&amp;G [A-Za-zÁ-ú]*'
    curl -s -X POST "$SUPABASE_URL/functions/v1/prospecting-cadence" \\
      -H 'Content-Type: application/json' \\
      -d '{"modo":"preview","trilha":"saude-pme"}'  | grep -o 'F&amp;G [A-Za-zÁ-ú]*'

O primeiro tem que dizer "F&G Seguro Garantia" e o segundo "F&G Saúde".
O modo preview monta o HTML e devolve, não envia e-mail nenhum.

POR QUE UM SCRIPT E NÃO O ARQUIVO PRONTO

O arquivo tem quase quinhentas linhas. Reescrevê-lo inteiro abriria espaço para
um erro de transcrição numa parte que ninguém queria mudar. Aqui cada troca é
uma substituição exata: se o texto de origem não existir, ou existir mais vezes
do que o esperado, o script para e não grava nada.

O QUE MUDA

1. `interface Trilha` passa a carregar a identidade da trilha.
2. `molde()` recebe nome, cargo, assinatura, telefone, site e paleta, em vez de
   ter tudo fixo no código.
3. `montarEmail()` repassa esses campos.
4. Os dois `select` de `email_trilhas` trazem as colunas novas.
5. O botão usa o WhatsApp da trilha quando a etapa não traz link próprio.
6. O nome do remetente passa a ser o da trilha.

Trilha sem paleta e sem contato próprio continua exatamente como está hoje,
porque a migração deu a todas elas os valores antigos como padrão.
"""

import io
import os
import sys

ALVO = 'supabase/functions/prospecting-cadence/index.ts'

MARCA_JA_APLICADO = 'contato_whatsapp'


# ─────────────────────────────────────────────────────────────────────────────
# 1. interface Trilha
# ─────────────────────────────────────────────────────────────────────────────

DE_1 = """interface Trilha {
  slug: string;
  nome: string;
  eyebrow: string;
  rodape: string;
}"""

PARA_1 = """interface TemaEmail {
  acento?: string;
  cabecalho?: string;
  painel?: string;
  rodape_fundo?: string;
  pagina?: string;
  texto_suave?: string;
  texto_legal?: string;
}

interface Trilha {
  slug: string;
  nome: string;
  eyebrow: string;
  rodape: string;
  /* Identidade da trilha (migracao 088). Toda trilha tem valor: o banco
     preencheu as antigas com o que ja estava fixo aqui no codigo. */
  assinatura_linha: string;
  marca_nome: string;
  marca_cargo: string;
  contato_telefone: string;
  contato_site: string;
  contato_whatsapp: string;
  tema: TemaEmail | null;
}"""


# ─────────────────────────────────────────────────────────────────────────────
# 2. assinatura de molde() e resolucao do tema
# ─────────────────────────────────────────────────────────────────────────────

DE_2 = """function molde(o: {
  eyebrow: string;
  badge: string;
  tagline: string;
  titulo: string;
  corpo: string;
  cta: string | null;
  ctaLink: string;
  rodape: string;
}): string {"""

PARA_2 = """function molde(o: {
  eyebrow: string;
  badge: string;
  tagline: string;
  titulo: string;
  corpo: string;
  cta: string | null;
  ctaLink: string;
  rodape: string;
  marcaNome: string;
  marcaCargo: string;
  assinatura: string;
  telefone: string;
  site: string;
  tema: TemaEmail | null;
}): string {
  // Paleta padrao: o navy e o dourado da F&G Seguro Garantia. Trilha com
  // `tema` no banco sobrescreve so as chaves que informar.
  const TEMA_PADRAO = {
    acento: '#C69C6D', cabecalho: '#1B263B', painel: '#243347',
    rodape_fundo: '#141E2E', pagina: '#EDEAE4',
    texto_suave: '#8FA8C0', texto_legal: '#3D5166',
  };
  const t = { ...TEMA_PADRAO, ...(o.tema ?? {}) };
  const tel = o.telefone.replace(/\\D/g, '');"""


# ─────────────────────────────────────────────────────────────────────────────
# 3. o molde visual, agora lendo o tema
# ─────────────────────────────────────────────────────────────────────────────

DE_3_INICIO = '  const botao = o.cta'
DE_3_FIM = "</body></html>`;\n}"

PARA_3 = """  const botao = o.cta
    ? `<table cellpadding="0" cellspacing="0"><tr><td style="background-color:${t.cabecalho};padding:14px 36px;border-radius:2px;"><a href="${o.ctaLink}" style="color:${t.acento};font-size:12px;font-weight:bold;text-decoration:none;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">${o.cta}</a></td></tr></table>`
    : '';

  const faixaTagline = o.tagline
    ? `<div style="display:inline-block;border-top:1px solid ${t.acento};border-bottom:1px solid ${t.acento};padding:12px 0;margin-bottom:20px;"><span style="color:${t.acento};font-size:9px;letter-spacing:5px;text-transform:uppercase;font-family:Arial,sans-serif;">${o.tagline}</span></div>`
    : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${o.marcaNome}</title></head><body style="margin:0;padding:0;background-color:${t.pagina};"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${t.pagina};padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;"><tr><td style="background-color:${t.acento};height:5px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background-color:${t.cabecalho};padding:36px 48px 28px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><div style="color:${t.acento};font-size:10px;letter-spacing:4px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:6px;">${o.eyebrow}</div><div style="color:#FFFFFF;font-size:24px;font-weight:bold;letter-spacing:1px;font-family:Georgia,serif;">${o.marcaNome.replace('&', '&amp;')}</div></td><td align="right" style="vertical-align:middle;"><div style="border:1px solid ${t.acento};padding:6px 14px;border-radius:2px;"><span style="color:${t.acento};font-size:10px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">${o.badge}</span></div></td></tr></table></td></tr><tr><td style="background-color:${t.painel};padding:48px 48px 40px;text-align:center;">${faixaTagline}<div style="color:#FFFFFF;font-size:28px;font-weight:bold;font-family:Georgia,serif;line-height:1.35;">${o.titulo}</div></td></tr><tr><td style="background-color:${t.acento};height:1px;"></td></tr><tr><td style="background-color:#FFFFFF;padding:44px 48px;"><p style="margin:0 0 20px 0;color:${t.cabecalho};font-size:16px;line-height:1.75;font-family:Georgia,serif;">Olá, <strong>[NOME_CONTATO]</strong>!</p>${o.corpo}${botao}</td></tr><tr><td style="background-color:${t.acento};height:1px;"></td></tr><tr><td style="background-color:${t.cabecalho};padding:28px 48px;"><div style="color:#FFFFFF;font-size:15px;font-weight:bold;font-family:Georgia,serif;margin-bottom:4px;">Fábio Lima</div><div style="color:${t.acento};font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">${o.marcaCargo.replace('&', '&amp;')}</div><div style="color:${t.texto_suave};font-size:11px;font-family:Arial,sans-serif;margin-bottom:14px;">${o.assinatura}</div><a href="tel:+55${tel}" style="color:${t.texto_suave};font-size:12px;text-decoration:none;font-family:Arial,sans-serif;display:block;margin-bottom:6px;">📱 ${o.telefone}</a><a href="https://${o.site}" style="color:${t.texto_suave};font-size:12px;text-decoration:none;font-family:Arial,sans-serif;display:block;">🌐 ${o.site}</a></td></tr><tr><td style="background-color:${t.rodape_fundo};padding:16px 48px;border-radius:0 0 4px 4px;"><p style="margin:0;color:${t.texto_legal};font-size:10px;line-height:1.7;font-family:Arial,sans-serif;text-align:center;">${o.rodape} &nbsp;·&nbsp; <a href="mailto:fabio@fegsegurogarantia.com.br?subject=Descadastrar" style="color:${t.texto_legal};text-decoration:underline;">Descadastrar</a></p></td></tr><tr><td style="background-color:${t.acento};height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}"""


# ─────────────────────────────────────────────────────────────────────────────
# 4. montarEmail repassa a identidade
# ─────────────────────────────────────────────────────────────────────────────

DE_4 = """    cta:     etapa.cta_texto,
    ctaLink: etapa.cta_link || WHATSAPP,
    rodape:  trilha.rodape,
  });"""

PARA_4 = """    cta:     etapa.cta_texto,
    ctaLink: etapa.cta_link || trilha.contato_whatsapp || WHATSAPP,
    rodape:  trilha.rodape,
    marcaNome:  trilha.marca_nome       || 'F&G Seguro Garantia',
    marcaCargo: trilha.marca_cargo      || 'Fundador, F&G Seguro Garantia',
    assinatura: trilha.assinatura_linha || 'Corretora especialista em Seguro Garantia',
    telefone:   trilha.contato_telefone || '(15) 99861-8659',
    site:       trilha.contato_site     || 'fegsegurogarantia.com.br',
    tema:       trilha.tema ?? null,
  });"""


# ─────────────────────────────────────────────────────────────────────────────
# 5. os dois selects de email_trilhas
# ─────────────────────────────────────────────────────────────────────────────

DE_5 = ".select('slug, nome, eyebrow, rodape')"
PARA_5 = (".select('slug, nome, eyebrow, rodape, assinatura_linha, marca_nome, "
          "marca_cargo, contato_telefone, contato_site, contato_whatsapp, tema')")
VEZES_5 = 2


# ─────────────────────────────────────────────────────────────────────────────
# 6. nome do remetente por trilha
# ─────────────────────────────────────────────────────────────────────────────

DE_6A = "async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {"
PARA_6A = ("async function sendEmail(to: string, subject: string, html: string,\n"
           "                         remetente = 'F&G Seguro Garantia'): Promise<boolean> {")

DE_6B = "body: JSON.stringify({ from: `F&G Seguro Garantia <${FROM_EMAIL}>`, to: [to], bcc: [BCC_EMAIL], subject, html }),"
PARA_6B = "body: JSON.stringify({ from: `${remetente} <${FROM_EMAIL}>`, to: [to], bcc: [BCC_EMAIL], subject, html }),"

DE_6C = "const ok = await sendEmail(c.email, assunto, html);"
PARA_6C = "const ok = await sendEmail(c.email, assunto, html, trilha.marca_nome);"
VEZES_6C = 2

DE_6D = "const ok = await sendEmail(para, `[TESTE ${m.ordem}] ${m.assunto}`, m.html);"
PARA_6D = "const ok = await sendEmail(para, `[TESTE ${m.ordem}] ${m.assunto}`, m.html, trilha.marca_nome);"


def trocar(texto, de, para, vezes=1, rotulo=''):
    achou = texto.count(de)
    if achou != vezes:
        print(f'PAROU em {rotulo}: esperava {vezes} ocorrência(s), achei {achou}.')
        print('Nada foi gravado. O arquivo provavelmente já mudou desde que')
        print('este patch foi escrito. Confira a seção 7 do HUB-SAUDE-FASE1.md.')
        sys.exit(1)
    print(f'  ok  {rotulo}')
    return texto.replace(de, para)


def trocar_bloco(texto, inicio, fim, para, rotulo):
    i = texto.find(inicio)
    if i < 0:
        print(f'PAROU em {rotulo}: não achei o início do bloco. Nada gravado.')
        sys.exit(1)
    j = texto.find(fim, i)
    if j < 0:
        print(f'PAROU em {rotulo}: não achei o fim do bloco. Nada gravado.')
        sys.exit(1)
    if texto.find(inicio, i + 1) >= 0:
        print(f'PAROU em {rotulo}: o início do bloco aparece mais de uma vez.')
        sys.exit(1)
    print(f'  ok  {rotulo}')
    return texto[:i] + para + texto[j + len(fim):]


def main():
    if not os.path.exists(ALVO):
        print(f'Não achei {ALVO}.')
        print('Rode este script na raiz do repositório do hub.')
        sys.exit(1)

    with io.open(ALVO, encoding='utf-8') as f:
        src = f.read()

    if MARCA_JA_APLICADO in src:
        print('O patch já está aplicado neste arquivo. Nada a fazer.')
        sys.exit(0)

    print('Aplicando:')
    src = trocar(src, DE_1, PARA_1, 1, 'interface Trilha')
    src = trocar(src, DE_2, PARA_2, 1, 'assinatura de molde()')
    src = trocar_bloco(src, DE_3_INICIO, DE_3_FIM, PARA_3, 'corpo do molde()')
    src = trocar(src, DE_4, PARA_4, 1, 'montarEmail()')
    src = trocar(src, DE_5, PARA_5, VEZES_5, 'os dois selects de email_trilhas')
    src = trocar(src, DE_6A, PARA_6A, 1, 'sendEmail() recebe o remetente')
    src = trocar(src, DE_6B, PARA_6B, 1, 'sendEmail() usa o remetente')
    src = trocar(src, DE_6C, PARA_6C, VEZES_6C, 'envio imediato e cron')
    src = trocar(src, DE_6D, PARA_6D, 1, 'modo teste')

    with io.open(ALVO, 'w', encoding='utf-8') as f:
        f.write(src)

    print()
    print(f'Gravado: {ALVO}')
    print('Agora rode: supabase functions deploy prospecting-cadence')
    print('E confira os dois previews descritos no topo deste arquivo.')


if __name__ == '__main__':
    main()
