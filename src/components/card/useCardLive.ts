"use client";
import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type LiveStampEvent = {
  added: number;
  balance: number;
  minted: number;
  multiplier?: number;
  bonuses?: { source: string; qty: number; label: string }[];
};

/**
 * Keeps the card live: Supabase Realtime broadcast for instant stamps + polling as a safety net.
 */
export function useCardLive(customerId: string, handlers: { onStamp: (e: LiveStampEvent) => void; onRedeemed: () => void; onPoll: () => void }) {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`card:${customerId}`)
      .on("broadcast", { event: "stamp" }, ({ payload }) => h.current.onStamp(payload as LiveStampEvent))
      .on("broadcast", { event: "redeemed" }, () => h.current.onRedeemed())
      .subscribe();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") h.current.onPoll();
      }, 8000);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") h.current.onPoll();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      sb.removeChannel(channel);
    };
  }, [customerId]);
}
