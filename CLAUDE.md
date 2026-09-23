# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Este projeto e seus usuários são brasileiros. Escreva comentários, textos de UI, mensagens de commit e respostas em **português (pt-BR)**. O domínio é seguro-garantia e licitações públicas brasileiras (Lei 14.133/2021, Lei 8.666/93, Lei 10.520/02).

## Comandos

```bash
npm install       # instala dependências
npm run dev       # dev server em http://localhost:3000 (host 0.0.0.0)
npm run build     # build de produção (Vite) → dist/
npm run preview   # serve o build de produção localmente
```

Não há suíte de testes nem linter configurados — não existe `npm test`/`npm run lint`.

### Deploy

O deploy é feito por **git push** (hospedado no Netlify/Hostinger via `origin`, branch `main`). Os scripts `deploy.sh` (macOS/Linux) e `deploy.bat` (Windows) apenas fazem `git add . && git commit && git push`. Só faça commit/push quando o usuário pedir.

### Supabase Edge Functions

As functions em `supabase/functions/*` são deployadas pela CLI do Supabase (não pelo git):

```bash
supabase functions deploy <nome>    # ex: chat-assistant, analyze-edital
```

Rodam em **Deno** (não Node) e leem segredos via `Deno.env.get(...)` — configurados no dashboard do Supabase, nunca no `.env` local.

## Arquitetura

App interno ("Hub") de uma corretora de seguros (FEG Seguro Garantia). SPA em **React 19 + TypeScript + Vite**, com **Supabase** como backend (Postgres + Auth + Edge Functions). Sem framework de estado global — estado vive em `useState` e os dados vêm direto do Supabase client.

### Fluxo de entrada e navegação

- `index.tsx` — monta o React em `BrowserRouter` com só **duas rotas**: `/formulario-residencial` (formulário público, sem auth, `ResidentialPublicForm`) e `*` → `App`.
- `App.tsx` (≈900 linhas) — é o shell e o **router de verdade**. Não usa react-router para as telas internas: mantém `activeView` (union type `View`) num `useState` e faz switch com `activeView === '...'` para renderizar cada componente de `components/`. O sidebar agrupa as views por linha de produto (`GARANTIA_VIEWS`, `AUTO_VIEWS`, `RESIDENCIAL_VIEWS`, `RC_VIEWS`, `FINANCEIRO_VIEWS`). Ao adicionar uma tela nova: adicione o literal ao type `View`, um título em `VIEW_TITLES`, o item ao array do grupo, e o bloco de render.
- `ResultsDashboard` é reaproveitado por várias views (`goals`, `carteira`, `prospeccao`, `pnpc`, `seg-licitante`, `seg-contrato`, `metas-mensais`, `metas-anuais`) via props `initialSection`/`hideTabs`.
- Auth: `components/Auth.tsx` via Supabase Auth. O e-mail `fabio@fegsegurogarantia.com.br` é tratado como admin (checagem hardcoded em `App.tsx`, ex.: aba de usuários).

### Camadas

- `lib/supabase.ts` — cliente Supabase único e compartilhado. **Atenção:** URL e anon key estão hardcoded neste arquivo (não em env). A anon key é pública por design; a segurança real depende das políticas **RLS** no Postgres.
- `types.ts` — todas as interfaces de domínio (`Insurer`, `Sale`, `Seller`, `Prospect`, `CRMTask`, `Pendencia`, etc.). Note campos duplicados/legados propositais (ex.: `premioMinimo`/`premio_minimo`, `vigencia_fim`/`fim_vigencia`) por causa de nomes divergentes entre tabelas — leia os comentários antes de "corrigir".
- `utils/` — helpers puros: `formatters.ts` (BRL, datas), `whatsapp.ts`, `emailTemplates.ts`, `publicUrls.ts`.
- `lib/analysisContext.ts` — singleton em módulo (variáveis de módulo, não Context do React) que faz a ponte entre os analisadores (`ContratoAnalyzer`/`LicitanteAnalyzer`) e o `ChatWidget`, permitindo o chat ler/atualizar a análise atual.
- `components/` — uma tela por arquivo, correspondendo às views. Componentes são grandes e autossuficientes (buscam os próprios dados do Supabase).

