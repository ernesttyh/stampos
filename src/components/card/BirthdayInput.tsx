"use client";

/** Keep the native accessible date picker, but never let its Safari intrinsic width size the form. */
export function BirthdayInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const displayDate = value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "DD / MM / YYYY";
  return <>
    <div className="input relative flex min-w-0 max-w-full items-center justify-between gap-3 overflow-hidden text-left focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
      <span aria-hidden="true" className={value ? "" : "text-ink/40"}>{displayDate}</span>
      <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-ink/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /></svg>
      <input id="bday" type="date" className="absolute inset-0 block h-full w-full min-w-0 max-w-full cursor-pointer appearance-none opacity-0" value={value} onChange={(e) => onChange(e.target.value)} max={new Date().toISOString().slice(0, 10)} aria-describedby="birthday-help" />
    </div>
    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
      <p id="birthday-help" className="text-ink/60">Tap to choose your birthday. You can leave this blank.</p>
      {value && <button type="button" className="shrink-0 rounded px-2 py-1 font-semibold underline focus-visible:outline focus-visible:outline-2" onClick={() => onChange("")} aria-label="Clear birthday">Clear</button>}
    </div>
  </>;
}
