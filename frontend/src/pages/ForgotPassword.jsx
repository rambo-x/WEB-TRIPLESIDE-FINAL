import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { MailQuestion, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/customer/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="forgot-password-page" className="min-h-screen flex items-center justify-center px-6 pt-20 pb-20">
      <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-10">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>

        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          <MailQuestion className="w-5 h-5 text-[#e11d48]" />
        </div>

        {!sent ? (
          <>
            <h1 className="font-[Outfit] text-3xl font-bold mb-2">Forgot password?</h1>
            <p className="text-sm text-zinc-400 mb-8">Enter your email and we&apos;ll send you a reset link.</p>

            <form onSubmit={submit}>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Email</label>
              <input
                data-testid="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-8 focus:outline-none focus:border-[#e11d48]"
              />
              <button
                data-testid="forgot-submit"
                disabled={loading}
                className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-[Outfit] text-3xl font-bold mb-2">Check your inbox</h1>
            <p className="text-sm text-zinc-400 mb-2">
              If an account with <span className="text-white font-medium">{email}</span> exists, a password reset link is on its way.
            </p>
            <p className="text-xs text-zinc-500 mt-6 font-mono">Link valid for 1 hour. Check spam folder too.</p>
          </>
        )}
      </div>
    </div>
  );
}
