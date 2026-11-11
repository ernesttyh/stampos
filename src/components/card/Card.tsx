"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardPayload } from "@/lib/types";
import { useCardLive, type LiveStampEvent } from "./useCardLive";
import { StampGrid, StampIcon } from "./StampGrid";
import { Confetti } from "./Confetti";
import { QrBadge } from "./QrBadge";
import { SpinWheel } from "./SpinWheel";
import { PushToggle } from "./PushToggle";
import { InstallPrompt } from "./InstallPrompt";

type Tab = "card" | "rewards" | "perks";

export function Card({ initial, initialTab }: { initial: CardPayload; initialTab: Tab }) {
  const [data, setData] = useState<CardPayload>(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filled, setFilled] = useState(initial.customer.stamp_balance);
  const [animateFrom, setAnimateFrom] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const [showSpin, setShowSpin] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const balanceRef = useRef(initial.customer.stamp_balance);
  const total = data.brand.stamps_per_reward;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/card", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as CardPayload;
      setData(json);
      if (json.customer.stamp_balance !== balanceRef.current) {
        // A change we didn't animate (e.g. poll caught it) — animate from the old balance
        const prev = balanceRef.current;
        balanceRef.current = json.customer.stamp_balance;
        if (json.customer.stamp_balance > prev) {
          setAnimateFrom(prev);
          setFilled(json.customer.stamp_balance);
        } else {
          setFilled(json.customer.stamp_balance);
        }
      }
    } catch {
      /* offline — keep showing what we have */
    }
  }, []);

  const showToast = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  const handleStamp = useCallback(
    (e: LiveStampEvent) => {
      const prev = balanceRef.current;
      if (e.minted > 0) {
        // Fill the card completely, celebrate, then roll over to the new balance
        setAnimateFrom(prev);
        setFilled(total);
        setConfetti(true);
        showToast(`Card complete — ${data.brand.reward_name} unlocked!`, 4500);
        setTimeout(() => {
          setAnimateFrom(null);
          setFilled(e.balance);
          balanceRef.current = e.balance;
          setConfetti(false);
          refresh();
        }, 2600);
      } else {
        setAnimateFrom(prev);
        setFilled(e.balance);
        balanceRef.current = e.balance;
        const bonus = (e.bonuses ?? []).map((b) => b.label).join(" · ");
        showToast(`+${e.added} stamp${e.added > 1 ? "s" : ""}${e.multiplier && e.multiplier > 1 ? ` (${e.multiplier}× day!)` : ""}${bonus ? ` · ${bonus}` : ""}`);
        setTimeout(refresh, 900);
      }
      setTab("card");
    },
    [data.brand.reward_name, refresh, showToast, total]
  );

  useCardLive(data.customer.id, {
    onStamp: handleStamp,
    onRedeemed: () => {
      showToast("Enjoy! Reward redeemed.");
      refresh();
    },
    onPoll: refresh,
  });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("welcome") === "1") {
      showToast(`Welcome, ${data.customer.name.split(" ")[0]}! Show your QR at the counter to collect your first stamp.`, 5000);
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const available = data.rewards.filter((r) => r.status === "available");
  const locked = data.rewards.filter((r) => r.status === "locked");
  const past = data.rewards.filter((r) => r.status === "redeemed" || r.status === "expired");
  const firstName = data.customer.name.split(" ")[0];
  const remaining = total - filled;

  return (
    <main className="min-h-screen bg-brand pb-28">
      {confetti && <Confetti />}
      {showSpin && (
        <SpinWheel
          onDone={(r) => {
            setShowSpin(false);
            if (r.won) {
              const prev = balanceRef.current;
              if (r.minted > 0) {
                setAnimateFrom(prev);
                setFilled(total);
                setConfetti(true);
                setTimeout(() => {
                  setFilled(r.balance);
                  balanceRef.current = r.balance;
                  setAnimateFrom(null);
                  setConfetti(false);
                }, 2600);
              } else {
                setAnimateFrom(prev);
                setFilled(r.balance);
                balanceRef.current = r.balance;
              }
            }
            refresh();
          }}
        />
      )}

      {/* Header */}
      <header className="mx-auto max-w-md px-5 pt-8 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-white/70">{data.brand.name}</p>
            <h1 className="mt-1 font-display text-3xl font-extrabold leading-tight">Hi {firstName}</h1>
          </div>
          <div className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">
            {data.tier.current.name}
          </div>
        </div>
        {data.activeDouble && (
          <div className="mt-4 rounded-2xl bg-[var(--accent)] px-4 py-3 text-ink">
            <p className="font-display font-bold">{data.activeDouble.multiplier}× stamps right now — {data.activeDouble.title}</p>
            <p className="text-xs text-ink/70">Until {new Date(data.activeDouble.ends_at).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" })}</p>
          </div>
        )}
      </header>

      {/* Tabs */}
      <nav className="mx-auto mt-5 flex max-w-md gap-2 px-5">
        {(["card", "rewards", "perks"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 font-display text-sm font-semibold transition ${tab === t ? "bg-white text-ink" : "bg-white/15 text-white"}`}
          >
            {t === "card" ? "My card" : t === "rewards" ? `Rewards${available.length ? ` (${available.length})` : ""}` : "Perks"}
          </button>
        ))}
      </nav>

      <section className="mx-auto mt-4 max-w-md px-5">
        {tab === "card" && (
          <>
            {/* The stamp card */}
            <div className="rounded-3xl card-paper p-5 shadow-xl shadow-black/20">
              <div className="flex items-baseline justify-between">
                <p className="font-display text-xl font-extrabold">
                  {filled} of {total}
                </p>
                <p className="text-sm text-ink/60">
                  {remaining === 0 ? "Card complete!" : `${remaining} more ${remaining === 1 ? data.brand.stamp_label : data.brand.stamp_label + "s"} to a ${data.brand.reward_name.toLowerCase()}`}
                </p>
              </div>
              <div className="mt-4">
                <StampGrid total={total} filled={filled} animateFrom={animateFrom} />
              </div>
              <p className="mt-4 text-center text-xs text-ink/50">1 stamp per {data.brand.stamp_label}. Staff scan your QR to add stamps.</p>
            </div>

            {/* Spin */}
            {data.brand.spin_enabled && data.customer.spin_available && (
              <button onClick={() => setShowSpin(true)} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-[var(--accent)] px-5 py-4 text-left text-ink animate-pulseSoft">
                <div>
                  <p className="font-display text-lg font-extrabold">You have a lucky spin</p>
                  <p className="text-sm text-ink/70">Land on gold for a bonus stamp</p>
                </div>
                <span className="font-display text-2xl font-extrabold">→</span>
              </button>
            )}

            {/* QR */}
            <div className="mt-4 rounded-3xl bg-white/10 p-5 text-white backdrop-blur">
              <div className="flex items-center gap-4">
                <button onClick={() => setShowQr(true)} className="shrink-0" aria-label="Show my QR code full screen">
                  <QrBadge value={`SO:${data.customer.id}`} size={96} />
                </button>
                <div>
                  <p className="font-display text-lg font-bold">Show this at the counter</p>
                  <p className="text-sm text-white/75">Staff scan it to add stamps or redeem a reward. Tap to enlarge.</p>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <InstallPrompt
                installed={Boolean(data.customer.installed_at)}
                bonusEnabled={data.brand.install_bonus_enabled}
                onInstalled={(r) => {
                  if (r.given) {
                    showToast("Saved to home screen — bonus stamp added!");
                    refresh();
                  }
                }}
              />
              <PushToggle
                enabled={Boolean(data.customer.push_enabled_at)}
                vapidPublicKey={data.vapidPublicKey}
                onChange={(on) => {
                  showToast(on ? "Reminders on. We'll only nudge when it's worth it." : "Reminders off.");
                  refresh();
                }}
              />
              {data.telegramBot && !data.customer.telegram_chat_id && (
                <a
                  href={`https://t.me/${data.telegramBot}?start=${data.customer.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl bg-white/70 p-4"
                >
                  <p className="font-display font-bold">Prefer Telegram?</p>
                  <p className="text-sm text-ink/60">Tap to link your card and get reminders there instead.</p>
                </a>
              )}
            </div>
          </>
        )}

        {tab === "rewards" && (
          <div className="space-y-3">
            {available.length === 0 && locked.length === 0 && (
              <div className="rounded-3xl card-paper p-6 text-center">
                <StampIcon className="mx-auto h-14 w-14" />
                <p className="mt-3 font-display text-xl font-extrabold">Nothing to redeem yet</p>
                <p className="mt-1 text-sm text-ink/60">Fill your card to unlock a {data.brand.reward_name.toLowerCase()}.</p>
              </div>
            )}
            {available.map((r) => (
              <div key={r.id} className="rounded-3xl card-paper p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-extrabold">{r.title}</p>
                    <p className="text-sm text-ink/60">
                      {r.expires_at ? `Use by ${new Date(r.expires_at).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}` : "No expiry"}
                      {r.type === "influencer" ? " · creator reward" : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">Ready</span>
                </div>
                <button onClick={() => setShowQr(true)} className="btn-dark mt-4 w-full">Show QR to redeem</button>
                <p className="mt-2 text-center text-xs text-ink/40">Code {r.code}</p>
              </div>
            ))}
            {locked.map((r) => (
              <div key={r.id} className="rounded-3xl bg-white/15 p-5 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-extrabold">{r.title}</p>
                    <p className="text-sm text-white/70">Unlocks once your post is live and verified.</p>
                  </div>
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">Locked</span>
                </div>
              </div>
            ))}
            {data.grant && (
              <div className="rounded-3xl bg-white/10 p-5 text-white">
                <p className="font-display font-bold">Creator deal</p>
                <p className="mt-1 text-sm text-white/80">{data.grant.deliverable}</p>
                {data.grant.content_due_date && (
                  <p className="mt-1 text-sm text-white/80">Due {new Date(data.grant.content_due_date).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</p>
                )}
                <p className="mt-2 text-xs text-white/60">
                  Status: {data.grant.status === "accepted" ? "waiting for your post" : data.grant.status}
                </p>
              </div>
            )}
            {past.length > 0 && (
              <div className="pt-2">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-white/60">History</p>
                {past.map((r) => (
                  <div key={r.id} className="mt-2 flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/80">
                    <span>{r.title}</span>
                    <span className="text-white/60">{r.status === "redeemed" ? `Used ${r.redeemed_at ? new Date(r.redeemed_at).toLocaleDateString("en-SG", { day: "numeric", month: "short" }) : ""}` : "Expired"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "perks" && (
          <div className="space-y-3">
            <div className="rounded-3xl card-paper p-5">
              <p className="font-display text-xl font-extrabold">{data.tier.current.name}</p>
              <p className="text-sm text-ink/60">{data.tier.current.perk ?? ""}</p>
              {data.tier.next && (
                <>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
                    <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(data.tier.progress * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-ink/50">
                    {data.tier.next.min - data.customer.lifetime_stamps} more lifetime stamps to {data.tier.next.name}
                    {data.tier.next.perk ? ` — ${data.tier.next.perk.toLowerCase()}` : ""}
                  </p>
                </>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Lifetime stamps" value={data.customer.lifetime_stamps} />
                <Stat label="Visits" value={data.customer.visits} />
                <Stat label="Rewards" value={data.rewards.filter((r) => r.status === "redeemed").length} />
              </div>
            </div>

            <div className="rounded-3xl card-paper p-5">
              <p className="font-display text-xl font-extrabold">All levels</p>
              <ul className="mt-2 divide-y divide-ink/10">
                {[...data.brand.tiers].sort((a, b) => a.min - b.min).map((t) => (
                  <li key={t.name} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className={`font-display font-bold ${t.name === data.tier.current.name ? "text-brand" : ""}`}>{t.name}</p>
                      <p className="text-xs text-ink/60">{t.perk}</p>
                    </div>
                    <span className="text-sm text-ink/50">{t.min}+</span>
                  </li>
                ))}
              </ul>
            </div>

            {data.brand.referral_enabled && (
              <div className="rounded-3xl bg-[var(--accent)] p-5 text-ink">
                <p className="font-display text-xl font-extrabold">Bring a friend, both get a stamp</p>
                <p className="mt-1 text-sm text-ink/70">They sign up with your link; when they get their first stamp, you each get a bonus.</p>
                <ShareButton
                  path={`/${data.brand.slug}/join?ref=${data.customer.referral_code}`}
                  text={`Join me on the ${data.brand.name} stamp card — we both get a free stamp.`}
                />
              </div>
            )}

            <div className="rounded-2xl bg-white/10 p-4 text-xs text-white/70">
              <p>Card number {data.customer.phone}. <a className="underline" href={`/${data.brand.slug}/logout`}>Not you? Sign out.</a></p>
            </div>
          </div>
        )}
      </section>

      {/* Full-screen QR */}
      {showQr && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-white p-6" onClick={() => setShowQr(false)}>
          <p className="font-display text-2xl font-extrabold text-ink">{data.customer.name}</p>
          <p className="mb-6 text-sm text-ink/60">Show this to staff</p>
          <QrBadge value={`SO:${data.customer.id}`} size={260} />
          <p className="mt-6 text-sm text-ink/50">Tap anywhere to close</p>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-5">
          <div className="max-w-md rounded-2xl bg-ink px-5 py-3 text-center font-display font-semibold text-cream shadow-2xl animate-pop">{toast}</div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/60 py-3">
      <p className="font-display text-2xl font-extrabold">{value}</p>
      <p className="text-[11px] text-ink/60">{label}</p>
    </div>
  );
}

function ShareButton({ path, text }: { path: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${window.location.origin}${path}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: text, text, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={share} className="btn-dark mt-4 w-full">
      {copied ? "Link copied" : "Share my link"}
    </button>
  );
}
