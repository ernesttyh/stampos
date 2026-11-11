"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function AdminLoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    if (mode === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else {
        router.replace("/admin");
        router.refresh();
      }
    } else {
      const { error, data } = await sb.auth.signUp({ email, password });
      if (error) setMsg(error.message);
      else if (data.session) {
        router.replace("/admin");
        router.refresh();
      } else setMsg("Check your email to confirm your account, then sign in.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="adm-card mt-6 space-y-3">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="adm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="adm-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
      </div>
      {msg && <p className="rounded-lg bg-cream px-3 py-2 text-sm">{msg}</p>}
      <button className="adm-btn-brand w-full" disabled={busy}>{busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      <button type="button" className="w-full text-xs text-ink/50 underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
      <p className="text-xs text-ink/40">New accounts see no brands until a platform admin grants access.</p>
    </form>
  );
}
