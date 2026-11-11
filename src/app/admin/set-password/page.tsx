import type { Metadata } from "next";
import { AdminPasswordSetup } from "@/components/admin/AdminPasswordSetup";

export const metadata: Metadata = { title: "Set password | StampOS", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl font-extrabold">StampOS</p>
        <h1 className="mt-1 text-sm text-ink/60">Set your admin password.</h1>
        <AdminPasswordSetup />
      </div>
    </main>
  );
}
