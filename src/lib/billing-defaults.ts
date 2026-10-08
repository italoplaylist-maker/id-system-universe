export type ReminderDirectionValue = "BEFORE" | "ON" | "AFTER";

export interface ReminderRuleInput {
  direction: ReminderDirectionValue;
  offsetDays: number;
  sendTime: string;
  template?: string | null;
  enabled: boolean;
}

/** Régua padrão sugerida (as desmarcadas existem na UI como opções). */
export const DEFAULT_REMINDER_RULES: ReminderRuleInput[] = [
  { direction: "BEFORE", offsetDays: 3, sendTime: "09:00", enabled: true },
  { direction: "BEFORE", offsetDays: 1, sendTime: "09:00", enabled: true },
  { direction: "ON", offsetDays: 0, sendTime: "09:00", enabled: true },
  { direction: "AFTER", offsetDays: 1, sendTime: "09:00", enabled: true },
  { direction: "AFTER", offsetDays: 3, sendTime: "09:00", enabled: true },
  { direction: "AFTER", offsetDays: 7, sendTime: "09:00", enabled: false },
];

export function describeRule(rule: Pick<ReminderRuleInput, "direction" | "offsetDays">): string {
  if (rule.direction === "ON") return "No dia do vencimento";
  const unit = rule.offsetDays === 1 ? "dia" : "dias";
  return rule.direction === "BEFORE" ? `${rule.offsetDays} ${unit} antes` : `${rule.offsetDays} ${unit} após o vencimento`;
}

export const RECURRENCE_PERIOD_LABEL = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  CUSTOM: "Personalizada",
} as const;

export const TEMPLATE_VARIABLES = ["cliente", "valor", "vencimento", "motivo", "projeto", "competencia", "diasAtraso"] as const;
