import "./worker"; // registra o gancho que acorda o worker assim que uma tarefa é enfileirada
import { authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";

/** Leitura = provider:read, mudança = provider:write; sempre escopo global (a central é da conta toda). */
export async function guard(write: boolean) {
  const user = await authorize(write ? "provider:write" : "provider:read");
  await requireGlobalScope(user);
  return user;
}
