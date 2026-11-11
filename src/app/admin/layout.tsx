export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-cream text-ink">{children}</div>;
}
