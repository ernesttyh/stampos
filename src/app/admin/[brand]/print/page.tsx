import { requireBrand } from "@/lib/admin-auth";
import { appUrl } from "@/lib/brand";
import { PrintSheet } from "@/components/admin/PrintSheet";

export default async function Print({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: slug } = await params;
  const { brand } = await requireBrand(slug);
  return (
    <PrintSheet
      brandName={brand.name}
      color={brand.primary_color}
      accent={brand.accent_color}
      joinUrl={appUrl(`/${slug}/join`)}
      stampsPerReward={brand.stamps_per_reward}
      rewardName={brand.reward_name}
      stampLabel={brand.stamp_label}
    />
  );
}
