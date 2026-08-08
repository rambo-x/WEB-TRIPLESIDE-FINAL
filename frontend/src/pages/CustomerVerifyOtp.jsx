import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

const PENDING_KEY = "ts_pending_registration";

function loadPendingRegistration(routeState) {
  if (routeState?.registrationId) return routeState;
  try {
    const stored = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    return stored?.registrationId ? stored : null;
  } catch {
    return null;
  }
}

export default function CustomerVerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { customerRegister, customerRegistrationResend, user } = useAuth();
  const [pending, setPending] = useState(() => loadPendingRegistration(location.state));
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (user?.kind === "customer") {
    return <Navigate to={pending?.redirectTo || "/dashboard"} replace />;
  }

  if (!pending) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 pt-24 pb-20">
        <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-10 text-center">
          <MailCheck className="w-10 h-10 text-[#e11d48] mx-auto mb-5" />
          <h1 className="font-[Outfit] text-2xl font-bold mb-3">No active registration</h1>
          <p className="text-sm text-zinc-400 mb-7">
            Return to registration and submit your details to receive a new OTP.
          </p>
          <Link to="/register" className="text-[#fb7185] font-semibold hover:underline">
            Back to registration
          </Link>
        </div>
      </div>
    );
  }

  const resendSeconds = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));
  const expiresSeconds = Math.max(0, Math.ceil((pending.expiresAt - now) / 1000));
  const expired = expiresSeconds <= 0;

  const persistPending = (next) => {
    setPending(next);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(next));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      toast.error("Enter the 6-digit OTP from your email");
      return;
    }
    if (expired) {
      toast.error("This OTP has expired. Request a new code.");
      return;
    }

    setLoading(true);
    try {
      await customerRegister(pending.registrationId, otp);
      sessionStorage.removeItem(PENDING_KEY);
      toast.success("Account verified and created — welcome to TripleSide!");
      navigate(pending.redirectTo || "/dashboard", { replace: true });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendSeconds > 0 || resending) return;
    setResending(true);
    try {
      const response = await customerRegistrationResend(pending.registrationId);
      persistPending({
        ...pending,
        emailHint: response.email_hint || pending.emailHint,
        resendAt: Date.now() + (response.resend_after || 60) * 1000,
        expiresAt: Date.now() + (response.expires_in || 600) * 1000,
      });
      setOtp("");
      toast.success("A new OTP code was sent to your email.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to resend OTP code");
    } finally {
      setResending(false);
    }
  };

  const restartRegistration = () => {
    sessionStorage.removeItem(PENDING_KEY);
  };

  return (
    <div data-testid="customer-register-verify-page" className="min-h-screen flex items-center justify-center px-6 pt-24 pb-20">
      <form onSubmit={submit} className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-8 sm:p-10">
        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          <MailCheck className="w-5 h-5 text-[#e11d48]" />
        </div>
        <h1 className="font-[Outfit] text-3xl font-bold mb-2">Verify your email</h1>
        <p className="text-sm text-zinc-400 mb-8">
          Enter the 6-digit code sent to <span className="text-zinc-200">{pending.emailHint}</span>.
          Your account will only be created after verification.
        </p>

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Email OTP
        </label>
        <input
          autoFocus
          data-testid="register-verify-otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otp}
          onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-4 text-center text-2xl tracking-[0.45em] font-mono mb-3 focus:outline-none focus:border-[#e11d48]"
        />
        <div className={`text-xs mb-6 ${expired ? "text-amber-400" : "text-zinc-500"}`}>
          {expired ? "OTP expired. Request a new code." : `Code expires in ${Math.floor(expiresSeconds / 60)}:${String(expiresSeconds % 60).padStart(2, "0")}`}
        </div>

        <button
          data-testid="register-verify-submit"
          disabled={loading || expired || !/^\d{6}$/.test(otp)}
          className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Create Account"}
        </button>

        <button
          type="button"
          onClick={resend}
          disabled={resendSeconds > 0 || resending}
          className="w-full mt-4 py-3 text-sm text-[#fb7185] font-semibold disabled:text-zinc-600"
        >
          {resending
            ? "Sending..."
            : resendSeconds > 0
              ? `Resend OTP in ${resendSeconds}s`
              : "Resend OTP"}
        </button>

        <Link
          to="/register"
          onClick={restartRegistration}
          className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Edit registration details
        </Link>
      </form>
    </div>
  );
}
