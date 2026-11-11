import { supabaseAdmin } from "./supabase/admin";
import type { Brand, Tier } from "./types";

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const { data } = await supabaseAdmin().from("brands").select("*").eq("slug", slug).maybeSingle();
  return (data as Brand) ?? null;
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const { data } = await supabaseAdmin().from("brands").select("*").eq("id", id).maybeSingle();
  return (data as Brand) ?? null;
}

/** "#C8102E" -> "200 16 46" (for Tailwind rgb(var(--brand-rgb) / <alpha>)) */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "200 16 46";
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function darken(hex: string, amount = 0.2): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `${r} ${g} ${b}`;
}

export function brandCssVars(brand: Pick<Brand, "primary_color" | "accent_color">): Record<string, string> {
  return {
    "--brand-rgb": hexToRgbTriplet(brand.primary_color),
    "--brand-dark-rgb": darken(brand.primary_color, 0.25),
    "--accent": brand.accent_color,
  };
}

export function tierFor(tiers: Tier[], lifetime: number) {
  const sorted = [...(tiers || [])].sort((a, b) => a.min - b.min);
  if (sorted.length === 0) return { current: { name: "Member", min: 0 }, next: null, progress: 1 };
  let current = sorted[0];
  let next: Tier | null = null;
  for (let i = 0; i < sorted.length; i++) {
    if (lifetime >= sorted[i].min) current = sorted[i];
    else {
      next = sorted[i];
      break;
    }
  }
  const progress = next ? Math.min(1, (lifetime - current.min) / Math.max(1, next.min - current.min)) : 1;
  return { current, next, progress };
}

export function appUrl(path = "") {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/[/]$/, "");
  return base + path;
}
