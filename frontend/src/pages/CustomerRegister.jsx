import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { CheckCircle2, Loader2, Phone, UserPlus } from "lucide-react";
import { toast } from "sonner";

export default function CustomerRegister() {
  const { customerRegistrationStart, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [countries, setCountries] = useState([]);
  const [phoneCountry, setPhoneCountry] = useState("ID");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneStatus, setPhoneStatus] = useState({
    checking: false,
    valid: false,
    e164: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);

  const redirectTo = loc.state?.from || "/dashboard";
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const passwordsValid =
    form.password.length >= 6 && form.password === form.confirmPassword;
  const canSubmit =
    form.name.trim() &&
    emailValid &&
    phoneStatus.valid &&
    passwordsValid &&
    !loading;

  const regionNames = useMemo(() => {
    if (typeof Intl.DisplayNames !== "function") return null;
    return new Intl.DisplayNames(["en"], { type: "region" });
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get("/customer/phone-countries")
      .then((response) => {
        if (!active) return;
        setCountries(response.data);
        if (!response.data.some((item) => item.country === "ID") && response.data[0]) {
          setPhoneCountry(response.data[0].country);
        }
      })
      .catch(() => {
        if (active) toast.error("Unable to load international phone countries");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const value = phoneInput.trim();
    setPhoneStatus({ checking: false, valid: false, e164: "", message: "" });
    if (value.replace(/\D/g, "").length < 4) return undefined;

    let active = true;
    const timer = window.setTimeout(async () => {
      setPhoneStatus({ checking: true, valid: false, e164: "", message: "" });
      try {
        const response = await api.post("/customer/validate-phone", {
          country_code: phoneCountry,
          phone: value,
        });
        if (active) {
          setPhoneStatus({
            checking: false,
            valid: true,
            e164: response.data.e164,
            message: `Valid number: ${response.data.e164}`,
          });
        }
      } catch (error) {
        if (active) {
          setPhoneStatus({
            checking: false,
            valid: false,
            e164: "",
            message:
              error?.response?.data?.detail ||
              "Enter a valid number for the selected country",
          });
        }
      }
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [phoneCountry, phoneInput]);

  if (user?.kind === "customer") return <Navigate to={redirectTo} replace />;

  const handle = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) {
      toast.error("Complete the form and verify your phone number");
      return;
    }

    setLoading(true);
    try {
      const pending = await customerRegistrationStart({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: phoneStatus.e164,
        phone_country: phoneCountry,
        password: form.password,
      });
      const verificationState = {
        registrationId: pending.registration_id,
        emailHint: pending.email_hint,
        resendAt: Date.now() + (pending.resend_after || 60) * 1000,
        expiresAt: Date.now() + (pending.expires_in || 600) * 1000,
        redirectTo,
      };
      sessionStorage.setItem("ts_pending_registration", JSON.stringify(verificationState));
      toast.success("OTP code sent. Check your email inbox.");
      nav("/register/verify", { state: verificationState });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to start registration");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="customer-register-page"
      className="min-h-screen flex items-center justify-center px-6 pt-24 pb-20"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-[#0a0a0c] border border-white/10 rounded-2xl p-8 sm:p-10"
      >
        <div className="w-12 h-12 rounded-xl bg-[#e11d48]/15 flex items-center justify-center mb-6">
          <UserPlus className="w-5 h-5 text-[#e11d48]" />
        </div>
        <h1 className="font-[Outfit] text-3xl font-bold mb-2">Create your account</h1>
        <p className="text-sm text-zinc-400 mb-8">
          Complete your details. We will email an OTP before creating your account.
        </p>

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

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Email <span className="text-[#e11d48]">*</span>
        </label>
        <input
          data-testid="register-email"
          type="email"
          value={form.email}
          onChange={handle("email")}
          placeholder="you@example.com"
          required
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
        />

        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">
          International Phone <span className="text-[#e11d48]">*</span>
        </label>
        <div className="grid grid-cols-[minmax(130px,0.9fr)_minmax(0,1.6fr)] gap-2 mb-2">
          <select
            data-testid="register-phone-country"
            value={phoneCountry}
            onChange={(event) => setPhoneCountry(event.target.value)}
            className="bg-[#050505] border border-white/10 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#e11d48]"
          >
            {countries.map((item) => (
              <option key={item.country} value={item.country}>
                {regionNames?.of(item.country) || item.country} ({item.calling_code})
              </option>
            ))}
          </select>
          <div className="relative">
            <Phone className="absolute left-3 top-3.5 w-4 h-4 text-zinc-600" />
            <input
              data-testid="register-phone"
              type="tel"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              placeholder="812 3456 7890"
              required
              className="w-full bg-[#050505] border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#e11d48]"
            />
          </div>
        </div>
        <div
          className={`min-h-5 text-[11px] mb-5 ${
            phoneStatus.valid ? "text-emerald-400" : "text-zinc-500"
          }`}
        >
          {phoneStatus.checking ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking phone number...
            </span>
          ) : phoneStatus.valid ? (
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3" /> {phoneStatus.message}
            </span>
          ) : (
            phoneStatus.message || "Select a country and enter the local phone number."
          )}
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
          className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm mb-5 focus:outline-none focus:border-[#e11d48]"
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
          disabled={!canSubmit}
          className="w-full py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
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
