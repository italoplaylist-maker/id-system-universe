import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { listWhatsAppMessages } from "@/server/billing/messages";

export async function GET(request: Request) {
  try {
    const user = await authorize("billing:view");
    const url = new URL(request.url);
    return NextResponse.json({ messages: await listWhatsAppMessages(user, { status: url.searchParams.get("status") ?? undefined, limit: Number(url.searchParams.get("limit")) || undefined }) });
  } catch (error) {
    return apiError(error);
  }
}
