const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valores trafegam em centavos inteiros; só formatam na borda. */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, " ");
}

/** "800,00" / "1.250,5" / "800" → centavos. Retorna null quando inválido. */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/[R$\s]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}
