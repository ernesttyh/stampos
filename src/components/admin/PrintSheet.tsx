"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A5-ish table tent / counter card with the join QR. Print from the browser. */
export function PrintSheet({ brandName, color, accent, joinUrl, stampsPerReward, rewardName, stampLabel }: {
  brandName: string; color: string; accent: string; joinUrl: string; stampsPerReward: number; rewardName: string; stampLabel: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { width: 800, margin: 1, color: { dark: "#1F1A17", light: "#FFFFFF" } }).then(setQr);
  }, [joinUrl]);
  return (
    <div>
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Counter QR</h1>
          <p className="text-sm text-ink/60">Print this, stand it at the counter and on tables. The link is {joinUrl}</p>
        </div>
        <button className="adm-btn-brand" onClick={() => window.print()}>Print</button>
      </div>
      <div className="mx-auto mt-6 w-[148mm] rounded-3xl p-8 text-white print:mt-0 print:rounded-none" style={{ background: color, minHeight: "200mm" }}>
        <p className="font-display text-sm font-semibold uppercase tracking-wide opacity-80">{brandName}</p>
        <p className="mt-2 font-display text-[40px] font-extrabold leading-[1.05]">Scan to start<br />your stamp card</p>
        <p className="mt-3 text-lg opacity-90">1 stamp per {stampLabel}. {stampsPerReward} stamps = {rewardName.toLowerCase()}.</p>
        <div className="mt-6 rounded-3xl bg-white p-4">
          {qr && <img src={qr} alt="Join QR" className="w-full" />}
        </div>
        <p className="mt-4 text-center font-display text-lg font-bold" style={{ color: accent }}>No app needed · takes 20 seconds</p>
        <p className="mt-2 text-center text-sm opacity-80">Already have a paper card? Show it when you sign up and we&apos;ll move your stamps over.</p>
      </div>
      <style>{`@media print { body { background: white; } aside, nav, header { display: none !important; } }`}</style>
    </div>
  );
}
