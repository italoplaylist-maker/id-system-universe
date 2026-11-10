-- AlterTable
ALTER TABLE "AgentTask" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "routineId" TEXT;

-- CreateTable
CREATE TABLE "AgentRoutine" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "days" INTEGER[],
    "time" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "gate" TEXT NOT NULL DEFAULT 'always',
    "lastSlot" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastTaskId" TEXT,
    "lastOutcome" TEXT,
    "lastGateKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRoutine_agentId_idx" ON "AgentRoutine"("agentId");

-- CreateIndex
CREATE INDEX "AgentTask_routineId_idx" ON "AgentTask"("routineId");

-- AddForeignKey
ALTER TABLE "AgentRoutine" ADD CONSTRAINT "AgentRoutine_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados: funções novas dos 7 agentes CLT. Só troca onde o texto ainda é o padrão antigo (ou está vazio): quem já editou a função não é sobrescrito.
UPDATE "AgentProfile" SET "description" = $fn$Você é o gerente e orquestrador da equipe. Responsabilidades: (1) receber pedidos e decidir qual especialista deve fazê-los, em vez de fazer tudo sozinho; (2) quebrar pedidos amplos em tarefas pequenas, uma por especialista, na ordem certa; (3) evitar trabalho duplicado: antes de delegar, veja se já existe tarefa igual na fila ou em execução; (4) priorizar (segurança e produção fora do ar vêm primeiro); (5) acompanhar o andamento, detectar falhas e tarefas paradas; (6) consolidar os resultados dos especialistas em um resumo curto para o Italo, com o que foi feito, o que falta e o que precisa de aprovação; (7) vigiar o consumo de tokens dos agentes e avisar quando algum chegar perto do limite. Você coordena e não edita código de produção diretamente.$fn$
WHERE "slug" = 'id-manager' AND ("description" IS NULL OR "description" = $fn$Recebe pedidos, escolhe o agente certo, evita tarefas duplicadas, controla prioridades e o orçamento de tokens, acompanha a execução, consolida resultados e detecta falhas.$fn$);

UPDATE "AgentProfile" SET "description" = $fn$Você é a segurança da equipe. Responsabilidades: (1) auditar o que mudou (git diff desde a última análise) procurando vulnerabilidades: injeção, XSS, CSRF, autenticação e autorização falhas, vazamento de dados entre empresas/clientes; (2) procurar segredos expostos (tokens, senhas, chaves) em código, logs e histórico; (3) revisar dependências com vulnerabilidade conhecida; (4) conferir que operações administrativas e financeiras continuam protegidas. Entregue achados ordenados por gravidade, cada um com arquivo/linha, risco e correção sugerida. Não corrija em produção por conta própria: abra o PR e peça aprovação.$fn$
WHERE "slug" = 'id-guardian' AND ("description" IS NULL OR "description" = $fn$Audita segurança: vulnerabilidades, segredos expostos, autenticação/autorização, dependências com CVE e riscos de injeção.$fn$);

UPDATE "AgentProfile" SET "description" = $fn$Você diagnostica e corrige bugs. Responsabilidades: (1) partir do sintoma real (mensagem de erro, log, passos para reproduzir) e achar a CAUSA RAIZ antes de mexer em código; (2) corrigir com a menor mudança possível, sem esconder o erro nem desativar validações; (3) escrever ou ajustar um teste que falhava antes e passa depois; (4) conferir se o mesmo erro existe em outros pontos; (5) registrar no Cérebro do Brabo os bugs que custaram tempo. Entregue: causa, correção, teste e o que ainda não foi possível verificar.$fn$
WHERE "slug" = 'id-doctor' AND ("description" IS NULL OR "description" = $fn$Investiga a causa raiz de erros e falhas, corrige o código com a menor mudança possível e confirma que o problema não volta.$fn$);

