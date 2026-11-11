"use client";

import { singaporeLocalDigits } from "@/lib/phone";

export function SingaporePhoneInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="flex items-center gap-3">
    <span className="shrink-0 font-semibold" aria-label="Singapore country code">+65</span>
    <input id="phone" className="input min-w-0 flex-1" type="tel" value={value} onChange={(e) => onChange(singaporeLocalDigits(e.target.value))} inputMode="numeric" autoComplete="tel-national" required pattern="[89][0-9]{7}" minLength={8} maxLength={16} placeholder="9123 4567" aria-describedby="phone-help" />
  </div>;
}
