"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "", label: "Overview" },
  { href: "/customers", label: "Customers" },
  { href: "/nudges", label: "Nudges" },
  { href: "/creators", label: "Creators" },
  { href: "/settings", label: "Settings" },
  { href: "/print", label: "Print QR" },
];

export function AdminNav({ slug, compact }: { slug: string; compact?: boolean }) {
  const path = usePathname();
  const base = `/admin/${slug}`;
  return (
    <nav className={compact ? "flex gap-1 overflow-x-auto" : "mt-6 flex flex-col gap-1"}>
      {items.map((it) => {
        const href = base + it.href;
        const active = it.href === "" ? path === base : path.startsWith(href);
        return (
          <Link key={it.href} href={href} className={`rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap ${active ? "bg-ink text-white" : "text-ink/70 hover:bg-cream"}`}>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
