import Link from "next/link";
import { requireAdmin, adminBrands } from "@/lib/admin-auth";
import { createBrand } from "./actions";
import { SignOutButton } from "@/components/admin/SignOutButton";

export default async function AdminHome() {
  const user = await requireAdmin();
  const brands = await adminBrands(user);
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-3xl font-extrabold">Your brands</p>
          <p className="text-sm text-ink/60">{user.email}{user.isPlatformAdmin ? " · platform admin" : ""}</p>
        </div>
        <SignOutButton />
      </div>
      {brands.length === 0 && (
        <div className="adm-card mt-6">
          <p className="font-medium">No brands yet</p>
          <p className="text-sm text-ink/60">Ask a platform admin to add you to a brand, or create one below if you are a platform admin.</p>
        </div>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {brands.map((b) => (
          <Link key={b.id} href={`/admin/${b.slug}`} className="adm-card flex items-center gap-4 hover:border-ink/30">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl font-display text-lg font-extrabold text-white" style={{ background: b.primary_color }}>
              {b.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <span>
              <span className="block font-display font-bold">{b.name}</span>
              <span className="block text-xs text-ink/50">/{b.slug} · {b.stamps_per_reward} stamps = {b.reward_name.toLowerCase()}</span>
            </span>
          </Link>
        ))}
      </div>
      {user.isPlatformAdmin && (
        <form action={createBrand} className="adm-card mt-8 grid gap-3 sm:grid-cols-2">
          <p className="font-display text-lg font-bold sm:col-span-2">Add a brand</p>
          <div><label className="label">Name</label><input name="name" className="adm-input" required placeholder="Mala Mia" /></div>
          <div><label className="label">Slug (URL)</label><input name="slug" className="adm-input" required pattern="[a-z0-9-]+" placeholder="mala-mia" /></div>
          <div><label className="label">Primary colour</label><input name="primary_color" type="color" className="adm-input h-10" defaultValue="#C8102E" /></div>
          <div><label className="label">Accent colour</label><input name="accent_color" type="color" className="adm-input h-10" defaultValue="#F2B134" /></div>
          <div><label className="label">Stamps per reward</label><input name="stamps_per_reward" type="number" min={3} max={30} className="adm-input" defaultValue={10} /></div>
          <div><label className="label">Reward name</label><input name="reward_name" className="adm-input" defaultValue="Free bowl" /></div>
          <div><label className="label">Stamp label (1 stamp per …)</label><input name="stamp_label" className="adm-input" defaultValue="bowl" /></div>
          <div><label className="label">First outlet name</label><input name="outlet_name" className="adm-input" placeholder="Main outlet" /></div>
          <div className="sm:col-span-2"><button className="adm-btn-brand">Create brand</button></div>
        </form>
      )}
    </main>
  );
}