### Backend (Supabase)

- **Migrations**: `supabase/*.sql`, numeradas (`000_…` a `018_…`). São o histórico de schema — ao mudar o banco, adicione uma nova migração numerada em vez de editar as antigas.

- **Toda migração que cria tabela no schema `public` PRECISA conceder os grants na mesma migração.** A partir de 30/10/2026 o Supabase parou de expor tabelas novas à Data API automaticamente: sem grant, a tabela existe no banco mas `supabase-js`, PostgREST e as Edge Functions respondem *permission denied*, inclusive com a service role. Tabelas criadas antes dessa data mantêm os grants que já tinham e não precisam de nada. O bloco, logo depois do `create table`:

  ```sql
  alter table public.minha_tabela enable row level security;

  grant select, insert, update, delete on table public.minha_tabela to authenticated;
  grant select, insert, update, delete on table public.minha_tabela to service_role;
  -- só se a tabela precisar mesmo ser lida sem login (portal público):
  -- grant select on table public.minha_tabela to anon;
  ```

  O grant abre a porta; quem decide quais linhas cada um enxerga continua sendo a **RLS**. Os dois andam juntos: grant sem RLS expõe tudo, RLS sem grant não deixa ninguém entrar. Se a tabela usa sequence (`serial`/`bigserial`), vai junto `grant usage, select on sequence public.minha_tabela_id_seq to authenticated, service_role;`.
- **Edge Functions** (`supabase/functions/`, Deno): IA e automações.
  - `chat-assistant`, `analyze-edital`, `analyze-contrato`, `validate-minuta` — usam a **API da Anthropic (Claude)** via `ANTHROPIC_API_KEY` (fetch para `api.anthropic.com/v1/messages`).
  - `remind-stale-sales`, `pregao-reminders`, `send-thank-you`, `send-draft-approval`, `send-limits` — notificações/e-mails.
- **Jobs agendados**: `.github/workflows/daily-stale-sales-reminder.yml` chama, via cron (10:00 UTC = 07:00 BRT), as functions `remind-stale-sales` e `pregao-reminders` por `curl`, usando os secrets `SUPABASE_URL`/`SUPABASE_ANON_KEY` do GitHub.

### IA — dois provedores

- **Frontend** usa **Gemini**: `vite.config.ts` injeta `GEMINI_API_KEY` (de `.env.local`) como `process.env.API_KEY` no bundle.
- **Edge Functions** usam **Claude/Anthropic** (`ANTHROPIC_API_KEY` no ambiente do Supabase).

Ao mexer em código de IA, confira qual das duas camadas você está editando e qual provedor ela usa.

### Config notável

- Alias `@` → raiz do projeto (`vite.config.ts` e `tsconfig.json`). Importações usam extensão `.ts`/`.tsx` explícita (`allowImportingTsExtensions`).
- `tsconfig` tem `noEmit` — o TypeScript só faz type-check; o Vite faz o build. Não há step de `tsc` separado.
- `.env.local` (git-ignorado) traz também tokens de proxies PNCP / Empresas Aqui (`VITE_PROXY_PNCP_URL`, `VITE_PROXY_EQ_URL`, `VITE_EMPRESAQUI_TOKEN`) usados na prospecção. Reinicie o Vite após alterar o `.env`.

### Tailwind e tokens de design

O Tailwind é compilado no build (`tailwind.config.js` + `postcss.config.js`), entrando pelo `index.css`, que é importado no `index.tsx`. Antes era carregado pelo CDN e compilado no navegador; se aparecer `<script src="https://cdn.tailwindcss.com">` em algum HTML do app, é resíduo.

**Diferença que importa:** o CDN lia as classes da tela em tempo de execução, então classe montada dinamicamente funcionava. O build lê do código-fonte, então **nunca monte nome de classe por interpolação** (`bg-[${cor}]`, `text-${status}-500`). Escreva a classe inteira nos dois ramos do ternário. Hoje o projeto não tem nenhum caso desses e vale manter assim.

