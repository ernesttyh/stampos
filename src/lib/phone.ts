/** Normalise a phone number to E.164. Defaults to Singapore (+65) when no country code is given. */
export function normalisePhone(raw: string, defaultCountry = "65"): string | null {
  let digits = (raw || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Local SG mobile: 8 digits starting with 8 or 9
  if (/^[89]\d{7}$/.test(digits)) digits = defaultCountry + digits;
  if (!/^\d{8,15}$/.test(digits)) return null;
  return "+" + digits;
}

export function prettyPhone(e164: string) {
  if (e164.startsWith("+65") && e164.length === 11) return `${e164.slice(3, 7)} ${e164.slice(7)}`;
  return e164;
}

/** Display only the national portion beside a fixed +65 prefix; accepts pasted full SG numbers. */
export function singaporeLocalDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("0065") ? digits.slice(4) : digits.length > 8 && digits.startsWith("65") ? digits.slice(2) : digits;
}
