import React, { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import { KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error("Password must be at least 6 characters");
    if (pw !== pw2) return toast.error("Passwords do not match");
    setLoading(true);
    try {
      await api.post("/customer/reset-password", { token, new_password: pw });
      setDone(true);
      setTimeout(() => nav("/login"), 1800);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 pt-20">
        <div className="text-center text-zinc-400">
          <p>Invalid reset link.</p>
          <Link to="/forgot-password" className="text-[#e11d48] hover:underline mt-4 inline-block">Request a new one</Link>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="reset-password-page" className="min-h-screen flex items-center justify-center px-6 pt-20 pb-20">
      <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-10">
        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          {done ? <CheckCircle2 className="w-5 h-5 text-[#e11d48]" /> : <KeyRound className="w-5 h-5 text-[#e11d48]" />}
        </div>

        {!done ? (
          <>
            <h1 className="font-[Outfit] text-3xl font-bold mb-2">Set a new password</h1>
            <p className="text-sm text-zinc-400 mb-8">Choose a strong password (min. 6 characters).</p>

            <form onSubmit={submit}>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">New password</label>
              <input
                data-testid="reset-password-new"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
              />

              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Confirm password</label>
              <input
                data-testid="reset-password-confirm"
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                required
                className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-8 focus:outline-none focus:border-[#e11d48]"
              />

              <button
                data-testid="reset-password-submit"
                disabled={loading}
                className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-[Outfit] text-3xl font-bold mb-2">Password updated</h1>
            <p className="text-sm text-zinc-400">Redirecting to sign in...</p>
          </>
        )}
      </div>
    </div>
  );
}
