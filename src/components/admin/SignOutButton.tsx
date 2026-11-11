"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="adm-btn-ghost"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace("/admin/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
