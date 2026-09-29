import type { InfrastructureProvider } from "@prisma/client";
import type { DeploymentProvider } from "@/providers/deployment/types";
import { CoolifyProvider } from "@/providers/deployment/coolify/coolify-provider";
import { decryptSecret } from "@/server/crypto/encryption";
import { AppError } from "@/lib/errors";

/**
 * The only place that turns a stored InfrastructureProvider row into a live
 * client. Adding a new provider type means adding a case here (and a new
 * folder under providers/deployment) — nothing else changes.
 */
export function createDeploymentProvider(row: Pick<InfrastructureProvider, "type" | "baseUrl" | "encryptedToken" | "name">): DeploymentProvider {
  const token = decryptSecret(row.encryptedToken);
  switch (row.type) {
    case "COOLIFY":
      return new CoolifyProvider(row.baseUrl, token, row.name);
    default:
      throw new AppError(`Provider type "${row.type}" is not implemented yet.`, 501, "PROVIDER_NOT_IMPLEMENTED");
  }
}
