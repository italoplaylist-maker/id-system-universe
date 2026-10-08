/**
 * Normaliza telefone/WhatsApp para dígitos em formato internacional
 * (Brasil: 55 + DDD + número). Retorna null quando não dá para confiar no número.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Prefixos de discagem internacional ("00") e zero de operadora/tronco no Brasil.
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!hadPlus && digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  const isBrazilianNational = (value: string) => /^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(value);

  if (digits.startsWith("55") && isBrazilianNational(digits.slice(2))) return digits;
  if (isBrazilianNational(digits)) return `55${digits}`;

  // Outros países: só aceita quando o usuário informou explicitamente "+" (ou 00), E.164 tem 8–15 dígitos.
  if ((hadPlus || trimmed.replace(/\D/g, "").startsWith("00")) && !digits.startsWith("55") && /^[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

export function formatPhoneBR(normalized: string | null | undefined): string {
  if (!normalized) return "";
  if (normalized.startsWith("55") && (normalized.length === 13 || normalized.length === 12)) {
    const national = normalized.slice(2);
    const ddd = national.slice(0, 2);
    const rest = national.slice(2);
    return `+55 (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return `+${normalized}`;
}
