import { toolsMutation } from "@/server/orchestrator/tools-route";
import { saveSkill } from "@/server/orchestrator/tools-config";
import { readJson } from "@/server/http/api-helpers";

export async function POST(request: Request) {
  const body = await readJson(request);
  return toolsMutation(true, "skill", () => saveSkill(body));
}
