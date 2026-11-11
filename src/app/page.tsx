import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="font-display text-5xl font-extrabold tracking-tight">StampOS</p>
        <p className="mt-3 text-ink/70">Digital stamp cards for restaurants. Customers open their brand&apos;s link; staff use the scanner; owners use the dashboard.</p>
        <div className="mt-8 flex gap-3 justify-center">
          <Link href="/admin" className="btn-dark">Open dashboard</Link>
          <Link href="/chengdu-bowl" className="btn-ghost">Chengdu Bowl card</Link>
        </div>
      </div>
    </main>
  );
}
