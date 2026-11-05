import { toolsMutation } from "@/server/orchestrator/tools-route";
import { writeGlobalClaudeMd } from "@/server/orchestrator/tools-config";
import { readJson } from "@/server/http/api-helpers";

export async function PUT(request: Request) {
  const body = (await readJson(request)) as { content?: unknown };
  return toolsMutation(true, "claude-md", () => writeGlobalClaudeMd(body.content));
}
