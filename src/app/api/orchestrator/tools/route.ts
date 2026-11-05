import { toolsMutation } from "@/server/orchestrator/tools-route";
import { listMcp, listPlugins, listSkills, readGlobalClaudeMd } from "@/server/orchestrator/tools-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return toolsMutation(false, "overview", async () => {
    const [skills, claudeMd, mcp, plugins] = await Promise.all([listSkills(), readGlobalClaudeMd(), listMcp(), listPlugins().catch(() => ({ installed: [], marketplaces: [] }))]);
    return { skills, claudeMd, mcp, plugins };
  });
}
