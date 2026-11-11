import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/session";
import { getCardPayload } from "@/lib/loyalty";
import { Card } from "@/components/card/Card";

export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ brand: string }>;
  searchParams: Promise<{ tab?: string; ref?: string; source?: string }>;
}) {
  const { brand: slug } = await params;
  const sp = await searchParams;
  const session = await getCustomerSession();
  if (!session || session.brandSlug !== slug) {
    redirect(`/${slug}/join${sp.ref ? `?ref=${encodeURIComponent(sp.ref)}` : ""}`);
  }
  const payload = await getCardPayload(session.customerId);
  if (!payload || payload.brand.slug !== slug) redirect(`/${slug}/join`);
  return <Card initial={payload} initialTab={sp.tab === "rewards" || sp.tab === "perks" ? sp.tab : "card"} />;
}
