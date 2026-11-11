"use client";
import { useEffect } from "react";
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("StampOS admin request failed", error); }, [error]);
  return <div className="adm-card mx-auto my-10 max-w-lg space-y-3" role="alert">
    <h1 className="text-xl font-bold">We couldn't complete that request</h1>
    <p>Please refresh and check the saved record before trying again, especially when adding stamps or rewards. No success has been confirmed.</p>
    {error.digest && <p className="text-xs">Support reference: {error.digest}</p>}
    <button onClick={reset} className="adm-btn-brand">Refresh this page</button>
  </div>;
}
