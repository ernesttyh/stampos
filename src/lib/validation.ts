export function integer(value: unknown, min: number, max: number, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function requiredText(value: unknown, label: string, max = 120): string {
  const s = String(value ?? "").trim();
  if (!s || s.length > max) throw new Error(`Please enter ${label.toLowerCase()} (${max} characters maximum).`);
  return s;
}

export function webUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.toString();
  } catch { /* handled below */ }
  throw new Error("Please enter a valid HTTPS post link.");
}

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("This request is invalid. Please refresh the page.");
  return value;
}

export function hexColor(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Please choose a valid colour.");
  return value;
}
