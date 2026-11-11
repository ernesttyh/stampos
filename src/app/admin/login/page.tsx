import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin-auth";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export default async function AdminLogin() {
  const u = await getAdminUser();
  if (u) redirect("/admin");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl font-extrabold">StampOS</p>
        <p className="mt-1 text-sm text-ink/60">Sign in to manage your loyalty programmes.</p>
        <AdminLoginForm />
      </div>
    </main>
  );
}
