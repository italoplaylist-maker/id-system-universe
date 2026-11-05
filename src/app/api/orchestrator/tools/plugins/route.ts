import { toolsMutation } from "@/server/orchestrator/tools-route";
import { pluginAction } from "@/server/orchestrator/tools-config";
import { readJson } from "@/server/http/api-helpers";

export const maxDuration = 130;

export async function POST(request: Request) {
  const body = await readJson(request);
  return toolsMutation(true, "plugin", async () => ({ output: await pluginAction(body) }));
}
