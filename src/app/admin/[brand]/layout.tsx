import Link from "next/link";
import { requireBrand } from "@/lib/admin-auth";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function BrandAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const { brand, user } = await requireBrand(slug);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink/10 bg-white px-4 py-6 md:flex">
        <Link href="/admin" className="text-xs text-ink/50 hover:text-ink">← All brands</Link>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl font-display font-extrabold text-white" style={{ background: brand.primary_color }}>
            {brand.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="font-display font-bold leading-tight">{brand.name}</p>
            <p className="text-[11px] text-ink/50">/{brand.slug}</p>
          </div>
        </div>
        <AdminNav slug={brand.slug} />
        <div className="mt-auto text-[11px] text-ink/40">
          <p>{user.email}</p>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="border-b border-ink/10 bg-white px-4 py-3 md:hidden">
          <AdminNav slug={brand.slug} compact />
        </div>
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">{children}</div>
      </div>
    </div>
  );
}
