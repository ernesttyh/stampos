import { NextResponse } from "next/server";
import { getBrandBySlug } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return new NextResponse("Not found", { status: 404 });
  const manifest = {
    name: `${brand.name} stamp card`,
    short_name: brand.name.slice(0, 12),
    description: brand.tagline ?? `Collect stamps at ${brand.name}`,
    start_url: `/${brand.slug}?source=pwa`,
    scope: `/${brand.slug}`,
    id: `/${brand.slug}`,
    display: "standalone",
    background_color: "#FFF8F0",
    theme_color: brand.primary_color,
    icons: [
      { src: `/api/icon/${brand.slug}?size=192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/api/icon/${brand.slug}?size=512`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/api/icon/${brand.slug}?size=512&maskable=1`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return NextResponse.json(manifest, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
