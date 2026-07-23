import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, fmtPrice } from "../lib/api";
import { useAudio } from "../context/AudioContext";
import { useAuth } from "../context/AuthContext";
import { Play, Pause, ShoppingBag, Check, Loader2, ArrowLeft, LogIn, Tag, X, Download, Clock3 } from "lucide-react";
import { toast } from "sonner";

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMt, setLoadingMt] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState(null); // {code, discount, final_amount}
  const [couponLoading, setCouponLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const { current, playing, playTrack } = useAudio();
  const { isCustomer } = useAuth();

  useEffect(() => {
    api.get(`/products/${id}`).then((r) => setProduct(r.data)).catch(() => nav("/shop"));
  }, [id, nav]);

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCouponLoading(true);
    try {
      const r = await api.post("/checkout/apply-coupon", { code, product_id: id });
      setCouponApplied(r.data);
      toast.success(`Coupon applied: -${fmtPrice(r.data.discount)}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Invalid coupon");
      setCouponApplied(null);
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCouponApplied(null);
    setCouponInput("");
  };

  const claimFree = async () => {
    if (!isCustomer) {
      toast.info("Please sign in to claim this free product");
      nav("/login", { state: { from: `/shop/${id}` } });
      return;
    }
    setLoading(true);
    try {
      const r = await api.post(`/free-claim/${id}`);
      toast.success(r.data.already_claimed ? "You already own this" : "Added to your library!");
      nav("/dashboard");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to claim");
      setLoading(false);
    }
  };

  const payPal = async () => {
    if (product?.is_free) {
      return claimFree();
    }
    if (!isCustomer) {
      toast.info("Please sign in to purchase");
      nav("/login", { state: { from: `/shop/${id}` } });
      return;
    }
    setLoading(true);
    try {
      const r = await api.post("/checkout/session", {
        product_id: id,
        origin_url: window.location.origin,
        coupon_code: couponApplied?.code || "",
      });
      window.location.href = r.data.url;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start checkout");
      setLoading(false);
    }
  };


 const startTrial = async () => {
  if (trialLoading) return;

  if (!isCustomer) {
    toast.info("Please sign in to start your trial");
    nav("/login", { state: { from: `/shop/${id}` } });
    return;
  }

  setTrialLoading(true);

  try {
    const token = localStorage.getItem("ts_token");

    // 🔥 REQUEST PERTAMA (PAKSA BAWA TOKEN)
    let res;
    try {
      res = await api.post(`/customer/trials/${id}`, {}, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      // 🔥 JIKA 401 → RETRY SEKALI (INI KUNCI FIX KLIK 2x)
      if (err?.response?.status === 401) {
        console.warn("Retry trial after 401...");

        res = await api.post(`/customer/trials/${id}`, {}, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("ts_token")}`,
          },
        });
      } else if (err?.response) {
        res = err.response;
      } else {
        throw err;
      }
    }

    const downloadUrl = res?.data?.download_url;

    if (!downloadUrl) {
      console.error("TRIAL RESPONSE:", res?.data);
      toast.error("Download URL tidak ditemukan");
      return;
    }

    // ✅ LANGSUNG DOWNLOAD
    window.location.replace(downloadUrl);

  } catch (e) {
    console.error("TRIAL ERROR:", e);

    toast.error(
      e?.response?.data?.detail ||
      "Failed to create trial"
    );
  } finally {
    setTrialLoading(false);
  }
};
  const loadSnap = (clientKey, isProduction) =>
    new Promise((resolve, reject) => {
      if (window.snap) return resolve();
      const src = isProduction
        ? "https://app.midtrans.com/snap/snap.js"
        : "https://app.sandbox.midtrans.com/snap/snap.js";
      const existing = document.getElementById("midtrans-snap");
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("snap load error")));
        return;
      }
      const s = document.createElement("script");
      s.id = "midtrans-snap";
      s.src = src;
      s.setAttribute("data-client-key", clientKey || "");
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Gagal memuat Midtrans"));
      document.body.appendChild(s);
    });

  const payMidtrans = async () => {
    if (!isCustomer) {
      toast.info("Silakan masuk untuk membeli");
      nav("/login", { state: { from: `/shop/${id}` } });
      return;
    }
    setLoadingMt(true);
    try {
      const r = await api.post("/checkout/midtrans/session", {
        product_id: id,
        origin_url: window.location.origin,
        coupon_code: couponApplied?.code || "",
      });
      await loadSnap(r.data.client_key, r.data.is_production);
      if (!window.snap) {
        window.location.href = r.data.redirect_url;
        return;
      }
      window.snap.pay(r.data.token, {
        onSuccess: () => nav(`/payment/success?order_id=${r.data.order_id}`),
        onPending: () => nav(`/payment/success?order_id=${r.data.order_id}`),
        onError: () => {
          toast.error("Pembayaran gagal");
          setLoadingMt(false);
        },
        onClose: () => setLoadingMt(false),
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal memulai pembayaran Midtrans");
      setLoadingMt(false);
    }
  };

  if (!product) {
    return <div className="pt-40 text-center text-zinc-500">Loading...</div>;
  }

  const isCurrent = current?.id === `preview-${product.id}`;
  const previewTrack = product.preview_audio_url
    ? {
        id: `preview-${product.id}`,
        title: product.name,
        artist: "Preview",
        audio_url: product.preview_audio_url,
        cover_url: product.image_url,
      }
    : null;

  return (
    <div data-testid="product-detail-page" className="max-w-7xl mx-auto px-6 md:px-12 pt-28 pb-32">
      <Link to="/shop" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Shop
      </Link>

      <div className="grid md:grid-cols-2 gap-12 fade-up">
        <div className="md:sticky md:top-28 md:self-start">
          <div className="relative aspect-square rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a0c]">
            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
          </div>
          {previewTrack && (
            <button
              data-testid="preview-play-btn"
              onClick={() => playTrack(previewTrack)}
              className="mt-6 w-full flex items-center justify-center gap-3 py-4 rounded-full border border-white/15 hover:bg-white/5 transition-colors font-semibold"
            >
              {isCurrent && playing ? <Pause className="w-4 h-4" fill="white" /> : <Play className="w-4 h-4" fill="white" />}
              Preview Audio
            </button>
          )}
        </div>

        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-[10px] font-mono text-[#e11d48] uppercase tracking-[0.3em]">{product.category}</div>
            {product.is_free && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Free
              </span>
            )}
          </div>
          <h1 className="font-[Outfit] text-4xl md:text-6xl font-black tracking-tighter mb-4">{product.name}</h1>
          {product.is_free ? (
            <div className="font-[Outfit] text-5xl font-black text-emerald-400 mb-8" data-testid="product-price">
              Free
            </div>
          ) : couponApplied ? (
            <div className="mb-8" data-testid="product-price">
              <div className="text-2xl line-through text-zinc-500 font-[Outfit] font-bold">
                {fmtPrice(couponApplied.original_amount)}
              </div>
              <div className="font-[Outfit] text-5xl font-black text-[#e11d48]">
                {fmtPrice(couponApplied.final_amount)}
              </div>
              <div className="text-xs font-mono text-emerald-400 mt-1">
                Saved {fmtPrice(couponApplied.discount)} with {couponApplied.code}
              </div>
            </div>
          ) : (
            <div className="font-[Outfit] text-5xl font-black text-[#e11d48] mb-8" data-testid="product-price">
              {fmtPrice(product.price)}
            </div>
          )}

          <p className="text-zinc-300 leading-relaxed mb-8 text-lg">{product.description}</p>

          {product.requires_license && (
            <div className="mb-6 rounded-xl border border-white/10 bg-[#0a0a0c] p-4 text-sm text-zinc-300">
              <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> One serial, usable on up to <strong className="text-white">{product.max_activations || 1} computer(s)</strong>.</div>
              {product.trial_enabled !== false && <div className="mt-2 flex items-center gap-2"><Clock3 className="h-4 w-4 text-[#fb7185]" /> Try every feature free for <strong className="text-white">{product.trial_days || 7} days</strong>.</div>}
            </div>
          )}

          <div className="space-y-3 mb-8">
            {["Instant download after purchase", "Royalty-free for personal & commercial use", "Email receipt + invoice PDF"].map((f) => (
              <div key={f} className="flex items-center gap-3 text-sm text-zinc-300">
                <div className="w-6 h-6 rounded-full bg-[#e11d48]/20 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-[#e11d48]" />
                </div>
                {f}
              </div>
            ))}
          </div>

          {product.requires_license && product.trial_enabled !== false && (
            <button
              data-testid="start-trial-btn"
              onClick={startTrial}
              disabled={trialLoading}
              className="mb-6 w-full flex items-center justify-center gap-2 py-3 rounded-full border border-[#e11d48]/50 text-[#fb7185] hover:bg-[#e11d48]/10 font-semibold disabled:opacity-60"
            >
              {trialLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock3 className="w-4 h-4" />}
              Try Free for {product.trial_days || 7} Days
            </button>
          )}

          {/* Coupon (hidden for free products) */}
          {!product.is_free && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Tag className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Discount code</span>
              </div>
              {couponApplied ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                  <Tag className="w-4 h-4 text-emerald-400" />
                  <span className="font-mono font-bold text-emerald-400">{couponApplied.code}</span>
                  <span className="text-xs text-zinc-400 flex-1">applied</span>
                  <button
                    data-testid="coupon-remove"
                    onClick={removeCoupon}
                    className="p-1 rounded-full hover:bg-white/5 text-zinc-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    data-testid="coupon-input"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Enter code"
                    className="flex-1 bg-[#050505] border border-white/10 rounded-full px-4 py-2.5 text-sm font-mono uppercase focus:outline-none focus:border-[#e11d48]"
                  />
                  <button
                    data-testid="coupon-apply"
                    onClick={applyCoupon}
                    disabled={couponLoading || !couponInput.trim()}
                    className="px-5 py-2.5 rounded-full border border-white/15 text-sm font-semibold hover:bg-white/5 disabled:opacity-50"
                  >
                    {couponLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                  </button>
                </div>
              )}
            </div>
          )}

          {product.is_free ? (
            <button
              data-testid="buy-now-btn"
              onClick={checkout}
              disabled={loading}
              className="w-full md:w-auto px-10 py-4 rounded-full font-semibold transition-colors flex items-center justify-center gap-3 disabled:opacity-60 bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Working...</>
              ) : isCustomer ? (
                <><Download className="w-4 h-4" /> Get for Free</>
              ) : (
                <><LogIn className="w-4 h-4" /> Sign In to Get Free</>
              )}
            </button>
          ) : (
            <div className="space-y-3 max-w-md">
              <button
                data-testid="pay-midtrans-btn"
                onClick={payMidtrans}
                disabled={loadingMt || loading}
                className="w-full px-10 py-4 rounded-full font-semibold transition-colors flex items-center justify-center gap-3 disabled:opacity-60 bg-[#e11d48] hover:bg-[#be123c] glow-brand"
              >
                {loadingMt ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Opening secure checkout...</>
                ) : isCustomer ? (
                  <><ShoppingBag className="w-4 h-4" /> Buy Now</>
                ) : (
                  <><LogIn className="w-4 h-4" /> Masuk untuk Membeli</>
                )}
              </button>
              <button
                data-testid="pay-payPal-btn"
                onClick={payPal}
                disabled={loading || loadingMt}
                className="w-full px-10 py-3.5 rounded-full font-semibold transition-colors flex items-center justify-center gap-3 disabled:opacity-60 border border-white/15 hover:bg-white/5 text-zinc-200"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Working...</>
                ) : (
                  <><ShoppingBag className="w-4 h-4" /> Bayar dengan Kartu (Stripe)</>
                )}
              </button>
            </div>
          )}

          <p className="text-xs text-zinc-500 mt-4 font-mono">
            {product.is_free
              ? "100% gratis · Cukup masuk untuk menambahkannya ke library Anda."
              : isCustomer
              ? "Pembayaran aman · Midtrans (GoPay, VA, QRIS, kartu) atau Stripe · Rupiah"
              : "Anda perlu akun untuk membeli produk digital."}
          </p>
        </div>
      </div>
    </div>
  );
}
