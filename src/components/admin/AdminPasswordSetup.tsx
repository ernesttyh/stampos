"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { establishAdminSession, INVALID_INVITE, saveAdminPassword } from "./onboarding";

export function AdminPasswordSetup({ callback = false }: { callback?: boolean }) {
  const router = useRouter();
  const initialization = useRef<Promise<void> | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    let active = true;
    if (!initialization.current) {
      const url = new URL(window.location.href);
      // Remove credentials before creating the client (which otherwise auto-detects the URL).
      window.history.replaceState(null, "", window.location.pathname);
      initialization.current = establishAdminSession(supabaseBrowser().auth, url, callback);
    }
    initialization.current.then(() => {
      if (!active) return;
      if (callback) {
        router.replace("/admin/set-password");
        router.refresh();
      } else setReady(true);
    }).catch(() => {
      if (active) setMessage(INVALID_INVITE);
    });
    return () => { active = false; };
  }, [callback, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveAdminPassword(supabaseBrowser().auth, password, confirmation);
      setPassword("");
      setConfirmation("");
      router.replace("/admin");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not save your password. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="adm-card mt-6 space-y-3">
      {!ready && !message && <p className="text-sm text-ink/60" role="status">Checking your link…</p>}
      {ready && <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="new-password">New password</label>
          <input id="new-password" className="adm-input" type="password" autoComplete="new-password" minLength={12} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" className="adm-input" type="password" autoComplete="new-password" minLength={12} required disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </div>
        <p className="text-xs text-ink/50">Use at least 12 characters. Setting a password does not grant access to any brands.</p>
        <button className="adm-btn-brand w-full" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
      </form>}
      {message && <p role="alert" className="rounded-lg bg-cream px-3 py-2 text-sm">{message}</p>}
      <a className="block text-center text-xs text-ink/50 underline" href="/admin/login">Back to sign in</a>
    </div>
  );
}
