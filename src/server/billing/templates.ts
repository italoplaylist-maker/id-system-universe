import type { ReminderDirection } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/lib/errors";
import { formatBRL } from "@/lib/money";
import { formatCivilBR, formatCompetence, type CivilDate } from "@/lib/civil-date";
import { TEMPLATE_VARIABLES } from "@/lib/billing-defaults";
import { recordAuditEvent } from "@/server/audit/audit-log";

const MAX_TEMPLATE_LENGTH = 1500;
const MAX_VALUE_LENGTH = 200;
const VARIABLE_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

export interface TemplateVariables {
  cliente: string;
  valor: string;
  vencimento: string;
  motivo: string;
  projeto: string;
  competencia: string;
  diasAtraso: string;
}

/** Valores vindos de cadastro entram como TEXTO: sem controle, sem recursão de {{ }}. */
function sanitizeValue(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\{\{|\}\}/g, "")
    .slice(0, MAX_VALUE_LENGTH);
}

export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const value = (variables as unknown as Record<string, string | undefined>)[name];
    return value === undefined ? "" : sanitizeValue(value);
  });
}

export function validateTemplate(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ValidationError("A mensagem não pode ficar vazia.");
  if (trimmed.length > MAX_TEMPLATE_LENGTH) throw new ValidationError(`A mensagem excede ${MAX_TEMPLATE_LENGTH} caracteres.`);
  const known = new Set<string>(TEMPLATE_VARIABLES);
  for (const match of trimmed.matchAll(VARIABLE_PATTERN)) {
    if (!known.has(match[1])) throw new ValidationError(`Variável desconhecida: {{${match[1]}}}.`);
  }
  return trimmed;
}

export function buildVariables(input: {
  clientName: string;
  amountCents: number;
  dueDate: CivilDate;
  description: string;
  projectName?: string | null;
  competence?: string | null;
  overdueDays: number;
}): TemplateVariables {
  return {
    cliente: input.clientName,
    valor: formatBRL(input.amountCents),
    vencimento: formatCivilBR(input.dueDate),
    motivo: input.description,
    projeto: input.projectName ?? "",
    competencia: formatCompetence(input.competence),
    diasAtraso: String(input.overdueDays),
  };
}

export async function getTemplates(): Promise<Record<ReminderDirection, string>> {
  const rows = await prisma.billingTemplate.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.kind, r.body])) as Partial<Record<ReminderDirection, string>>;
  // Rede de segurança caso o seed da migration tenha sido removido manualmente.
  return {
    BEFORE: map.BEFORE ?? "Olá, {{cliente}}! A cobrança de {{motivo}} ({{valor}}) vence em {{vencimento}}. ID System",
    ON: map.ON ?? "Olá, {{cliente}}! A cobrança de {{motivo}} ({{valor}}) vence hoje ({{vencimento}}). ID System",
    AFTER: map.AFTER ?? "Olá, {{cliente}}! A cobrança de {{motivo}} ({{valor}}), vencida em {{vencimento}}, ainda consta como pendente. ID System",
  };
}

export async function updateTemplate(kind: ReminderDirection, body: string, actor: { userId: string; ip?: string; userAgent?: string }): Promise<void> {
  const valid = validateTemplate(body);
  await prisma.billingTemplate.upsert({ where: { kind }, create: { kind, body: valid }, update: { body: valid } });
  await recordAuditEvent({
    userId: actor.userId,
    action: "BILLING_TEMPLATE_UPDATED",
    status: "SUCCESS",
    entityType: "BillingTemplate",
    entityId: kind,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}
