import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { deleteProvider, getProviderRowOrThrow, listProviders, updateProvider } from "@/server/providers/provider-service";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:read");
    const { id } = await params;
    await getProviderRowOrThrow(id);
    const providers = await listProviders();
    const provider = providers.find((p) => p.id === id);
    return NextResponse.json({ provider });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:write");
    const { id } = await params;
    const meta = await getRequestMeta();
    const body = await request.json();
    const provider = await updateProvider(id, body, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ provider });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "provider:write");
    const { id } = await params;
    const meta = await getRequestMeta();
    await deleteProvider(id, { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
