import { isCivilDate } from "@/lib/civil-date";
import type { ChargeDisplayStatus } from "@/server/billing/charge-status";
import type { ChargeFilters, ChargeView } from "@/server/billing/charge-service";

const VIEWS: ChargeView[] = ["ALL", "TODAY", "UPCOMING", "OVERDUE", "PAID"];
const STATUSES: ChargeDisplayStatus[] = ["PENDENTE", "AGENDADA", "VENCE_HOJE", "VENCIDA", "PAGA", "CANCELADA"];

export function parseChargeFilters(params: URLSearchParams): ChargeFilters {
  const view = params.get("view");
  const status = params.get("status");
  const dueFrom = params.get("dueFrom");
  const dueTo = params.get("dueTo");
  const recurrent = params.get("recurrent");
  const limit = Number(params.get("limit"));
  const offset = Number(params.get("offset"));
  return {
    view: VIEWS.includes(view as ChargeView) ? (view as ChargeView) : undefined,
    status: STATUSES.includes(status as ChargeDisplayStatus) ? (status as ChargeDisplayStatus) : undefined,
    clientId: params.get("clientId") || undefined,
    projectId: params.get("projectId") || undefined,
    recurrent: recurrent === "true" ? true : recurrent === "false" ? false : undefined,
    dueFrom: dueFrom && isCivilDate(dueFrom) ? dueFrom : undefined,
    dueTo: dueTo && isCivilDate(dueTo) ? dueTo : undefined,
    q: params.get("q") || undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    offset: Number.isFinite(offset) && offset > 0 ? offset : undefined,
  };
}
