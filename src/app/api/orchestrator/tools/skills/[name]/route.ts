import { toolsMutation } from "@/server/orchestrator/tools-route";
import { deleteSkill } from "@/server/orchestrator/tools-config";

export async function DELETE(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return toolsMutation(true, "skill", () => deleteSkill(name));
}
