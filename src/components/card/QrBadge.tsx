"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrBadge({ value, size = 180 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { width: size * 2, margin: 1, color: { dark: "#1F1A17", light: "#FFFFFF" }, errorCorrectionLevel: "M" }).then(setSrc);
  }, [value, size]);
  return (
    <div className="rounded-2xl bg-white p-2 shadow-inner" style={{ width: size + 16, height: size + 16 }}>
      {src ? <img src={src} width={size} height={size} alt="Your QR code" className="rounded-xl" /> : <div className="h-full w-full animate-pulse rounded-xl bg-ink/5" />}
    </div>
  );
}
