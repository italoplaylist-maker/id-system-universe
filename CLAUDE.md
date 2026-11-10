@AGENTS.md

## Banco de dados (Prisma): toda mudança no schema leva migração

Se você editar `prisma/schema.prisma` (coluna, tabela, índice, relação), **crie a migração no mesmo commit**
(`npx prisma migrate dev --name <o_que_mudou>` com um banco de desenvolvimento, e commite a pasta nova em `prisma/migrations/`).
Sem a migração o código novo consulta colunas que o banco de produção não tem e as telas quebram (já aconteceu com os agentes).
O teste `tests/schema-drift.test.ts` falha se o schema e as migrações divergirem. O entrypoint do Docker aplica as migrações na subida.

