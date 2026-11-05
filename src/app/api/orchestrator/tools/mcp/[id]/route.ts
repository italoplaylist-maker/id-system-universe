import { toolsMutation } from "@/server/orchestrator/tools-route";
import { deleteMcp, setMcpEnabled } from "@/server/orchestrator/tools-config";
import { readJson } from "@/server/http/api-helpers";
import { ValidationError } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await readJson(request)) as { enabled?: unknown };
  return toolsMutation(true, "mcp", async () => {
    if (typeof body.enabled !== "boolean") throw new ValidationError("Informe enabled.");
    await setMcpEnabled(id, body.enabled);
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return toolsMutation(true, "mcp", () => deleteMcp(id));
}
