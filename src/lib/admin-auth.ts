import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";
import type { Brand } from "./types";

export type AdminUser = { id: string; email: string; isPlatformAdmin: boolean; brandIds: string[] };

export async function getAdminUser(): Promise<AdminUser | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const db = supabaseAdmin();
  const [{ data: profile }, { data: members }] = await Promise.all([
    db.from("profiles").select("is_platform_admin").eq("id", data.user.id).maybeSingle(),
    db.from("brand_members").select("brand_id").eq("user_id", data.user.id),
  ]);
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    isPlatformAdmin: Boolean(profile?.is_platform_admin),
    brandIds: (members ?? []).map((m) => m.brand_id as string),
  };
}

export async function requireAdmin(): Promise<AdminUser> {
  const u = await getAdminUser();
  if (!u) redirect("/admin/login");
  return u;
}

/** Brands this user can manage. */
export async function adminBrands(user: AdminUser): Promise<Brand[]> {
  const db = supabaseAdmin();
  const q = db.from("brands").select("*").order("name");
  const { data } = user.isPlatformAdmin ? await q : await q.in("id", user.brandIds.length ? user.brandIds : ["00000000-0000-0000-0000-000000000000"]);
  return (data ?? []) as Brand[];
}

export async function requireBrand(slug: string): Promise<{ user: AdminUser; brand: Brand }> {
  const user = await requireAdmin();
  const { data } = await supabaseAdmin().from("brands").select("*").eq("slug", slug).maybeSingle();
  if (!data) redirect("/admin");
  const brand = data as Brand;
  if (!user.isPlatformAdmin && !user.brandIds.includes(brand.id)) redirect("/admin");
  return { user, brand };
}
