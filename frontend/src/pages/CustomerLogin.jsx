import React, { useState } from "react";
import { useNavigate, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LogIn, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function CustomerLogin() {
  const { customerLogin, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const redirectTo = loc.state?.from || "/dashboard";
  if (user?.kind === "customer") return <Navigate to={redirectTo} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await customerLogin(identifier.trim(), password);
      toast.success("Welcome back!");
      nav(redirectTo, { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="customer-login-page" className="min-h-screen flex items-center justify-center px-6 pt-20 pb-20">
      <form onSubmit={submit} className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-10">
        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          <LogIn className="w-5 h-5 text-[#e11d48]" />
        </div>
        <h1 className="font-[Outfit] text-3xl font-bold mb-2">Welcome back</h1>
        <p className="text-sm text-zinc-400 mb-8">Sign in to your TripleSide account.</p>

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Email or Phone
        </label>
        <input
          data-testid="customer-login-identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          type="text"
          required
          placeholder="you@example.com or +62..."
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
        />

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Password</label>
        <input
          data-testid="customer-login-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-3 focus:outline-none focus:border-[#e11d48]"
        />

        <div className="flex justify-end mb-8">
          <Link to="/forgot-password" data-testid="forgot-password-link" className="text-xs text-zinc-400 hover:text-[#e11d48]">
            Forgot password?
          </Link>
        </div>

        <button
          data-testid="customer-login-submit"
          disabled={loading}
          className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
        </button>

        <p className="mt-6 text-center text-sm text-zinc-400">
          New here?{" "}
          <Link to="/register" className="text-[#e11d48] font-semibold hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
