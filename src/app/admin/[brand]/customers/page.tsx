import Link from "next/link";
import { requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { prettyPhone } from "@/lib/phone";
import type { Customer } from "@/lib/types";

const filters: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "near", label: "Close to reward" },
  { key: "lapsed", label: "Gone quiet" },
  { key: "influencer", label: "Creators" },
  { key: "reachable", label: "Reachable" },
];

export default async function Customers({ params, searchParams }: { params: Promise<{ brand: string }>; searchParams: Promise<{ q?: string; f?: string }> }) {
  const { brand: slug } = await params;
  const { q = "", f = "all" } = await searchParams;
  const { brand } = await requireBrand(slug);
  const db = supabaseAdmin();
  let query = db.from("customers").select("*").eq("brand_id", brand.id).order("last_visit_at", { ascending: false, nullsFirst: false }).limit(200);
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\s/g, "")}%`);
  if (f === "near") query = query.gte("stamp_balance", brand.stamps_per_reward - 2);
  if (f === "lapsed") query = query.lt("last_visit_at", new Date(Date.now() - 14 * 86400000).toISOString());
  if (f === "influencer") query = query.eq("kind", "influencer");
  if (f === "reachable") query = query.or("push_subscription.not.is.null,telegram_chat_id.not.is.null");
  const { data } = await query;
  const rows = (data ?? []) as Customer[];
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-SG", { day: "numeric", month: "short" }) : "—");

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold">Customers</h1>
      <form className="mt-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Search name or number" className="adm-input max-w-xs" />
        <input type="hidden" name="f" value={f} />
        <button className="adm-btn-ghost">Search</button>
        <div className="ml-auto flex gap-1">
          {filters.map((x) => (
            <Link key={x.key} href={`/admin/${slug}/customers?f=${x.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full px-3 py-1.5 text-xs font-medium ${f === x.key ? "bg-ink text-white" : "bg-white border border-ink/10"}`}>
              {x.label}
            </Link>
          ))}
        </div>
      </form>
      <div className="adm-card mt-4 overflow-x-auto">
        <table className="adm-table">
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Card</th><th>Lifetime</th><th>Visits</th><th>Last visit</th><th>Channels</th><th>Joined</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link className="font-medium underline-offset-2 hover:underline" href={`/admin/${slug}/customers/${c.id}`}>{c.name}</Link>{c.kind === "influencer" && <span className="ml-2 rounded-full bg-[var(--accent,#F2B134)] px-2 py-0.5 text-[10px] font-semibold">creator</span>}</td>
                <td className="text-ink/70">{prettyPhone(c.phone)}</td>
                <td>{c.stamp_balance}/{brand.stamps_per_reward}</td>
                <td>{c.lifetime_stamps}</td>
                <td>{c.visits}</td>
                <td>{fmt(c.last_visit_at)}</td>
                <td className="text-xs text-ink/60">{[c.push_subscription && "push", c.telegram_chat_id && "telegram", c.installed_at && "home screen"].filter(Boolean).join(" · ") || "—"}</td>
                <td className="text-ink/60">{fmt(c.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-ink/50">No customers match. Share the join link to get started.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
