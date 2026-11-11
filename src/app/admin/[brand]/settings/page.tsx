import { requireBrand } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { updateBrand, addOutlet, toggleOutlet, addStaff, removeStaff } from "@/app/admin/actions";
import type { Outlet, Staff } from "@/lib/types";

export default async function Settings({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const { brand } = await requireBrand(slug);
  const db = supabaseAdmin();
  const [{ data: outlets }, { data: staff }] = await Promise.all([
    db.from("outlets").select("*").eq("brand_id", brand.id).order("name"),
    db.from("staff").select("*").eq("brand_id", brand.id).eq("active", true).order("name"),
  ]);
  const os = (outlets ?? []) as Outlet[];

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold">Settings</h1>

      <form action={updateBrand.bind(null, slug)} className="adm-card mt-6 grid gap-3 md:grid-cols-2">
        <p className="font-display text-lg font-bold md:col-span-2">Programme</p>
        <div><label className="label">Brand name</label><input name="name" defaultValue={brand.name} className="adm-input" /></div>
        <div><label className="label">Tagline</label><input name="tagline" defaultValue={brand.tagline ?? ""} className="adm-input" /></div>
        <div><label className="label">Primary colour</label><input name="primary_color" type="color" defaultValue={brand.primary_color} className="adm-input h-10" /></div>
        <div><label className="label">Accent colour</label><input name="accent_color" type="color" defaultValue={brand.accent_color} className="adm-input h-10" /></div>
        <div><label className="label">Stamps per reward</label><input name="stamps_per_reward" type="number" min={3} max={30} defaultValue={brand.stamps_per_reward} className="adm-input" /></div>
        <div><label className="label">Reward name</label><input name="reward_name" defaultValue={brand.reward_name} className="adm-input" /></div>
        <div><label className="label">1 stamp per …</label><input name="stamp_label" defaultValue={brand.stamp_label} className="adm-input" /></div>
        <div><label className="label">Reward valid (days)</label><input name="reward_valid_days" type="number" min={7} max={365} defaultValue={brand.reward_valid_days} className="adm-input" /></div>
        <div><label className="label">Max stamps per visit</label><input name="max_stamps_per_visit" type="number" min={1} max={12} defaultValue={brand.max_stamps_per_visit} className="adm-input" /></div>
        <div><label className="label">Old paper cards accepted until</label><input name="migration_until" type="date" defaultValue={brand.migration_until ?? ""} className="adm-input" /></div>
        <div><label className="label">Max stamps credited from a paper card</label><input name="migration_cap" type="number" min={1} max={30} defaultValue={brand.migration_cap} className="adm-input" /></div>
        <div><label className="label">Lucky spin: 1 in N wins</label><input name="spin_double_odds" type="number" min={2} max={20} defaultValue={brand.spin_double_odds} className="adm-input" /></div>
        <div className="grid grid-cols-2 gap-2 md:col-span-2">
          {[["spin_enabled", "Lucky spin after each stamp", brand.spin_enabled], ["streak_enabled", "Streak bonus (back within 2 weeks)", brand.streak_enabled], ["referral_enabled", "Bring-a-friend bonus", brand.referral_enabled], ["install_bonus_enabled", "Bonus stamp for saving to home screen", brand.install_bonus_enabled], ["birthday_reward_enabled", "Birthday reward", brand.birthday_reward_enabled]].map(([k, label, on]) => (
            <label key={String(k)} className="flex items-center gap-2 text-sm"><input type="checkbox" name={String(k)} defaultChecked={Boolean(on)} /> {label}</label>
          ))}
        </div>
        <div className="md:col-span-2"><label className="label">Levels (JSON: name, min lifetime stamps, perk)</label><textarea name="tiers" rows={5} defaultValue={JSON.stringify(brand.tiers, null, 2)} className="adm-input font-mono text-xs" /></div>
        <div><label className="label">Creator agreement (default)</label><textarea name="ugc_agreement" rows={6} defaultValue={brand.ugc_agreement ?? ""} className="adm-input" /></div>
        <div><label className="label">PDPA notice at sign-up</label><textarea name="pdpa_text" rows={6} defaultValue={brand.pdpa_text ?? ""} className="adm-input" /></div>
        <div className="md:col-span-2"><button className="adm-btn-brand">Save settings</button></div>
      </form>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="adm-card">
          <p className="font-display text-lg font-bold">Outlets</p>
          <ul className="mt-2 divide-y divide-ink/10">
            {os.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                <span className={o.active ? "" : "text-ink/40 line-through"}>{o.name}<span className="ml-2 text-xs text-ink/50">{o.address ?? ""}</span></span>
                <form action={toggleOutlet.bind(null, slug, o.id, !o.active)}><button className="text-xs underline">{o.active ? "Deactivate" : "Activate"}</button></form>
              </li>
            ))}
          </ul>
          <form action={addOutlet.bind(null, slug)} className="mt-3 flex gap-2">
            <input name="name" placeholder="Outlet name" className="adm-input" required />
            <input name="address" placeholder="Address" className="adm-input" />
            <button className="adm-btn-ghost shrink-0">Add</button>
          </form>
        </div>

        <div className="adm-card">
          <p className="font-display text-lg font-bold">Staff PINs</p>
          <p className="text-xs text-ink/50">Staff sign in to the scanner with outlet + PIN. Managers can use any outlet.</p>
          <ul className="mt-2 divide-y divide-ink/10">
            {((staff ?? []) as Staff[]).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span>{s.name} <span className="text-xs text-ink/50">· {s.role} · {os.find((o) => o.id === s.outlet_id)?.name ?? "any outlet"}</span></span>
                <form action={removeStaff.bind(null, slug, s.id)}><button className="text-xs text-red-700 underline">Remove</button></form>
              </li>
            ))}
          </ul>
          <form action={addStaff.bind(null, slug)} className="mt-3 grid grid-cols-2 gap-2">
            <input name="name" placeholder="Name" className="adm-input" required />
            <input name="pin" placeholder="PIN (4–8 digits)" inputMode="numeric" pattern="[0-9]{4,8}" className="adm-input" required />
            <select name="role" className="adm-input"><option value="staff">Staff</option><option value="manager">Manager</option></select>
            <select name="outlet_id" className="adm-input"><option value="">Any outlet</option>{os.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            <button className="adm-btn-ghost col-span-2">Add staff PIN</button>
          </form>
        </div>
      </div>
    </div>
  );
}
