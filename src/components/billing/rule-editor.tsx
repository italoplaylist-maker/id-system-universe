"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeRule, type ReminderRuleInput } from "@/lib/billing-defaults";

/** Régua de cobrança: caixas para cada aviso + "Adicionar aviso" com antes/depois, dias e horário. */
export function RuleEditor({ rules, onChange }: { rules: ReminderRuleInput[]; onChange: (rules: ReminderRuleInput[]) => void }) {
  function patch(index: number, change: Partial<ReminderRuleInput>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)));
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Régua de cobrança (avisos por WhatsApp)</p>
      <div className="space-y-1.5 rounded-md border border-border p-2">
        {rules.length === 0 && <p className="px-1 text-xs text-muted">Nenhum aviso configurado.</p>}
        {rules.map((rule, index) => (
          <div key={`${rule.direction}-${rule.offsetDays}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={rule.enabled} onChange={(e) => patch(index, { enabled: e.target.checked })} aria-label={describeRule(rule)} />
            <Select className="h-8 w-28 text-xs" value={rule.direction} onChange={(e) => patch(index, { direction: e.target.value as ReminderRuleInput["direction"], offsetDays: e.target.value === "ON" ? 0 : Math.max(1, rule.offsetDays) })}>
              <option value="BEFORE">Antes</option>
              <option value="ON">No dia</option>
              <option value="AFTER">Depois</option>
            </Select>
            {rule.direction !== "ON" && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Input className="h-8 w-16 text-xs" type="number" min={1} max={365} value={rule.offsetDays} onChange={(e) => patch(index, { offsetDays: Math.max(1, Number(e.target.value) || 1) })} />
                dia(s)
              </span>
            )}
            <Input className="h-8 w-24 text-xs" type="time" value={rule.sendTime} onChange={(e) => patch(index, { sendTime: e.target.value })} />
            <span className="hidden flex-1 text-xs text-muted sm:inline">{describeRule(rule)}</span>
            <button type="button" className="ml-auto text-muted hover:text-status-error" onClick={() => onChange(rules.filter((_, i) => i !== index))} aria-label="Remover aviso">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rules, { direction: "AFTER", offsetDays: 5, sendTime: "09:00", enabled: true }])}>
        <Plus className="h-3.5 w-3.5" /> Adicionar aviso
      </Button>
    </div>
  );
}
