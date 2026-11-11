import type { Metadata } from "next";
import { AdminPasswordSetup } from "@/components/admin/AdminPasswordSetup";

export const metadata: Metadata = { title: "Check invitation | StampOS", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-6 text-ink">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl font-extrabold">StampOS</p>
        <h1 className="mt-1 text-sm text-ink/60">Checking your invitation or password reset link.</h1>
        <AdminPasswordSetup callback />
      </div>
    </main>
  );
}
