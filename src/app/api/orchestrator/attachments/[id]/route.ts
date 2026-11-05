import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { deleteUnlinked, readFor } from "@/server/orchestrator/attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Devolve o arquivo. Só imagens reais (conferidas pelo conteúdo) abrem inline; o resto sempre baixa, sem executar nada. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard(false);
    const { id } = await params;
    const { bytes, view } = await readFor(id);
    const inline = view.kind === "image";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": inline ? view.mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(view.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

/** Remove um upload ainda não enviado (o "x" da miniatura). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await guard(true);
    const { id } = await params;
    await deleteUnlinked(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
