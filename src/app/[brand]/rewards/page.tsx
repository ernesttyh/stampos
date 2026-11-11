import { redirect } from "next/navigation";

export default async function RewardsRedirect({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  redirect(`/${brand}?tab=rewards`);
}
