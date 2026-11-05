import { NextResponse } from "next/server";
import { ValidationError } from "@/lib/errors";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { LIMITS, saveUpload } from "@/server/orchestrator/attachments";
import { consumeRateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Envia UM arquivo/imagem/áudio-gravado; devolve o id para anexar ao comando. */
export async function POST(request: Request) {
  try {
    const user = await guard(true);
    consumeRateLimit(`agent-upload:${user.id}`, 60, 60_000);
    const len = Number(request.headers.get("content-length") ?? 0);
    if (len > LIMITS.maxFileBytes + 1024 * 1024) throw new ValidationError(`O arquivo passa de ${LIMITS.maxFileBytes / 1024 / 1024} MB.`);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ValidationError("Envie um arquivo.");
    const attachment = await saveUpload(user.id, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
