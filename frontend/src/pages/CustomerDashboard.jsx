import React, { useEffect, useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, fmtPrice, BACKEND_URL } from "../lib/api";
import { User, ShoppingBag, Download, Pencil, LogOut, Check, Loader2, Mail, Phone, FileText, Trash2, KeyRound, Copy, MonitorOff, Clock3 } from "lucide-react";
import { toast } from "sonner";

export default function CustomerDashboard() {
  const { user, loading, isCustomer, updateProfile, logout } = useAuth();
  const nav = useNavigate();
  const [orders, setOrders] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isCustomer) {
      api.get("/customer/orders").then((r) => setOrders(r.data)).catch(() => setOrders([]));
      api.get("/customer/licenses").then((r) => setLicenses(r.data)).catch(() => setLicenses([]));
      setForm({
        name: user.profile.name || "",
        email: user.profile.email || "",
        phone: user.profile.phone || "",
      });
    }
  }, [isCustomer, user]);

  if (loading) return <div className="pt-40 text-center text-zinc-500">Loading...</div>;
  if (!isCustomer) return <Navigate to="/login" state={{ from: "/dashboard" }} replace />;

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success("Profile updated");
      setEditing(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const reloadLicenses = async () => {
    const r = await api.get("/customer/licenses");
    setLicenses(r.data);
  };

  const deactivateDevice = async (licenseId, hardwareId) => {
    if (!window.confirm("Deactivate this computer? The plugin on that device will need activation again.")) return;
    try {
      await api.delete(`/customer/licenses/${licenseId}/devices/${encodeURIComponent(hardwareId)}`);
      await reloadLicenses();
      toast.success("Device deactivated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to deactivate device");
    }
  };

  const handleDownload = async (txnId) => {
    try {
      const r = await api.get(`/download/${txnId}`);
      // Try opening the URL directly (works for Cloudinary / public URLs)
      const url = r.data.download_url;
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        window.open(url, "_blank", "noopener,noreferrer");
        toast.success("Download started");
      } else {
        toast.info(`File: ${r.data.filename}. Admin has not uploaded the file yet.`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Download failed");
    }
  };

  const downloadInvoice = async (txnId) => {
    try {
      const token = localStorage.getItem("ts_token");
      const res = await fetch(`${BACKEND_URL}/api/customer/invoice/${txnId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${txnId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Invoice downloaded");
    } catch {
      toast.error("Failed to fetch invoice");
    }
  };

  const paidOrders = orders.filter((o) => o.payment_status === "paid");
  const pendingOrders = orders.filter((o) => o.payment_status !== "paid");

  const deletePending = async (txnId) => {
    if (!window.confirm("Delete this pending order? This cannot be undone.")) return;
    try {
      await api.delete(`/customer/orders/${txnId}`);
      setOrders((prev) => prev.filter((o) => o.id !== txnId));
      toast.success("Order removed");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div data-testid="customer-dashboard" className="max-w-7xl mx-auto px-6 md:px-12 pt-28 pb-32">
      <div className="flex items-end justify-between mb-12 fade-up">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">My Account</div>
          <h1 className="font-[Outfit] text-4xl md:text-6xl font-black tracking-tighter">
            Hi, {user.profile.name?.split(" ")[0] || "there"}.
          </h1>
        </div>
        <button
          data-testid="dashboard-logout"
          onClick={() => { logout(); nav("/"); }}
          className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/15 text-sm hover:bg-white/5"
        >
          <LogOut className="w-3.5 h-3.5" /> Logout
        </button>
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-8">
        {/* Profile Card */}
        <aside className="bg-[#0a0a0c] border border-white/10 rounded-2xl p-6 h-fit">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-full bg-[#e11d48] flex items-center justify-center text-lg font-bold">
              {(user.profile.name || "U").slice(0, 1).toUpperCase()}
            </div>
            {!editing && (
              <button
                data-testid="edit-profile-btn"
                onClick={() => setEditing(true)}
                className="text-zinc-400 hover:text-white p-2 rounded hover:bg-white/5"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>

          {!editing ? (
            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Name</div>
                <div data-testid="profile-name" className="font-semibold">{user.profile.name}</div>
              </div>
              {user.profile.email && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Email</div>
                  <div data-testid="profile-email" className="text-sm text-zinc-300 flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-zinc-500" />
                    {user.profile.email}
                  </div>
                </div>
              )}
              {user.profile.phone && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Phone</div>
                  <div data-testid="profile-phone" className="text-sm text-zinc-300 flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-zinc-500" />
                    {user.profile.phone}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Member since</div>
                <div className="text-sm text-zinc-300 font-mono">{(user.profile.created_at || "").slice(0, 10)}</div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Name</label>
                <input
                  data-testid="edit-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Email</label>
                <input
                  data-testid="edit-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1.5">Phone</label>
                <input
                  data-testid="edit-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  data-testid="save-profile-btn"
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5" /> Save</>}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2.5 rounded-full border border-white/15 text-sm font-semibold hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </aside>

        {/* Orders */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-[Outfit] text-2xl font-bold">My Purchases</h2>
            <Link to="/shop" className="text-sm text-[#e11d48] hover:underline">Browse shop →</Link>
          </div>

          {orders.length === 0 && (
            <div className="bg-[#0a0a0c] border border-dashed border-white/10 rounded-2xl p-12 text-center">
              <ShoppingBag className="w-10 h-10 mx-auto text-zinc-600 mb-4" />
              <p className="text-zinc-400 mb-4">No purchases yet.</p>
              <Link to="/shop" className="inline-flex px-6 py-2.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold">
                Explore the Shop
              </Link>
            </div>
          )}

          {paidOrders.length > 0 && (
            <div className="space-y-3 mb-8">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Paid · {paidOrders.length}</div>
              {paidOrders.map((o) => (
                <div
                  key={o.id}
                  data-testid={`order-${o.id}`}
                  className="bg-[#0a0a0c] border border-white/10 rounded-xl p-4 flex items-center gap-4"
                >
                  {o.product_image && (
                    <img src={o.product_image} alt={o.product_name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{o.product_name}</div>
                    <div className="text-xs text-zinc-500 font-mono mt-1">
                      {(o.created_at || "").slice(0, 10)} · {fmtPrice(o.amount)}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      data-testid={`download-${o.id}`}
                      onClick={() => handleDownload(o.id)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </button>
                    <button
                      data-testid={`invoice-${o.id}`}
                      onClick={() => downloadInvoice(o.id)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 hover:bg-white/5 text-sm font-semibold"
                      title="Download invoice PDF"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Invoice</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pendingOrders.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Pending</div>
              {pendingOrders.map((o) => (
                <div
                  key={o.id}
                  data-testid={`pending-order-${o.id}`}
                  className="bg-[#0a0a0c] border border-white/5 rounded-xl p-4 flex items-center gap-4"
                >
                  {o.product_image && (
                    <img src={o.product_image} alt={o.product_name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 opacity-70" />
                  )}
                  <div className="flex-1 min-w-0 opacity-70">
                    <div className="font-semibold truncate">{o.product_name}</div>
                    <div className="text-xs text-zinc-500 font-mono mt-1">{fmtPrice(o.amount)}</div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase bg-amber-500/15 text-amber-400 flex-shrink-0">
                    {o.payment_status}
                  </span>
                  <button
                    data-testid={`delete-pending-${o.id}`}
                    onClick={() => deletePending(o.id)}
                    title="Remove this pending order"
                    className="p-2.5 rounded-full border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* My Licenses */}
          {licenses.length > 0 && (
            <div className="mt-10">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="font-[Outfit] text-2xl font-bold flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-[#e11d48]" />
                    My VST Licenses
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Enter these keys in your plugin to activate.</p>
                </div>
              </div>
              <div className="space-y-3">
                {licenses.map((l) => (
                  <div key={l.id} data-testid={`license-${l.id}`} className="bg-[#0a0a0c] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">{l.product_name}</div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                        l.status === "active" ? "bg-emerald-500/15 text-emerald-400" :
                        l.status === "revoked" ? "bg-red-500/15 text-red-400" :
                        "bg-amber-500/15 text-amber-400"
                      }`}>
                        {l.status === "active" ? "Activated" : l.status === "revoked" ? "Revoked" : "Not activated"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 bg-[#050505] border border-white/5 rounded-lg px-3 py-2">
                      <KeyRound className="w-3.5 h-3.5 text-[#e11d48] flex-shrink-0" />
                      <code className="flex-1 text-xs font-mono truncate">{l.license_key}</code>
                      <button
                        data-testid={`copy-${l.id}`}
                        onClick={() => {
                          navigator.clipboard.writeText(l.license_key);
                          toast.success("License key copied");
                        }}
                        className="p-1.5 rounded hover:bg-white/5 text-zinc-400 hover:text-white flex-shrink-0"
                        title="Copy to clipboard"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="rounded-full border border-white/10 px-2 py-1">
                        {l.license_type === "trial" ? `Trial · expires ${(l.expires_at || "").slice(0, 10)}` : "Lifetime license"}
                      </span>
                      <span className="rounded-full border border-white/10 px-2 py-1">
                        {l.activation_count || (l.activations || []).length}/{l.max_activations || 1} computers
                      </span>
                    </div>
                    {(l.activations || []).length > 0 && (
                      <div className="mt-3 space-y-2">
                        {(l.activations || []).map((device) => (
                          <div key={device.hardware_id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-[#050505] px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">{device.machine_name || "Activated computer"}</div>
                              <div className="text-[10px] text-zinc-600 font-mono truncate">{device.hardware_id}</div>
                            </div>
                            <button
                              onClick={() => deactivateDevice(l.id, device.hardware_id)}
                              className="p-2 rounded-full text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                              title="Deactivate computer"
                            >
                              <MonitorOff className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
