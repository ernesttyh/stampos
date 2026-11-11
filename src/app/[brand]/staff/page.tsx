import { notFound, redirect } from "next/navigation";
import { getBrandBySlug } from "@/lib/brand";
import { getStaffSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { StaffLogin } from "@/components/staff/StaffLogin";
import type { Outlet } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StaffLoginPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const session = await getStaffSession();
  if (session && session.brandSlug === slug) redirect(`/${slug}/staff/scan`);
  const { data: outlets } = await supabaseAdmin().from("outlets").select("id, name").eq("brand_id", brand.id).eq("active", true).order("name");
  return (
    <main className="min-h-screen bg-ink text-cream">
      <div className="mx-auto max-w-sm px-5 pt-14">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-cream/60">{brand.name}</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold">Staff scanner</h1>
        <p className="mt-2 text-sm text-cream/70">Pick your outlet and enter your PIN.</p>
        <StaffLogin slug={slug} outlets={(outlets ?? []) as Pick<Outlet, "id" | "name">[]} />
      </div>
    </main>
  );
}
