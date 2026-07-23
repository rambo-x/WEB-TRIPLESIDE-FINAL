import React, { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { CheckCircle2, Download, XCircle, Loader2 } from "lucide-react";export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const orderId = params.get("order_id");
  const paypalToken = params.get("token");
  const [state, setState] = useState("polling"); // polling | paid | failed | expired
  const [data, setData] = useState(null);
  const pollRef = useRef({ attempts: 0 });

  useEffect(() => {
    if (!sessionId && !orderId && !paypalToken) {
      setState("failed");
      return;
    }
    const statusUrl = paypalToken
      ? `/checkout/paypal/capture?token=${paypalToken}`
      : orderId
        ? `/checkout/midtrans/status/${orderId}`
        : `/checkout/status/${sessionId}`;
    let timer;
    const poll = async () => {
      if (pollRef.current.attempts >= 10) {
        setState("failed");
        return;
      }
      pollRef.current.attempts += 1;
      try {
        const r = await api.get(statusUrl);
        setData(r.data);
        if (r.data.payment_status === "paid") {
          setState("paid");
          return;
        }
        if (r.data.status === "expired" || r.data.payment_status === "failed") {
          setState("expired");
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch {
        timer = setTimeout(poll, 2500);
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, [sessionId, orderId, paypalToken]);

  return (
    <div data-testid="payment-success-page" className="min-h-screen flex items-center justify-center px-6 pt-20 pb-32">
      <div className="max-w-lg w-full bg-[#0a0a0c] border border-white/10 rounded-2xl p-10 text-center">
        {state === "polling" && (
          <>
            <Loader2 className="w-12 h-12 mx-auto text-[#e11d48] animate-spin mb-6" />
            <h1 className="font-[Outfit] text-3xl font-bold mb-3">Confirming payment...</h1>
            <p className="text-zinc-400">Please wait while we verify your transaction.</p>
          </>
        )}
        {state === "paid" && data && (
          <>
            <CheckCircle2 className="w-14 h-14 mx-auto text-[#e11d48] mb-6" />
            <h1 className="font-[Outfit] text-4xl font-black mb-3">Payment Successful</h1>
            <p className="text-zinc-400 mb-8">Your digital product is now in your account.</p>
            <Link
              data-testid="goto-dashboard"
              to="/dashboard"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors glow-brand"
            >
              <Download className="w-4 h-4" />
              Go to Dashboard
            </Link>
            <div className="mt-6">
              <Link to="/shop" className="text-xs text-zinc-500 hover:text-white">← Continue shopping</Link>
            </div>
          </>
        )}
        {(state === "failed" || state === "expired") && (
          <>
            <XCircle className="w-14 h-14 mx-auto text-red-500 mb-6" />
            <h1 className="font-[Outfit] text-3xl font-bold mb-3">
              {state === "expired" ? "Session expired" : "Payment not confirmed"}
            </h1>
            <p className="text-zinc-400 mb-6">Please try again or contact support.</p>
            <Link to="/shop" className="inline-flex px-6 py-3 rounded-full border border-white/15 font-semibold hover:bg-white/5">
              Back to Shop
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