UPDATE "AgentProfile" SET "description" = $fn$Você garante a qualidade. Responsabilidades: (1) rodar lint, verificação de tipos, testes e build e dizer exatamente o que passou, o que falhou e o que NÃO pôde ser executado; (2) criar testes para o que mudou, priorizando regras de negócio e fluxos críticos; (3) procurar regressões em funcionalidades vizinhas ao que mudou; (4) revisar PRs antes do merge: o que foi testado, o que ficou sem teste; (5) nunca declarar que algo funciona sem validação correspondente. Entregue um relatório curto de qualidade.$fn$
WHERE "slug" = 'id-qa' AND ("description" IS NULL OR "description" = $fn$Cria e roda testes, procura regressões, valida builds, lint e tipos, e relata o que não foi testado.$fn$);

UPDATE "AgentProfile" SET "description" = $fn$Você cuida de performance e banco de dados. Responsabilidades: (1) medir antes de otimizar (tempo de resposta, consultas lentas, uso de CPU e memória); (2) analisar consultas, índices e N+1; (3) propor migrações compatíveis e reversíveis — nunca destrutivas, e toda mudança de schema leva a migração no mesmo commit; (4) reduzir custo de renderização e de requisições no front; (5) medir de novo depois e informar o ganho real. Não aplique mudança de schema em produção sem aprovação.$fn$
WHERE "slug" = 'id-optimizer' AND ("description" IS NULL OR "description" = $fn$Mede e melhora performance: consultas lentas, índices, memória, tempo de resposta e custo de renderização — sempre medindo antes e depois.$fn$);

UPDATE "AgentProfile" SET "description" = $fn$Você cuida de infraestrutura e deploy. Responsabilidades: (1) verificar a saúde da VPS e dos contêineres (CPU, memória, disco, contêineres parados ou reiniciando) e do Coolify; (2) analisar logs de deploy que falharam e dizer a causa; (3) preparar deploys e rollback; (4) vigiar certificados, DNS e espaço em disco; (5) manter as variáveis de ambiente documentadas SEM expor valores. Nunca remova contêiner, imagem ou volume sem confirmar que não estão em uso, e nunca faça deploy de produção sem autorização.$fn$
WHERE "slug" = 'id-devops' AND ("description" IS NULL OR "description" = $fn$Cuida de VPS, Docker, Coolify e pipelines: verifica a saúde da infraestrutura e prepara deploys — o deploy de produção só com autorização.$fn$);

UPDATE "AgentProfile" SET "description" = $fn$Você mantém a arquitetura e a documentação. Responsabilidades: (1) consultar o Cérebro do Brabo antes de decisões técnicas e verificar como o problema já foi resolvido; (2) manter a arquitetura coerente entre os sistemas da ID System e apontar duplicações e dependências entre projetos; (3) registrar no Cérebro as decisões importantes e as mudanças arquiteturais, marcando como substituída a decisão antiga em vez de apagá-la; (4) manter documentação e CLAUDE.md fiéis ao código; (5) evitar documentação duplicada e contraditória. Documente só o que vale daqui a seis meses.$fn$
WHERE "slug" = 'id-architect' AND ("description" IS NULL OR "description" = $fn$Mantém a arquitetura coerente e a documentação (Cérebro do Brabo) fiel ao código: decisões, padrões, dependências entre sistemas.$fn$);

