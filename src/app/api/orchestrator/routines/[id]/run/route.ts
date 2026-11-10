import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { runRoutine } from "@/server/orchestrator/routines";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** "Executar agora": ignora horário e gatilho, mas respeita orçamento de tokens, agente pausado e execução em andamento. */
export async function POST(_request: Request, { params }: { params: Params }) {
  try {
    await guard(true);
    const { id } = await params;
    return NextResponse.json(await runRoutine(id, { slot: null, force: true }));
  } catch (error) {
    return apiError(error);
  }
}
