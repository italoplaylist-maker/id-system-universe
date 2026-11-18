import { NextResponse } from "next/server";
import { actorFor, apiError, authorize } from "@/server/http/api-helpers";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { disconnectWhatsApp, pollWhatsAppConnection, startWhatsAppConnection } from "@/server/whatsapp/whatsapp-connect";

export const dynamic = "force-dynamic";

/** Estado da conexão (a tela consulta a cada poucos segundos). `?qr=1` pede um QR novo. */
export async function GET(request: Request) {
  try {
    const user = await authorize("integration:manage");
    consumeRateLimit(`whatsapp-poll:${user.id}`, 120, 60_000);
    const refreshQr = new URL(request.url).searchParams.get("qr") === "1";
    return NextResponse.json({ connection: await pollWhatsAppConnection({ refreshQr, actor: await actorFor(user) }) });
  } catch (error) {
    return apiError(error);
  }
}

/** Começa a conexão: cria a instância (com nome gerado) e devolve o QR Code para ler no celular. */
export async function POST() {
  try {
    const user = await authorize("integration:manage");
    consumeRateLimit(`whatsapp-connect:${user.id}`, 10, 60_000);
    return NextResponse.json({ connection: await startWhatsAppConnection() });
  } catch (error) {
    return apiError(error);
  }
}

/** Desconecta o número e apaga a instância. */
export async function DELETE() {
  try {
    const user = await authorize("integration:manage");
    await disconnectWhatsApp(await actorFor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
