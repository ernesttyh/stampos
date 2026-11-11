import { notFound, redirect } from "next/navigation";
import { getBrandBySlug } from "@/lib/brand";
import { getCustomerSession } from "@/lib/session";
import { JoinForm } from "@/components/card/JoinForm";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ brand: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { brand: slug } = await params;
  const { ref } = await searchParams;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  const session = await getCustomerSession();
  if (session && session.brandSlug === slug) redirect(`/${slug}`);
  return (
    <main className="min-h-screen bg-brand text-white">
      <div className="mx-auto max-w-md px-5 pt-12 pb-10">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-white/70">{brand.name}</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-[1.05]">
          Your stamp card,<br />now on your phone.
        </h1>
        <p className="mt-3 text-white/80">
          1 stamp per {brand.stamp_label}. {brand.stamps_per_reward} stamps = {brand.reward_name.toLowerCase()}.
          {ref ? " A friend sent you — you both get a bonus stamp on your first visit." : " Takes 20 seconds, no app to download."}
        </p>
        <JoinForm
          slug={brand.slug}
          brandName={brand.name}
          pdpaText={brand.pdpa_text}
          refCode={ref ?? null}
          birthdayEnabled={brand.birthday_reward_enabled}
        />
      </div>
    </main>
  );
}
