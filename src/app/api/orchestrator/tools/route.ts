import { toolsMutation } from "@/server/orchestrator/tools-route";
import { listPacks } from "@/server/orchestrator/skill-packs";
import { listMcp, listPlugins, listSkills, readGlobalClaudeMd } from "@/server/orchestrator/tools-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return toolsMutation(false, "overview", async () => {
    const [skills, claudeMd, mcp, plugins, packs] = await Promise.all([listSkills(), readGlobalClaudeMd(), listMcp(), listPlugins().catch(() => ({ installed: [], marketplaces: [] })), listPacks()]);
    return { skills, claudeMd, mcp, plugins, packs };
  });
}
