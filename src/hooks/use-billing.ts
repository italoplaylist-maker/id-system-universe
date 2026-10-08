"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { BillingSummary, ChargeDetail, ChargeListItem } from "@/server/billing/charge-service";
import type { RecurrenceListItem } from "@/server/billing/recurrence-service";
import type { ClientDetail, ClientView } from "@/server/billing/client-service";
import type { WhatsAppMessageItem } from "@/server/billing/messages";
import type { ReminderRuleInput } from "@/lib/billing-defaults";

export interface ChargeQuery {
  view?: string;
  status?: string;
  clientId?: string;
  projectId?: string;
  recurrent?: boolean;
  dueFrom?: string;
  dueTo?: string;
  q?: string;
}

function toQuery(query: ChargeQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["billing"] });
}

export function useBillingSummary(query: ChargeQuery = {}, enabled = true) {
  return useQuery({
    queryKey: ["billing", "summary", query],
    queryFn: () => apiFetch<{ summary: BillingSummary }>(`/api/billing/summary${toQuery(query)}`),
    select: (data) => data.summary,
    enabled,
    refetchInterval: 60_000,
  });
}

/** Só contagens agregadas — é o que o 3D pode exibir. */
export function useBillingCounts(enabled: boolean) {
  return useQuery({
    queryKey: ["billing", "counts"],
    queryFn: () => apiFetch<{ counts: { pending: number; overdue: number; dueToday: number } }>("/api/billing/counts"),
    select: (data) => data.counts,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useCharges(query: ChargeQuery = {}, enabled = true) {
  return useQuery({
    queryKey: ["billing", "charges", query],
    queryFn: () => apiFetch<{ items: ChargeListItem[]; total: number }>(`/api/billing/charges${toQuery(query)}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useChargeDetail(id: string | null) {
  return useQuery({
    queryKey: ["billing", "charge", id],
    queryFn: () => apiFetch<{ charge: ChargeDetail }>(`/api/billing/charges/${id}`),
    select: (data) => data.charge,
    enabled: Boolean(id),
  });
}

export interface ChargeInput {
  clientId: string;
  projectId?: string | null;
  reasonId?: string | null;
  reasonName?: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  notes?: string | null;
  whatsappEnabled: boolean;
  rules: ReminderRuleInput[];
  recurrence?: { period: string; intervalDays?: number | null; dueDay?: number | null; endDate?: string | null };
}

export function useCreateCharge() {
  const invalidate = useInvalidateBilling();
  return useMutation({ mutationFn: (input: ChargeInput) => apiFetch("/api/billing/charges", { method: "POST", body: JSON.stringify(input) }), onSuccess: invalidate });
}

export function useUpdateCharge(id: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (input: Partial<Omit<ChargeInput, "clientId" | "recurrence">>) => apiFetch(`/api/billing/charges/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useChargeAction(id: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: ({ action, body }: { action: "pay" | "reverse" | "cancel"; body?: Record<string, unknown> }) =>
      apiFetch(`/api/billing/charges/${id}/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    onSuccess: invalidate,
  });
}

export function useChargePreview() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ preview: { phone: string | null; body: string; direction: string } }>(`/api/billing/charges/${id}/send`, { method: "POST", body: JSON.stringify({ confirm: false }) }),
  });
}

export function useChargeSend() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: ({ id, message }: { id: string; message?: string }) =>
      apiFetch<{ result: { status: "SENT" | "FAILED"; error?: string } }>(`/api/billing/charges/${id}/send`, { method: "POST", body: JSON.stringify({ confirm: true, message }) }),
    onSuccess: invalidate,
  });
}

export function useRecurrences(enabled = true) {
  return useQuery({
    queryKey: ["billing", "recurrences"],
    queryFn: () => apiFetch<{ recurrences: RecurrenceListItem[] }>("/api/billing/recurrences"),
    select: (data) => data.recurrences,
    enabled,
  });
}

export function useRecurrenceStatus() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "PAUSE" | "RESUME" | "END" }) =>
      apiFetch(`/api/billing/recurrences/${id}/status`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: invalidate,
  });
}

export function useReasons() {
  return useQuery({
    queryKey: ["billing", "reasons"],
    queryFn: () => apiFetch<{ reasons: { id: string; name: string }[] }>("/api/billing/reasons"),
    select: (data) => data.reasons,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ["billing", "templates"],
    queryFn: () => apiFetch<{ templates: Record<"BEFORE" | "ON" | "AFTER", string> }>("/api/billing/templates"),
    select: (data) => data.templates,
  });
}

export function useUpdateTemplate() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (input: { kind: "BEFORE" | "ON" | "AFTER"; body: string }) => apiFetch("/api/billing/templates", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useTemplatePreview() {
  return useMutation({ mutationFn: (body: string) => apiFetch<{ preview: string }>("/api/billing/templates/preview", { method: "POST", body: JSON.stringify({ body }) }) });
}

export function useWhatsAppHistory(status?: string) {
  return useQuery({
    queryKey: ["billing", "messages", status],
    queryFn: () => apiFetch<{ messages: WhatsAppMessageItem[] }>(`/api/billing/messages${status ? `?status=${status}` : ""}`),
    select: (data) => data.messages,
    refetchInterval: 30_000,
  });
}

export function useClients(enabled = true) {
  return useQuery({
    queryKey: ["billing", "clients"],
    queryFn: () => apiFetch<{ clients: ClientView[] }>("/api/clients"),
    select: (data) => data.clients,
    enabled,
  });
}

export function useClientDetail(id: string | null) {
  return useQuery({
    queryKey: ["billing", "client", id],
    queryFn: () => apiFetch<{ client: ClientDetail }>(`/api/clients/${id}`),
    select: (data) => data.client,
    enabled: Boolean(id),
  });
}

export interface ClientInput {
  name: string;
  tradeName?: string | null;
  document?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
  projectIds?: string[];
}

export function useCreateClient() {
  const invalidate = useInvalidateBilling();
  return useMutation({ mutationFn: (input: ClientInput) => apiFetch("/api/clients", { method: "POST", body: JSON.stringify(input) }), onSuccess: invalidate });
}

export function useUpdateClient(id: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({ mutationFn: (input: ClientInput) => apiFetch(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(input) }), onSuccess: invalidate });
}
