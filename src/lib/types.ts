export type Tier = { name: string; min: number; perk?: string };

export type Brand = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  stamps_per_reward: number;
  stamp_label: string;
  reward_name: string;
  reward_valid_days: number;
  max_stamps_per_visit: number;
  migration_until: string | null;
  migration_cap: number;
  spin_enabled: boolean;
  spin_double_odds: number;
  streak_enabled: boolean;
  referral_enabled: boolean;
  install_bonus_enabled: boolean;
  birthday_reward_enabled: boolean;
  tiers: Tier[];
  ugc_agreement: string | null;
  pdpa_text: string | null;
  timezone: string;
  created_at: string;
};

export type Outlet = {
  id: string;
  brand_id: string;
  name: string;
  address: string | null;
  active: boolean;
};

export type Staff = {
  id: string;
  brand_id: string;
  outlet_id: string | null;
  name: string;
  pin_hash: string;
  role: "staff" | "manager";
  active: boolean;
};

export type Customer = {
  id: string;
  brand_id: string;
  phone: string;
  name: string;
  email: string | null;
  birthday: string | null;
  kind: "customer" | "influencer";
  marketing_consent: boolean;
  consent_at: string | null;
  stamp_balance: number;
  lifetime_stamps: number;
  visits: number;
  last_visit_at: string | null;
  referral_code: string;
  referred_by: string | null;
  referral_rewarded: boolean;
  push_subscription: PushSubscriptionJSON | null;
  push_enabled_at: string | null;
  telegram_chat_id: number | null;
  whatsapp_opt_in: boolean;
  installed_at: string | null;
  install_bonus_given: boolean;
  migration_credited: boolean;
  birthday_reward_year: number | null;
  spin_available: boolean;
  notes: string | null;
  created_at: string;
};

export type PushSubscriptionJSON = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type Reward = {
  id: string;
  brand_id: string;
  customer_id: string;
  code: string;
  type: "stamp_card" | "influencer" | "birthday" | "manual";
  title: string;
  status: "available" | "locked" | "redeemed" | "expired" | "void";
  unlock_condition: string | null;
  grant_id: string | null;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  redeemed_outlet_id: string | null;
  redeemed_staff_id: string | null;
};

export type Stamp = {
  id: string;
  brand_id: string;
  customer_id: string;
  outlet_id: string | null;
  staff_id: string | null;
  qty: number;
  source: "staff" | "migration" | "spin" | "streak" | "referral" | "install" | "admin" | "campaign";
  multiplier: number;
  note: string | null;
  created_at: string;
};

export type InfluencerGrant = {
  id: string;
  brand_id: string;
  customer_id: string | null;
  invite_code: string;
  handle: string;
  platform: "instagram" | "tiktok" | "lemon8" | "xiaohongshu" | "youtube" | "other";
  followers: number | null;
  rewards_total: number;
  rewards_upfront: number;
  reward_title: string;
  content_due_date: string | null;
  deliverable: string;
  agreement_text: string | null;
  status: "invited" | "accepted" | "posted" | "verified" | "expired" | "cancelled";
  accepted_at: string | null;
  post_url: string | null;
  posted_at: string | null;
  verified_at: string | null;
  reach_notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type Campaign = {
  id: string;
  brand_id: string;
  title: string;
  body: string;
  url_path: string | null;
  segment: "all" | "near_reward" | "lapsed_14" | "lapsed_30" | "influencers" | "push_only" | "telegram_only";
  bonus_stamps: number;
  status: "draft" | "sending" | "sent" | "failed";
  scheduled_at: string | null;
  sent_at: string | null;
  audience: number;
  delivered: number;
  created_by: string | null;
  created_at: string;
};

export type DoubleStampWindow = {
  id: string;
  brand_id: string;
  outlet_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  multiplier: number;
  announced: boolean;
};

export type BrandStats = {
  customers: number;
  signups_7d: number;
  signups_30d: number;
  active_30d: number;
  returning_30d: number;
  stamps_today: number;
  stamps_7d: number;
  stamps_30d: number;
  rewards_issued: number;
  rewards_redeemed: number;
  rewards_open: number;
  push_opt_in: number;
  telegram_linked: number;
  installed: number;
  influencers: number;
  near_reward: number;
  lapsed_14: number;
  daily: { day: string; stamps: number; signups: number }[];
};

/** What the customer card page needs, in one payload. */
export type CardPayload = {
  brand: Pick<
    Brand,
    | "slug" | "name" | "tagline" | "logo_url" | "primary_color" | "accent_color" | "stamps_per_reward"
    | "stamp_label" | "reward_name" | "spin_enabled" | "referral_enabled" | "install_bonus_enabled" | "tiers"
  >;
  customer: Pick<
    Customer,
    | "id" | "name" | "phone" | "kind" | "stamp_balance" | "lifetime_stamps" | "visits" | "last_visit_at"
    | "referral_code" | "push_enabled_at" | "telegram_chat_id" | "installed_at" | "spin_available" | "marketing_consent"
  >;
  rewards: Pick<Reward, "id" | "code" | "type" | "title" | "status" | "expires_at" | "redeemed_at" | "unlock_condition">[];
  recentStamps: Pick<Stamp, "id" | "qty" | "source" | "created_at">[];
  grant: Pick<InfluencerGrant, "id" | "status" | "content_due_date" | "deliverable" | "rewards_total" | "rewards_upfront" | "post_url"> | null;
  activeDouble: Pick<DoubleStampWindow, "title" | "ends_at" | "multiplier"> | null;
  tier: { current: Tier; next: Tier | null; progress: number };
  telegramBot: string | null;
  vapidPublicKey: string | null;
};
