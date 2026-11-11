import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";
import type { Brand } from "./types";

export type BrandRole = "owner" | "manager" | "viewer";
export type AdminUser = { id: string; email: string; isPlatformAdmin: boolean; brandIds: string[]; brandRoles: Record<string, BrandRole> };

export async function getAdminUser(): Promise<AdminUser | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const db = supabaseAdmin();
  const [profileResult, memberResult] = await Promise.all([
    db.from("profiles").select("is_platform_admin").eq("id", data.user.id).maybeSingle(),
    db.from("brand_members").select("brand_id, role").eq("user_id", data.user.id),
  ]);
  if (profileResult.error || memberResult.error) throw new Error("Unable to verify your access. Please try again.");
  const profile = profileResult.data;
  const members = memberResult.data ?? [];
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    isPlatformAdmin: Boolean(profile?.is_platform_admin),
    brandIds: (members ?? []).map((m) => m.brand_id as string),
    brandRoles: Object.fromEntries(members.map((m) => [m.brand_id, m.role as BrandRole])),
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
  const { data, error } = user.isPlatformAdmin ? await q : await q.in("id", user.brandIds.length ? user.brandIds : ["00000000-0000-0000-0000-000000000000"]);
  if (error) throw new Error("Unable to load brands. Please try again.");
  return (data ?? []) as Brand[];
}

export async function requireBrand(slug: string, access: "read" | "write" | "owner" = "read"): Promise<{ user: AdminUser; brand: Brand }> {
  const user = await requireAdmin();
  const { data, error } = await supabaseAdmin().from("brands").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error("Unable to verify brand access. Please try again.");
  if (!data) redirect("/admin");
  const brand = data as Brand;
  if (!user.isPlatformAdmin && !user.brandIds.includes(brand.id)) redirect("/admin");
  const role = user.brandRoles[brand.id];
  if (!user.isPlatformAdmin && ((access === "write" && !["owner", "manager"].includes(role)) || (access === "owner" && role !== "owner"))) {
    throw new Error("Your account has view-only access to this action. Please ask the brand owner.");
  }
  return { user, brand };
}
