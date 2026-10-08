import { getConfigs } from "@/server/integrations/config";
import { HQ_LOCATION } from "@/lib/hq-location";

export interface BillingSettings {
  timezone: string;
  windowStart: string;
  windowEnd: string;
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const cfg = await getConfigs(["billing.timezone", "billing.windowStart", "billing.windowEnd"]);
  return {
    timezone: cfg["billing.timezone"] ?? HQ_LOCATION.timezone,
    windowStart: cfg["billing.windowStart"] ?? "08:00",
    windowEnd: cfg["billing.windowEnd"] ?? "18:00",
  };
}
