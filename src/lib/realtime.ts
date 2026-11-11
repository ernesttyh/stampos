import { supabaseAdmin } from "./supabase/admin";

/**
 * Push a live event to one customer's open card (Supabase Realtime broadcast over REST — no table access,
 * no websocket on the server). The card subscribes to channel `card:<customerId>`; it also polls as a fallback.
 */
export async function broadcastToCard(customerId: string, event: string, payload: Record<string, unknown>) {
  const sb = supabaseAdmin();
  const channel = sb.channel(`card:${customerId}`);
  try {
    await channel.httpSend(event, payload, { timeout: 4000 });
  } catch {
    // best effort — the card polls every few seconds anyway
  } finally {
    await sb.removeChannel(channel).catch(() => undefined);
  }
}
