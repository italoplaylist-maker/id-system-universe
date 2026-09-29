import { isIP } from "node:net";
import dns from "node:dns/promises";
import { ValidationError } from "@/lib/errors";

export class UnsafeProviderUrlError extends ValidationError {}

/**
 * Cloud metadata endpoints are the one class of "private" address that must
 * never be reachable through a user-supplied baseUrl, no matter the
 * deployment: they hand out cloud credentials to whatever can reach them.
 * Ordinary private ranges (10/8, 172.16/12, 192.168/16, 127.0.0.1) are
 * intentionally NOT blocked — Coolify instances legitimately live on private
 * VPS/LAN addresses, which is the primary deployment target for this product.
 */
const BLOCKED_HOSTS = new Set([
  "169.254.169.254", // AWS/Azure/GCP/DigitalOcean metadata
  "169.254.170.2", // AWS ECS task metadata
  "metadata.google.internal",
  "metadata",
]);
const BLOCKED_IP_PREFIXES = ["fd00:ec2::254"];

function isBlockedIp(ip: string): boolean {
  if (BLOCKED_HOSTS.has(ip)) return true;
  const normalized = ip.toLowerCase();
  return BLOCKED_IP_PREFIXES.some((prefix) => normalized === prefix);
}

export interface ValidatedProviderUrl {
  /** Origin only (protocol + host + port), no path/query/hash. */
  normalizedBaseUrl: string;
}

/**
 * Validates and normalizes a user-supplied Coolify base URL before it is
 * ever stored or used to build a request. Guards against:
 *  - unexpected protocols (only http/https allowed)
 *  - credentials embedded in the URL
 *  - a path/query supplied by the user leaking into the stored baseUrl
 *    (requests are always built with `new URL(path, baseUrl)`, never string
 *    concatenation, so this is defense in depth rather than the only guard)
 *  - direct or DNS-resolved access to cloud metadata endpoints
 */
export async function validateProviderBaseUrl(rawUrl: string): Promise<ValidatedProviderUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeProviderUrlError("URL malformada.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeProviderUrlError(`Protocolo "${url.protocol}" não permitido. Use http ou https.`);
  }

  if (url.username || url.password) {
    throw new UnsafeProviderUrlError("A URL não pode conter credenciais embutidas.");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new UnsafeProviderUrlError("URL sem host.");
  }

  if (isBlockedIp(hostname)) {
    throw new UnsafeProviderUrlError("Este endereço não pode ser usado (endpoint de metadados).");
  }

  if (isIP(hostname) === 0) {
    // Not a literal IP — resolve to catch DNS pointing straight at metadata.
    try {
      const records = await dns.lookup(hostname, { all: true });
      for (const record of records) {
        if (isBlockedIp(record.address)) {
          throw new UnsafeProviderUrlError("Este host resolve para um endpoint de metadados bloqueado.");
        }
      }
    } catch (error) {
      if (error instanceof UnsafeProviderUrlError) throw error;
      // DNS failure at registration time isn't a security concern by itself —
      // TEST CONNECTION will surface it as a normal connectivity error.
    }
  }

  return { normalizedBaseUrl: `${url.protocol}//${url.host}` };
}

/**
 * Builds a request URL for a Coolify API call. Always use this instead of
 * string concatenation so a crafted path segment can never escape the
 * configured baseUrl (e.g. via "../" or an absolute URL in disguise).
 */
export function buildProviderRequestUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const target = new URL(path.replace(/^\/+/, ""), `${base.origin}/`);
  if (target.origin !== base.origin) {
    throw new UnsafeProviderUrlError("Path resolvido escapou do host configurado.");
  }
  return target;
}
