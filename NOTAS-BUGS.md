# Notas de bugs (30/08/2026)

Anotados durante a revisão de design. **Ambos resolvidos em 30/08/2026 na branch `bugs-agosto`.**

## 1. 400 em `whatsapp_leads?bot_active=eq.false` — RESOLVIDO

A coluna `bot_active` nunca existiu (a tabela nasceu fora do histórico de migrações), então o badge de WhatsApp do sidebar e o CommandCenter recebiam 400 a cada consulta. Migração `042_whatsapp_leads_bot_active.sql` criada e **já aplicada em produção** (default `true` = bot atendendo; a automação marca `false` ao transferir para humano). Commit `b207720`, merge `ba27d32` na main.

## Pendente

- n8n deve marcar `bot_active = false` em `whatsapp_leads` ao transferir a conversa para humano; até lá o badge do WhatsApp Hub fica em zero.

## 2. Menu "Cotações" comentado deixava telas órfãs — RESOLVIDO

O submenu Cotações (Seguro Licitante / Seguro de Contrato) voltou ao sidebar, restaurando o caminho de navegação das duas telas. Commit `c6a5be7`.
