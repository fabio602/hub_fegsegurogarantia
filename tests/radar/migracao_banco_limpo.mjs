// Aplica a migração 075 num Postgres limpo (PGlite, em memória) e testa a
// consolidação e o score. Não precisa de Docker nem de Supabase local.
//
//   cd <pasta temporária> && npm i @electric-sql/pglite
//   node <raiz do repo>/tests/radar/migracao_banco_limpo.mjs <raiz do repo>
//
// O bloco do cron (pg_cron, pg_net e Vault) fica de fora porque são
// extensões do Supabase; ele é validado direto no projeto real.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const raiz = process.argv[2] ?? process.cwd();
const sql = readFileSync(join(raiz, 'supabase/075_radar_fase1.sql'), 'utf8');
// Banco limpo nao tem pg_cron/pg_net/vault (extensoes do Supabase): o bloco do cron fica de fora.
const semCron = sql.split("select cron.unschedule('radar-enrich-hourly')")[0];
const db = new PGlite();
await db.exec(`create schema auth; create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;`);
await db.exec(semCron);
console.log('migração aplicada em banco limpo (sem o bloco do cron)');
const rls = await db.query(`select relname, relrowsecurity from pg_class where relname like 'radar_%' and relkind='r' order by 1`);
console.log('RLS:', JSON.stringify(rls.rows));
// teste funcional: consolidacao + score
await db.exec(`
insert into radar_ingestoes (competencia, arquivo) values ('202506','teste.csv');
insert into radar_inscricoes (ingestao_id, competencia, cnpj, nome_devedor, uf, numero_inscricao, tipo_situacao, receita_principal, data_inscricao, ajuizado, valor_consolidado) values
 (1,'202506','11111111000111','INDUSTRIA A','SP','A1','BENEFICIO FISCAL','COFINS','2024-01-10',true,4000000),
 (1,'202506','11111111000111','INDUSTRIA A LTDA','SP','A2','GARANTIA','PIS','2025-03-01',true,2000000),
 (1,'202506','11111111000111','INDUSTRIA A','SP','A3','ATIVA','IPI','2022-01-01',true,100),
 (1,'202506','22222222000122','INDUSTRIA B','MG','B1','ATIVA','IPI','2021-06-01',true,350000);
`);
const n = await db.query(`select radar_consolidar_empresas('202506') as n`);
const emp = await db.query(`select cnpj, nome_devedor, uf, qtd_inscricoes, valor_total, tem_garantia, receitas, score from radar_empresas order by cnpj`);
console.log('consolidadas:', n.rows[0].n, JSON.stringify(emp.rows));
// esperado A: garantia 35 + valor 6M 25 + qtd 10 + recente 10 = 80 ; B: 10 (valor) + 0 = 10 (2021-06 > 24 meses atras? hoje 2026-09: nao)
await db.exec(`update radar_empresas set status='excluido' where cnpj='22222222000122'`);
const s = await db.query(`select radar_atualizar_score('22222222000122') as s`);
console.log('score apos excluir:', s.rows[0].s);
const v = await db.query(`select count(*)::int as c from vw_radar_empresas`);
console.log('vw_radar_empresas (sem excluidos):', v.rows[0].c);
