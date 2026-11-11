import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBrandBySlug, brandCssVars } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return {};
  return {
    title: `${brand.name} stamp card`,
    description: brand.tagline ?? `Collect stamps at ${brand.name}`,
    manifest: `/${brand.slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: brand.name },
    icons: { apple: `/api/icon/${brand.slug}?size=180` },
  };
}

export default async function BrandLayout({ children, params }: { children: React.ReactNode; params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const vars = brandCssVars(brand) as React.CSSProperties;
  return (
    <div style={vars} className="min-h-screen">
      <meta name="theme-color" content={brand.primary_color} />
      {children}
    </div>
  );
}
