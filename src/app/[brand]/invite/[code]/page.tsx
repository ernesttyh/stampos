import { notFound } from "next/navigation";
import { getGrantByCode } from "@/lib/customers";
import { InviteForm } from "@/components/card/InviteForm";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ brand: string; code: string }> }) {
  const { brand: slug, code } = await params;
  const grant = await getGrantByCode(code);
  if (!grant || grant.brand.slug !== slug) notFound();
  const used = grant.status !== "invited";
  return (
    <main className="min-h-screen bg-brand text-white">
      <div className="mx-auto max-w-md px-5 pt-12 pb-10">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-white/70">{grant.brand.name} × creators</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-[1.05]">
          Hey {grant.handle},<br />{grant.rewards_total} free {grant.brand.stamp_label}s are waiting.
        </h1>
        <p className="mt-3 text-white/80">
          {grant.rewards_upfront} unlock{grant.rewards_upfront === 1 ? "s" : ""} the moment you accept. The other {grant.rewards_total - grant.rewards_upfront} unlock once your post is live.
          {grant.content_due_date ? ` Post by ${new Date(grant.content_due_date).toLocaleDateString("en-SG", { day: "numeric", month: "long" })}.` : ""}
        </p>
        {used ? (
          <div className="mt-8 rounded-3xl card-paper p-6 text-ink">
            <p className="font-display text-xl font-extrabold">This invite has already been used</p>
            <p className="mt-1 text-sm text-ink/60">Open your card with the same name and number you signed up with.</p>
            <a className="btn-brand mt-4 w-full" href={`/${slug}/join`}>Open my card</a>
          </div>
        ) : (
          <InviteForm
            slug={slug}
            code={grant.invite_code}
            deliverable={grant.deliverable}
            agreement={grant.agreement_text || grant.brand.ugc_agreement || "By accepting you agree to post about your visit, tag the brand and disclose the meal was gifted."}
          />
        )}
      </div>
    </main>
  );
}
