/** Nome de subpasta seguro para um repositório (minúsculo, sem acento, só [a-z0-9._-]). */
export const slugDir = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "repo";

/**
 * Subpasta única para cada repositório de uma lista (nomes iguais de donos diferentes ganham -2, -3…).
 * Estável: a ordem da lista decide quem fica com o nome sem sufixo.
 */
export function assignRepoDirs(repos: Array<{ id: string; name: string }>): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const r of repos) {
    const base = slugDir(r.name);
    let dir = base;
    for (let i = 2; used.has(dir); i += 1) dir = `${base}-${i}`.slice(0, 44);
    used.add(dir);
    out.set(r.id, dir);
  }
  return out;
}
