-- Dobra o teto de tokens dos agentes da equipe CLT, mas SÓ onde o valor ainda é o padrão antigo (quem já mudou à mão não é tocado).
UPDATE "AgentProfile" SET "dailyTokenLimit" = 4000000, "monthlyTokenLimit" = 80000000 WHERE "team" = 'CLT' AND "slug" = 'id-manager' AND "dailyTokenLimit" = 2000000 AND "monthlyTokenLimit" = 40000000;
UPDATE "AgentProfile" SET "dailyTokenLimit" = 5000000, "monthlyTokenLimit" = 100000000 WHERE "team" = 'CLT' AND "slug" = 'id-doctor' AND "dailyTokenLimit" = 2500000 AND "monthlyTokenLimit" = 50000000;
UPDATE "AgentProfile" SET "dailyTokenLimit" = 3000000, "monthlyTokenLimit" = 60000000 WHERE "team" = 'CLT' AND "slug" IN ('id-guardian', 'id-qa', 'id-optimizer', 'id-devops', 'id-architect') AND "dailyTokenLimit" = 1500000 AND "monthlyTokenLimit" = 30000000;
