import { NextResponse } from "next/server";
import sharp from "sharp";
import { getBrandBySlug } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Brand app icon as PNG: brand colour tile with the brand initials (or logo if a PNG logo_url is set later). */
export async function GET(req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const found = slug === "default" ? null : await getBrandBySlug(slug);
  if (!found && slug !== "default") return new NextResponse("Not found", { status: 404 });
  const brand = found ?? { name: "StampOS", primary_color: "#C8102E", accent_color: "#F2B134" };
  const url = new URL(req.url);
  const size = Math.min(1024, Math.max(32, Number(url.searchParams.get("size") || 512)));
  const maskable = url.searchParams.get("maskable") === "1";
  if (url.searchParams.get("badge") === "1") {
    const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96"><circle cx="48" cy="48" r="34" fill="none" stroke="#fff" stroke-width="8" stroke-dasharray="12 8"/></svg>`;
    const out = await sharp(Buffer.from(badge)).png().toBuffer();
    return new NextResponse(new Uint8Array(out), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  }
  const initials = brand.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${(radius / size) * 512}" fill="${brand.primary_color}"/>
    <circle cx="256" cy="256" r="150" fill="none" stroke="${brand.accent_color}" stroke-width="18" stroke-dasharray="26 18" opacity="0.9"/>
    <text x="256" y="256" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="170" fill="#FFF8F0">${initials}</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}
