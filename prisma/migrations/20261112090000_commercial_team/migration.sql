-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "keys" TEXT[],
    "name" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'outro',
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foundBy" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NOVO',
    "priority" TEXT,
    "priorityReason" TEXT,
    "productFit" TEXT,
    "painPoints" TEXT,
    "missingInfo" TEXT,
    "conversionNote" TEXT,
    "techNeed" TEXT,
    "discarded" BOOLEAN NOT NULL DEFAULT false,
    "discardReason" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadInteraction" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTRADO',
    "agentName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "LeadInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "features" TEXT NOT NULL,
    "idealSegments" TEXT,
    "commercialNote" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "baseCity" TEXT NOT NULL DEFAULT 'Itatiaiuçu/MG',
    "radiusKm" INTEGER NOT NULL DEFAULT 50,
    "segments" TEXT[],
    "maxNewLeadsPerRun" INTEGER NOT NULL DEFAULT 10,
    "costPerMillionTokens" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_fingerprint_key" ON "Lead"("fingerprint");

-- CreateIndex
CREATE INDEX "Lead_stage_discarded_idx" ON "Lead"("stage", "discarded");

-- CreateIndex
CREATE INDEX "Lead_priority_idx" ON "Lead"("priority");

-- CreateIndex
CREATE INDEX "Lead_updatedAt_idx" ON "Lead"("updatedAt");

-- CreateIndex
CREATE INDEX "LeadInteraction_leadId_createdAt_idx" ON "LeadInteraction"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadInteraction_status_kind_idx" ON "LeadInteraction"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProductProfile_name_key" ON "ProductProfile"("name");

-- AddForeignKey
ALTER TABLE "LeadInteraction" ADD CONSTRAINT "LeadInteraction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ficha comercial dos produtos: o ID Architect passa a mantê-la (só acrescenta se a função ainda não menciona; edições manuais ficam).
UPDATE "AgentProfile" SET "description" = "description" || ' FICHAS COMERCIAIS: a equipe COMERCIAL & MARKETING vende os SaaS e só pode prometer o que existe. Mantenha a ficha de cada produto com descrever_produto (resumo, funcionalidades que existem HOJE verificadas no código, segmentos ideais e limites), atualizando quando um produto mudar.' WHERE "team" = 'CLT' AND "slug" = 'id-architect' AND "description" NOT LIKE '%descrever_produto%';
