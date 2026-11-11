import { NextResponse } from "next/server";
import { clearStaffSession, getStaffSession } from "@/lib/session";

export async function GET(req: Request) {
  const s = await getStaffSession();
  await clearStaffSession();
  const url = new URL(req.url);
  // Session slug first, then ?brand= (the scanner passes it), otherwise the home page.
  const slug = s?.brandSlug || url.searchParams.get("brand") || "";
  const dest = /^[a-z0-9-]+$/.test(slug) ? `/${slug}/staff` : "/";
  return NextResponse.redirect(new URL(dest, url.origin));
}
