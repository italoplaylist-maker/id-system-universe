-- Dados: usuários OPERATOR/VIEWER existentes enxergavam todos os Projects antes
-- do controle por projeto. Preserva esse comportamento concedendo acesso aos
-- Projects atuais (novos Projects exigem concessão explícita).
INSERT INTO "ProjectAccess" ("id", "userId", "projectId")
SELECT 'pa_' || md5(u."id" || p."id"), u."id", p."id"
FROM "User" u
CROSS JOIN "Project" p
WHERE u."role" IN ('OPERATOR', 'VIEWER')
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- O admin mais antigo (o do bootstrap) vira SUPERADMIN, para que alguém possua
-- acesso global a financeiro/integrações logo após a migração.
UPDATE "User" SET "role" = 'SUPERADMIN'
WHERE "id" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'SUPERADMIN');

-- Templates padrão da régua de cobrança.
INSERT INTO "BillingTemplate" ("kind", "body", "updatedAt") VALUES
('BEFORE', E'Olá, {{cliente}}! Tudo bem?\n\nPassando para lembrar que a cobrança referente a {{motivo}}, no valor de {{valor}}, vence em {{vencimento}}.\n\nSe o pagamento já foi realizado, por favor desconsidere esta mensagem.\n\nID System', now()),
('ON', E'Olá, {{cliente}}!\n\nA cobrança referente a {{motivo}}, no valor de {{valor}}, vence hoje ({{vencimento}}).\n\nSe já realizou o pagamento, pode desconsiderar esta mensagem.\n\nID System', now()),
('AFTER', E'Olá, {{cliente}}!\n\nIdentificamos que a cobrança referente a {{motivo}}, no valor de {{valor}}, com vencimento em {{vencimento}}, ainda consta como pendente.\n\nCaso já tenha realizado o pagamento, desconsidere esta mensagem.\n\nID System', now())
ON CONFLICT ("kind") DO NOTHING;

-- Motivos de cobrança padrão.
INSERT INTO "BillingReason" ("id", "name") VALUES
('br_mensalidade','Mensalidade'),('br_manutencao','Manutenção'),('br_hospedagem','Hospedagem'),
('br_desenvolvimento','Desenvolvimento'),('br_suporte','Suporte'),('br_licenca','Licença'),
('br_implantacao','Implantação'),('br_servico_adicional','Serviço adicional'),('br_outro','Outro')
ON CONFLICT ("name") DO NOTHING;
