import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authorize, readJson } from "@/server/http/api-helpers";
import { renderTemplate, validateTemplate } from "@/server/billing/templates";

const bodySchema = z.object({ body: z.string() });

/** Preview com dados de exemplo — nada é gravado nem enviado. */
export async function POST(request: Request) {
  try {
    await authorize("billing:view");
    const { body } = bodySchema.parse(await readJson(request));
    const valid = validateTemplate(body);
    return NextResponse.json({
      preview: renderTemplate(valid, { cliente: "Italoc", valor: "R$ 800,00", vencimento: "10/11/2026", motivo: "Manutenção mensal do sistema", projeto: "Sistema Italoc", competencia: "NOVEMBRO/2026", diasAtraso: "2" }),
    });
  } catch (error) {
    return apiError(error);
  }
}
