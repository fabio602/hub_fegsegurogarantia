-- ============================================================================
-- Os modelos do Follow-up de E-mail viram conteúdo de banco, não código.
--
-- Antes: os três textos (aviso de vencimento, apresentação e retomada de
-- contato) estavam escritos dentro da Edge Function `email-followup`. Mudar
-- uma vírgula exigia abrir o arquivo, editar e rodar um deploy.
--
-- Agora, mesma divisão que já vale para as trilhas de prospecção: o molde
-- visual da F&G (cartão branco, logo, cores, rodapé) continua no código, em um
-- lugar só; o que muda de e-mail para e-mail (assunto, título, corpo, botão)
-- vira linha de tabela e é editado pela tela do hub.
--
-- Os textos abaixo são cópia exata do que a função enviava até aqui. Aplicar
-- esta migração não muda nenhum e-mail; só muda de onde ele vem.
--
-- Única exceção, conferida caso a caso: no prospecto SEM empresa cadastrada,
-- onde antes a frase simplesmente pulava o nome ("Identificamos que sua
-- empresa..."), agora entra "sua empresa" no lugar da variável ("Identificamos
-- que a sua empresa..."). Continua correto em português e some assim que a
-- empresa estiver preenchida.
-- ============================================================================

create table if not exists email_modelos (
  -- Casa com o que o hub pede à função: 'renewal', 'prospect_intro',
  -- 'prospect_followup'. Não invente chave nova sem mexer na função.
  chave       text primary key,
  nome        text not null,
  descricao   text,
  assunto     text not null,
  -- Título grande dentro do cartão. Nulo esconde a linha.
  titulo      text,
  corpo_html  text not null,
  -- Botão. Nulo esconde o botão.
  cta_texto   text,
  cta_link    text,
  ativo       boolean not null default true,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table email_modelos is
  'Modelos do Follow-up de E-mail. O visual vem do molde na Edge Function email-followup; aqui fica só o conteúdo.';
comment on column email_modelos.corpo_html is
  'HTML do miolo. Classes disponíveis no molde: .highlight (faixa dourada) e .info (faixa azul).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Variáveis, trocadas pela função na hora do envio:
--
--   [NOME]         nome de quem recebe
--   [PRODUTO]      produto da apólice, ex.: Seguro Garantia
--   [PRODUTO_URL]  o mesmo produto, codificado para caber num link
--   [VENCIMENTO]   data no formato dd/mm/aaaa
--   [DIAS]         já vem escrito por extenso: "1 dia", "12 dias"
--   [EMOJI]        semáforo do prazo: 🔴 até 7 dias, 🟠 até 30, 🟡 acima
--   [SEGURADORA]   nome entre parênteses; some sozinho quando não houver
--   [EMPRESA]      nome da empresa do prospecto; vira "sua empresa" se vazio
-- ─────────────────────────────────────────────────────────────────────────────

insert into email_modelos (chave, nome, descricao, assunto, titulo, corpo_html, cta_texto, cta_link, ordem) values
(
  'renewal',
  'Aviso de vencimento',
  'Enviado pela aba Vencimentos, para o cliente cuja apólice está perto de vencer.',
  '[EMOJI] Sua apólice de [PRODUTO] vence em [DIAS] (F&G Corretora)',
  '[EMOJI] Aviso de vencimento: [DIAS]',
  '<p>Olá, <strong>[NOME]</strong>.</p>
<p>Sua apólice de <strong>[PRODUTO]</strong>[SEGURADORA] está se aproximando do vencimento. Queremos garantir que você não fique sem cobertura.</p>
<div class="highlight">
  <strong>📅 Vencimento:</strong> [VENCIMENTO]<br/>
  <strong>⏳ Dias restantes:</strong> [DIAS]
</div>
<p>Entre em contato conosco agora para iniciar a renovação sem burocracia.</p>',
  'Renovar agora via WhatsApp',
  'https://wa.me/5515998618659?text=Ol%C3%A1!%20Preciso%20renovar%20minha%20ap%C3%B3lice%20de%20[PRODUTO_URL].',
  1
),
(
  'prospect_intro',
  'Apresentação',
  'Primeiro contato com um prospecto que ainda não recebeu nada da F&G.',
  '🛡️ Seguro Garantia para [EMPRESA] (F&G Corretora)',
  '🛡️ Seguro Garantia para [EMPRESA]',
  '<p>Olá, <strong>[NOME]</strong>.</p>
<p>Sou o <strong>Fábio</strong> da <strong>F&amp;G Corretora de Seguros</strong>. Identificamos que a <strong>[EMPRESA]</strong> pode se beneficiar das nossas soluções em <strong>Seguro Garantia</strong>.</p>
<div class="info">
  <strong>O que é o Seguro Garantia?</strong><br/>
  É a alternativa inteligente ao capital bloqueado em garantias contratuais, licitações e processos judiciais. Sua empresa mantém o fluxo de caixa livre e garante as obrigações contratuais com um prêmio acessível.
</div>
<p><strong>✅ Aprovação rápida &nbsp;·&nbsp; Sem burocracia &nbsp;·&nbsp; Melhores seguradoras do mercado</strong></p>',
  'Solicitar apresentação',
  'https://wa.me/5515998618659?text=Ol%C3%A1!%20Gostaria%20de%20saber%20mais%20sobre%20o%20Seguro%20Garantia.',
  2
),
(
  'prospect_followup',
  'Retomada de contato',
  'Segundo toque, para o prospecto que já recebeu a apresentação e não respondeu.',
  '📋 Retomando nosso contato (F&G Corretora)',
  '📋 Retomando nosso contato',
  '<p>Olá, <strong>[NOME]</strong>.</p>
<p>Recentemente entrei em contato sobre nossas soluções em Seguro Garantia e queria saber se surgiu alguma dúvida ou oportunidade em que possamos ajudar a <strong>[EMPRESA]</strong>.</p>
<div class="highlight">
  Estamos prontos para apresentar uma <strong>proposta personalizada</strong> para o seu negócio, sem compromisso.
</div>
<p>Basta me responder este e-mail ou chamar no WhatsApp. Será um prazer conversar!</p>',
  'Falar pelo WhatsApp',
  'https://wa.me/5515998618659?text=Ol%C3%A1%20F%C3%A1bio!%20Gostaria%20de%20retomar%20nossa%20conversa%20sobre%20Seguro%20Garantia.',
  3
)
on conflict (chave) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Acesso: mesma regra das trilhas. Quem está logado no hub edita; a Edge
-- Function lê com a service role e passa por cima da política.
-- ─────────────────────────────────────────────────────────────────────────────
alter table email_modelos enable row level security;

drop policy if exists email_modelos_auth on email_modelos;
create policy email_modelos_auth on email_modelos for all to authenticated using (true) with check (true);
