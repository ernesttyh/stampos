import { NextResponse } from "next/server";
import { clearCustomerSession } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  await clearCustomerSession();
  return NextResponse.redirect(new URL(`/${brand}/join`, req.url));
}