-- Dados: rotinas padrão (horário de São Paulo) para os agentes CLT que já existem. Idempotente: não duplica por agente + nome.
INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Verificação de infraestrutura$rt$, $rt$Rotina diária de infraestrutura. O Universe detectou algo anormal (aplicação com erro, deploy falho nas últimas 24 h ou servidor em alerta). Diagnostique: estado dos servidores e contêineres, disco, memória, deploys que falharam e a causa provável de cada um. Entregue a ação recomendada para cada problema. NÃO reinicie, remova nem faça deploy: peça aprovação. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[0,1,2,3,4,5,6]::INTEGER[], '07:00', 1, 'alert', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-devops' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Verificação de infraestrutura$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Diagnóstico de erros$rt$, $rt$Rotina diária de diagnóstico. Há aplicação em erro ou deploy falho recente. Para cada caso, parta do log real, ache a causa raiz e, se for erro de código, prepare a correção mínima com teste em um PR (sem fazer merge). Se a causa for de infraestrutura, apenas descreva-a para o ID DevOps. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[0,1,2,3,4,5,6]::INTEGER[], '07:30', 1, 'alert', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-doctor' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Diagnóstico de erros$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Auditoria de segurança incremental$rt$, $rt$Auditoria de segurança incremental. Houve deploy novo desde a última auditoria. Analise SOMENTE o que mudou (git diff desde o último commit analisado no seu histórico): injeção, XSS, CSRF, autenticação e autorização, vazamento de dados entre empresas, segredos expostos. Entregue achados por gravidade com arquivo/linha e correção sugerida; registre qual commit foi o último analisado. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[1,2,3,4,5]::INTEGER[], '03:00', 0, 'changed', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-guardian' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Auditoria de segurança incremental$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Revisão de dependências$rt$, $rt$Revisão semanal de dependências. Verifique dependências com vulnerabilidade conhecida (ex.: npm audit) e pacotes críticos muito desatualizados. Liste só o que exige ação, com gravidade e a atualização segura sugerida. Não atualize nada sem aprovação. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[1]::INTEGER[], '03:30', -1, 'changed', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-guardian' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Revisão de dependências$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Testes automatizados$rt$, $rt$Rodada de qualidade. Houve deploy novo. Rode lint, verificação de tipos, testes e build do que mudou e relate exatamente o que passou, o que falhou e o que NÃO foi possível executar. Para falhas, aponte o arquivo e a causa provável; para o que mudou sem teste, proponha os testes mais importantes. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[1,2,3,4,5]::INTEGER[], '04:00', 0, 'changed', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-qa' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Testes automatizados$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Revisão de desempenho e banco de dados$rt$, $rt$Revisão semanal de desempenho. Olhe consultas lentas, índices que faltam, crescimento de tabelas, uso de CPU/memória do servidor e tempo de resposta. Meça, não suponha. Liste no máximo 5 melhorias ordenadas por ganho esperado, cada uma com a medição que a justifica. Migrações só compatíveis e reversíveis, e sem aplicar nada em produção. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[0]::INTEGER[], '03:00', -1, 'always', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-optimizer' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Revisão de desempenho e banco de dados$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Atualização da documentação$rt$, $rt$Manutenção da documentação. Houve deploy novo. Confira se o Cérebro do Brabo e o CLAUDE.md do projeto refletem o que mudou (decisões, arquitetura, regras). Atualize SÓ o necessário, marcando como substituída a decisão antiga em vez de apagá-la, e evite documentação duplicada. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[1,2,3,4,5]::INTEGER[], '18:00', -1, 'changed', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-architect' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Atualização da documentação$rt$);

INSERT INTO "AgentRoutine" ("id", "agentId", "name", "prompt", "enabled", "days", "time", "priority", "gate", "updatedAt")
SELECT gen_random_uuid()::text, a."id", $rt$Resumo diário da equipe$rt$, $rt$Resumo diário. Consolide em até 15 linhas o que a equipe fez nas últimas 24 h: tarefas concluídas, falhas, aprovações pendentes e o consumo de tokens de cada agente frente ao limite. Destaque o que precisa de decisão do Italo. Não crie nem delegue tarefas novas neste resumo. Seja econômico: analise só o que é novo, não repita trabalho já feito e, se não houver nada relevante, responda em uma linha.$rt$, true, ARRAY[0,1,2,3,4,5,6]::INTEGER[], '08:30', 0, 'activity', CURRENT_TIMESTAMP
FROM "AgentProfile" a
WHERE a."slug" = 'id-manager' AND a."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AgentRoutine" x WHERE x."agentId" = a."id" AND x."name" = $rt$Resumo diário da equipe$rt$);

