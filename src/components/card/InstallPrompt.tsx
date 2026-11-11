"use client";
import { useEffect, useState } from "react";
import { isIOS, isStandalone } from "./PushToggle";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function InstallPrompt({ installed, bonusEnabled, onInstalled }: { installed: boolean; bonusEnabled: boolean; onInstalled: (r: { given: boolean; balance?: number; minted?: number }) => void }) {
  const [standalone, setStandalone] = useState<boolean | null>(null);
  const [bip, setBip] = useState<BIPEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    const sa = isStandalone();
    setStandalone(sa);
    const handler = (e: Event) => {
      e.preventDefault();
      setBip(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Running from the home screen and not yet recorded → claim the bonus once
  useEffect(() => {
    if (standalone && !installed) {
      fetch("/api/card/install", { method: "POST" })
        .then((r) => r.json())
        .then((j) => onInstalled(j))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone, installed]);

  if (standalone === null || standalone || installed) return null;

  async function install() {
    if (bip) {
      await bip.prompt();
      const choice = await bip.userChoice;
      if (choice.outcome === "accepted") setBip(null);
      return;
    }
    setShowIos(true);
  }

  return (
    <div className="rounded-2xl bg-white/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display font-bold">Save to home screen{bonusEnabled ? " — get a stamp" : ""}</p>
          <p className="text-sm text-ink/60">One tap to open your card next time. No app store needed.</p>
        </div>
        <button className="btn-brand shrink-0 !px-4 !py-2 text-sm" onClick={install}>Save</button>
      </div>
      {showIos && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink/70">
          {isIOS() ? (
            <>
              <li>Tap the <span className="font-semibold">Share</span> button at the bottom of Safari.</li>
              <li>Choose <span className="font-semibold">Add to Home Screen</span>.</li>
              <li>Open the card from your home screen — your bonus stamp lands automatically.</li>
            </>
          ) : (
            <>
              <li>Open your browser menu (⋮).</li>
              <li>Choose <span className="font-semibold">Add to Home screen</span> / <span className="font-semibold">Install app</span>.</li>
              <li>Open the card from your home screen — your bonus stamp lands automatically.</li>
            </>
          )}
        </ol>
      )}
    </div>
  );
}
