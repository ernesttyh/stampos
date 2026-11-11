"use client";
import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function PushToggle({ enabled, vapidPublicKey, onChange }: { enabled: boolean; vapidPublicKey: string | null; onChange: (on: boolean) => void }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    setNeedsInstall(isIOS() && !isStandalone());
  }, []);

  async function enable() {
    if (!vapidPublicKey) {
      setMsg("Reminders aren't switched on for this brand yet.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg("Reminders were blocked. You can allow them in your browser settings.");
        setBusy(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
      const res = await fetch("/api/card/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("Could not save");
      onChange(true);
    } catch (e) {
      setMsg((e as Error).message || "Could not turn on reminders.");
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
      await fetch("/api/card/push", { method: "DELETE" });
      onChange(false);
    } catch {
      setMsg("Could not turn off reminders.");
    }
    setBusy(false);
  }

  if (supported === null) return null;
  if (!supported && !needsInstall) return null;

  return (
    <div className="rounded-2xl bg-white/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display font-bold">Reminders</p>
          <p className="text-sm text-ink/60">
            {needsInstall
              ? "Save this card to your home screen first, then turn reminders on."
              : enabled
              ? "You'll hear from us when a reward is close, or when stamps are doubled."
              : "A nudge when you're close to a free one, and on double-stamp days."}
          </p>
        </div>
        <button
          className={`shrink-0 ${enabled ? "btn-ghost" : "btn-brand"} !px-4 !py-2 text-sm`}
          disabled={busy || needsInstall}
          onClick={enabled ? disable : enable}
        >
          {busy ? "…" : enabled ? "On" : "Turn on"}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-ink/60">{msg}</p>}
    </div>
  );
}
