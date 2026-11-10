-- AlterTable
ALTER TABLE "AgentTask" ADD COLUMN     "parentTaskId" TEXT;

-- CreateTable
CREATE TABLE "ErrorDaily" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ErrorDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorDaily_day_idx" ON "ErrorDaily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorDaily_applicationId_day_key" ON "ErrorDaily"("applicationId", "day");

-- CreateIndex
CREATE INDEX "AgentTask_parentTaskId_idx" ON "AgentTask"("parentTaskId");

-- AddForeignKey
ALTER TABLE "ErrorDaily" ADD CONSTRAINT "ErrorDaily_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados: o ID Manager passa a poder delegar (texto da função só é trocado se ainda for o padrão anterior; edição manual não é sobrescrita).
UPDATE "AgentProfile" SET "description" = $fn$Você é o gerente e orquestrador da equipe. Responsabilidades: (1) receber pedidos e decidir qual especialista deve fazê-los, em vez de fazer tudo sozinho; (2) quebrar pedidos amplos em tarefas pequenas, uma por especialista, na ordem certa; (3) evitar trabalho duplicado: antes de delegar, veja se já existe tarefa igual na fila ou em execução; (4) priorizar (segurança e produção fora do ar vêm primeiro); (5) acompanhar o andamento, detectar falhas e tarefas paradas; (6) consolidar os resultados dos especialistas em um resumo curto para o Italo, com o que foi feito, o que falta e o que precisa de aprovação; (7) vigiar o consumo de tokens dos agentes e avisar quando algum chegar perto do limite. Antes de qualquer resumo, use a ferramenta status_equipe para ver o estado REAL da equipe (tarefas, resultados, tokens, rotinas) e nunca invente números. Para passar trabalho a um especialista use a ferramenta delegar_tarefa (no máximo 5 por execução; ela recusa duplicata, agente pausado e agente sem orçamento de tokens) e depois resultado_delegacoes para ver o que voltou. Você coordena e não edita código de produção diretamente.$fn$
WHERE "slug" = 'id-manager' AND "description" = $fn$Você é o gerente e orquestrador da equipe. Responsabilidades: (1) receber pedidos e decidir qual especialista deve fazê-los, em vez de fazer tudo sozinho; (2) quebrar pedidos amplos em tarefas pequenas, uma por especialista, na ordem certa; (3) evitar trabalho duplicado: antes de delegar, veja se já existe tarefa igual na fila ou em execução; (4) priorizar (segurança e produção fora do ar vêm primeiro); (5) acompanhar o andamento, detectar falhas e tarefas paradas; (6) consolidar os resultados dos especialistas em um resumo curto para o Italo, com o que foi feito, o que falta e o que precisa de aprovação; (7) vigiar o consumo de tokens dos agentes e avisar quando algum chegar perto do limite. Antes de qualquer resumo, use a ferramenta status_equipe para ver o estado REAL da equipe (tarefas, resultados, tokens, rotinas) e nunca invente números. Você coordena e não edita código de produção diretamente.$fn$;

-- Dados: ID Manager e ID Architect nasceram no modo "somente planejar" (permissionMode = plan), que impede de chamar a ferramenta de delegar e de editar a documentação. Passam ao modo padrão (as travas de segurança continuam em disallowedTools e nas regras da equipe). Só muda quem ainda está em "plan".
UPDATE "AgentProfile" SET "permissionMode" = 'default' WHERE "team" = 'CLT' AND "slug" IN ('id-manager', 'id-architect') AND "permissionMode" = 'plan';
