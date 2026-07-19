import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function AdminLogin() {
  const { adminLogin, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@tripleside.studio");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user?.kind === "admin") return <Navigate to="/admin" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await adminLogin(email, password);
      toast.success("Welcome back");
      nav("/admin");
    } catch {
      toast.error("Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="admin-login-page" className="min-h-screen flex items-center justify-center px-6 pt-20 pb-20">
      <form onSubmit={submit} className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-10">
        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          <Lock className="w-5 h-5 text-[#e11d48]" />
        </div>
        <h1 className="font-[Outfit] text-3xl font-bold mb-2">Admin Sign In</h1>
        <p className="text-sm text-zinc-400 mb-8">Access the TripleSide Studio admin dashboard.</p>

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Email</label>
        <input
          data-testid="login-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
        />

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Password</label>
        <input
          data-testid="login-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-8 focus:outline-none focus:border-[#e11d48]"
        />

        <button
          data-testid="login-submit"
          disabled={loading}
          className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
        </button>
      </form>
    </div>
  );
}
