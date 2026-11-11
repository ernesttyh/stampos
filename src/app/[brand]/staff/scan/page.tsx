import { notFound, redirect } from "next/navigation";
import { getBrandBySlug } from "@/lib/brand";
import { getStaffSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Scanner } from "@/components/staff/Scanner";

export const dynamic = "force-dynamic";

export default async function ScanPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const session = await getStaffSession();
  if (!session || session.brandSlug !== slug) redirect(`/${slug}/staff`);
  const { data: outlet } = session.outletId
    ? await supabaseAdmin().from("outlets").select("name").eq("id", session.outletId).maybeSingle()
    : { data: null };
  return (
    <Scanner
      brand={{ name: brand.name, stamp_label: brand.stamp_label, stamps_per_reward: brand.stamps_per_reward, max_stamps_per_visit: brand.max_stamps_per_visit }}
      staffName={session.name}
      outletName={outlet?.name ?? "All outlets"}
      role={session.role}
      slug={slug}
    />
  );
}
