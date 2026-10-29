import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission } from "@/server/http/api-helpers";
import { connectInstallation, verifyInstallState } from "@/server/github/github-service";
import { toClientError } from "@/lib/errors";
import { redirectToPath } from "@/server/http/public-url";

/** "Setup URL" do GitHub App: o GitHub redireciona o navegador do admin para cá após instalar. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => redirectToPath(`/settings/integrations?${query}`);
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");

    const installationId = url.searchParams.get("installation_id");
    if (!installationId || !verifyInstallState(url.searchParams.get("state"), user.id)) {
      return back("github=invalid");
    }
    const meta = await getRequestMeta();
    await connectInstallation(installationId, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return back("github=connected");
  } catch (error) {
    return back(`github=error&message=${encodeURIComponent(toClientError(error).message)}`);
  }
}
