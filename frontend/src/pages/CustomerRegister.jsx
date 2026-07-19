import React, { useState } from "react";
import { useNavigate, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function CustomerRegister() {
  const { customerRegister, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);

  const redirectTo = loc.state?.from || "/dashboard";
  if (user?.kind === "customer") return <Navigate to={redirectTo} replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email && !form.phone) {
      toast.error("Please provide an email or phone number");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      await customerRegister(form);
      toast.success("Account created — welcome to TripleSide!");
      nav(redirectTo, { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handle = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div data-testid="customer-register-page" className="min-h-screen flex items-center justify-center px-6 pt-24 pb-20">
      <form onSubmit={submit} className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl p-10">
        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          <UserPlus className="w-5 h-5 text-[#e11d48]" />
        </div>
        <h1 className="font-[Outfit] text-3xl font-bold mb-2">Create your account</h1>
        <p className="text-sm text-zinc-400 mb-8">Join TripleSide to buy and access digital products.</p>

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Full Name <span className="text-[#e11d48]">*</span>
        </label>
        <input
          data-testid="register-name"
          value={form.name}
          onChange={handle("name")}
          required
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
        />

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Email</label>
        <input
          data-testid="register-email"
          type="email"
          value={form.email}
          onChange={handle("email")}
          placeholder="you@example.com"
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
        />

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Phone</label>
        <input
          data-testid="register-phone"
          type="tel"
          value={form.phone}
          onChange={handle("phone")}
          placeholder="+62 812 3456 7890"
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
        />
        <div className="text-[11px] text-zinc-500 -mt-3 mb-5 font-mono">
          Provide at least one — email or phone.
        </div>

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Password <span className="text-[#e11d48]">*</span>
        </label>
        <input
          data-testid="register-password"
          type="password"
          value={form.password}
          onChange={handle("password")}
          required
          minLength={6}
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-8 focus:outline-none focus:border-[#e11d48]"
        />
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Confirm Password <span className="text-[#e11d48]">*</span>
        </label>
        <input
          data-testid="register-confirm-password"
          type="password"
          value={form.confirmPassword}
          onChange={handle("confirmPassword")}
          required
          minLength={6}
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-8 focus:outline-none focus:border-[#e11d48]"
        />

        <button
          data-testid="register-submit"
          disabled={loading || form.password !== form.confirmPassword
          }
          className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Account"}
        </button>

        <p className="mt-6 text-center text-sm text-zinc-400">
          Already have an account?{" "}
          <Link to="/login" className="text-[#e11d48] font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
