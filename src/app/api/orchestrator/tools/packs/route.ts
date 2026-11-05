import { toolsMutation } from "@/server/orchestrator/tools-route";
import { installPack } from "@/server/orchestrator/skill-packs";
import { readJson } from "@/server/http/api-helpers";
import { ValidationError } from "@/lib/errors";

export async function POST(request: Request) {
  const body = (await readJson(request)) as { id?: unknown; withMcp?: unknown };
  return toolsMutation(true, "pack", async () => {
    if (typeof body.id !== "string") throw new ValidationError("Informe o kit.");
    await installPack(body.id, { withMcp: body.withMcp === true });
  });
}