Cor, sombra e duração ficam em `tailwind.config.js`, que é o lugar único desses tokens:

- `navy` (`#1B263B`), `navy-light` (`#243447`) e `navy-dark` (`#162033`)
- `gold` (`#C69C6D`), `gold-hover` (`#B58A5B`) e `gold-dark` (`#8B6C3E`, dourado legível como texto em fundo claro)
- `areia` (`#F5F1EA`), `areia-clara` (`#F8F4ED`), `areia-escura` (`#EFE7DB`) e `linha` (`#E8E4DC`)
- `whatsapp` (`#25D366`), `whatsapp-hover` e `whatsapp-bolha`

Use `bg-navy`, `text-gold`, `hover:bg-gold-hover` em vez de repetir o hexadecimal. Hexadecimal solto só é aceitável fora de classe do Tailwind, como em `style` inline, SVG e cor de gráfico.

**Semântica de cor (regra fixa, não misturar):**

- **gold é identidade, nunca estado** — não usar para sucesso, alerta ou erro;
- **amber é alerta, nunca decoração**;
- **rose é erro/destrutivo** — não existe `red-*` no app; se aparecer, é regressão;
- **emerald é sucesso** — não usar `green-*`;
- **blue é informação/condicional**;
- **whatsapp só para UI que representa o WhatsApp de fato** (hub de conversas, links wa.me, bolha de chat) — botão de e-mail nunca é verde.

Cores categóricas de dados (badges de tipo de produto, etiquetas de urgência do Repasse, paletas escolhíveis de cartão/coluna) ficam fora dessa regra por serem legenda, não estado.

O plugin `tailwindcss-animate` fornece `animate-in`, `slide-in-from-*`, `zoom-in-*` e `fade-in-*`.

**Atenção à escala global:** o `index.css` define `html { font-size: 80% }` para o hub ficar equivalente a um zoom de 80%. Isso significa que **1rem vale 12,8px e não 16px**, e que todo espaçamento em `rem` (`p-4`, `gap-6`, `w-80`, `text-xl`) já vem reduzido. Os tamanhos em px arbitrário (`text-[10px]` e irmãos) têm override explícito com `!important` no mesmo arquivo para acompanhar a escala. Ao criar componente novo, lembre que o espaçamento vai parecer menor do que o número sugere. É intencional e foi mantido de propósito; se um dia for removido, o hub inteiro precisa ser reescalado junto.

Os portais públicos em `public/*.html` **não usam Tailwind**. São HTML e CSS puro, com os tokens declarados em `:root` dentro de cada arquivo.

## Módulo Radar (PGFN)

Prospecção de seguro garantia judicial a partir da base pública de devedores da PGFN. Leia `docs/radar/README.md` antes de mexer: o módulo tem peças que precisam andar juntas. Fase 1: a migração `supabase/075_radar_fase1.sql` (tabelas `radar_*`, score, consolidação e cron), o script local `scripts/radar/pgfn_ingest.py` (roda no Mac, numa venv, com a service role no `.env`) e a Edge Function `radar-enrich-cnpj` (BrasilAPI, de hora em hora). Fase 2 (PJe TRF3): a migração `supabase/079_radar_fase2_pje.sql` (fila `radar_pje_fila`, `radar_processos`, movimentações, advogados, `vw_radar_advogados`, dossiê e score v3) e o worker `scripts/radar/pje_worker.py`, Playwright em Python com o Chrome real, que consulta a consulta pública do PJe em ritmo humano (20 s entre requisições, 5 min entre empresas, 60 por dia) porque o site está atrás do Akamai. **Nunca** use fetch/XHR direto contra o PJe nem navegue direto para a URL do detalhe: bloqueia o IP. O worker roda como LaunchAgent (`scripts/radar/install_launchd.sh`). A tela fica em `src/views/Radar/` (views `radar` e `radar-advogados` do `App.tsx`), única pasta fora de `components/`; por isso o `content` do Tailwind inclui `src/`. Decisões que fogem da especificação estão em `docs/radar/DECISOES.md`. Fase 3 (Datajud) não começou.
