# Menu de Prospecção: reorganização

Branch: `menu-prospeccao`. Decisões tomadas pelo Fábio em 16/10/2026. Não reabrir.
Escopo: só o menu lateral e os títulos de página em `App.tsx`. Nenhuma tela muda por dentro, nenhum componente é apagado, nada no banco.

## Menu novo (grupo "Prospecção", em `App.tsx`, hoje nas linhas ~596 a 610)

```
Prospecção
  Kanban de Leads            view 'prospeccao'
  ── LICITAÇÕES
  PNCP Automático            view 'pncp-auto'
  ── GARANTIA JUDICIAL FISCAL
  Radar PGFN                 view 'radar'            (ícone Radar, manter)
  Advogados TRF3             view 'radar-advogados'  (ícone Scale, manter)
  ── OUTRAS FONTES
  Garimpo Google Maps        view 'garimpo'
  ── E-MAIL
  Trilhas de E-mail          view 'email-trilhas'
  Contatos nas Trilhas       view 'prospeccao-email'
```

- **Saem do menu:** `pncp-prospeccao` (PNCP manual antigo, grava em `leads_seguro_garantia`) e `pnpc` (iframe do site externo de editais). Os componentes, as entradas do tipo `View` e os blocos de render ficam no código, só sem item no menu. Não apagar arquivos.
- Se `activeView` vier salvo como `pncp-prospeccao` ou `pnpc` (a página lembra a última tela no F5), redirecionar para `prospeccao` ao carregar, para ninguém cair numa tela sem item no menu.

## Rótulos de seção

Criar um componente pequeno `NavSectionLabel` (só texto, não clicável): `text-[9px] font-black tracking-widest uppercase text-slate-500`, `px-4 pt-3 pb-1`. Sem ícone, sem hover. O Kanban fica sozinho no topo, sem rótulo.

## Títulos de página (mapa `VIEW_TITLES` ou equivalente, linhas ~125 a 135)

| view | título novo |
| --- | --- |
| `prospeccao` | Kanban de Leads |
| `pncp-auto` | PNCP Automático |
| `radar` | Radar PGFN |
| `radar-advogados` | Advogados TRF3 |
| `garimpo` | Garimpo Google Maps |
| `email-trilhas` | Trilhas de E-mail |
| `prospeccao-email` | Contatos nas Trilhas |

Trocar também o `<h2>` interno de cada tela só se ele repetir exatamente o nome antigo no topo da página (ex.: "Prospecção Email", "Garimpo Automático", "Prospecção Automática PNCP"). Nada além do texto do título.

## Listas de views do grupo

Atualizar as listas que abrem/destacam o grupo (linhas ~380 e ~599) mantendo os mesmos views ativos; remover `pncp-prospeccao` e `pnpc` delas. Conferir também `GlobalSearch.tsx` e qualquer outro atalho que leve a esses dois views.

## Regras de execução

- Um commit para o menu e rótulos, um para títulos, um para o redirecionamento.
- `git add` arquivo por arquivo; não incluir `deno.lock` nem os .xlsx soltos.
- `npm run build` e `tsc --noEmit` antes de cada commit.
- Push, PR e merge na main ficam com o Claude Code (o push na main publica o HUB).

## Aceite

1. Menu mostra exatamente a ordem acima, com os 4 rótulos de seção.
2. Cada item abre a mesma tela de antes.
3. "Prospecção PNCP" e "PNPC" não aparecem no menu nem na busca global.
4. Recarregar (F5) estando numa tela do grupo mantém a tela e o grupo aberto.
5. Build e tsc limpos.
