import React, { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, fmtPrice } from "../lib/api";
import { Music2, Sliders, ShoppingBag, LogOut, Plus, Pencil, Trash2, Receipt, X, Users, Tag, Upload, Loader2, BookOpen, KeyRound, RotateCcw, Ban, Eye, EyeOff, Copy } from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { id: "songs", label: "Songs", icon: Music2, endpoint: "/songs", admin: "/admin/songs" },
  { id: "gear", label: "Gear", icon: Sliders, endpoint: "/gear", admin: "/admin/gear" },
  { id: "products", label: "Products", icon: ShoppingBag, endpoint: "/admin/products", admin: "/admin/products" },
  { id: "blog", label: "Blog", icon: BookOpen, endpoint: "/admin/blog", admin: "/admin/blog" },
  { id: "coupons", label: "Coupons", icon: Tag, endpoint: "/admin/coupons", admin: "/admin/coupons" },
  { id: "licenses", label: "Licenses", icon: KeyRound, endpoint: "/admin/licenses" },
  { id: "customers", label: "Customers", icon: Users, endpoint: "/admin/customers" },
  { id: "transactions", label: "Transactions", icon: Receipt, endpoint: "/admin/transactions" },
];

const SCHEMAS = {
  songs: [
    { key: "title", label: "Title", required: true },
    { key: "artist", label: "Artist", required: true },
    { key: "genre", label: "Genre", required: true },
    { key: "duration", label: "Duration", placeholder: "3:42", required: true },
    { key: "cover_url", label: "Cover URL", required: true },
    { key: "track_type", label: "Track Type", type: "select", options: ["audio", "youtube", "spotify"], required: true },
    { key: "audio_url", label: "Audio URL (only for 'audio' type)" },
    { key: "embed_url", label: "Embed URL (YouTube/Spotify link)" },
    { key: "release_year", label: "Release Year", type: "number" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  gear: [
    { key: "name", label: "Name", required: true },
    { key: "brand", label: "Brand", required: true },
    { key: "category", label: "Category", required: true },
    { key: "image_url", label: "Image URL", required: true },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "specs", label: "Specs (one per line)", type: "lines" },
  ],
  products: [
    { key: "name", label: "Name", required: true },
    { key: "category", label: "Category", required: true },
    { key: "image_url", label: "Image URL", required: true },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "is_free", label: "Free Product (no payment required)", type: "checkbox" },
    { key: "requires_license", label: "Protect this plugin with a license", type: "checkbox", help: "Customers receive one serial automatically after purchase." },
    { key: "max_activations", label: "Computers allowed per license", type: "select", options: ["1", "2", "3"], showWhen: (data) => !!data.requires_license, help: "Customers can deactivate an old computer themselves." },
    { key: "trial_enabled", label: "Offer a free trial", type: "checkbox", showWhen: (data) => !!data.requires_license },
    { key: "trial_days", label: "Trial length (days)", type: "number", showWhen: (data) => !!data.requires_license && !!data.trial_enabled, help: "Seven days is recommended." },
    { key: "price", label: "Price (USD) — ignored if Free is checked", type: "number", step: "0.01", required: true },
    { key: "preview_audio_url", label: "Preview Audio URL (optional)" },
    { key: "download_url", label: "Download URL (Cloudinary or any public link)", required: true, type: "file_or_url" },
    { key: "status", label: "Publication Status", type: "select", options: ["draft", "published"], required: true, help: "Draft products are hidden from the public shop until you publish them." },
  ],
  blog: [
    { key: "title", label: "Title", required: true },
    { key: "slug", label: "Slug (auto from title if blank)" },
    { key: "excerpt", label: "Excerpt (1-2 lines)", type: "textarea" },
    { key: "featured_image", label: "Featured Image URL", type: "file_or_url" },
    { key: "tags", label: "Tags (one per line)", type: "lines" },
    { key: "author", label: "Author" },
    { key: "status", label: "Status", type: "select", options: ["draft", "published"], required: true },
    { key: "content", label: "Content (Markdown)", type: "textarea_lg", required: true },
  ],
  coupons: [
    { key: "code", label: "Code (e.g. SUMMER20)", required: true },
    { key: "discount_type", label: "Type", type: "select", options: ["percent", "amount"], required: true },
    { key: "discount_value", label: "Value (% or $)", type: "number", step: "0.01", required: true },
    { key: "expires_at", label: "Expires at (YYYY-MM-DD, optional)", placeholder: "2026-12-31" },
    { key: "max_uses", label: "Max uses (0 = unlimited)", type: "number" },
    { key: "active", label: "Active", type: "checkbox" },
  ],
};

export default function AdminDashboard() {
  const { user, loading, isAdmin, logout } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("songs");
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null); // {mode, item}
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [licenseGroups, setLicenseGroups] = useState({});

  // ===============================
// GROUP LICENSES BY PRODUCT
// ===============================
const groupedLicenses =
  tab === "licenses"
    ? items.reduce((acc, lic) => {
        const key = lic.product_name || "Unknown Product";

        if (!acc[key]) acc[key] = [];

        acc[key].push(lic);

        return acc;
      }, {})
    : {};

  const tabConfig = TABS.find((t) => t.id === tab);

  const load = async () => {
    try {
      const r = await api.get(tabConfig.endpoint);
      setItems(r.data);
    } catch {
      toast.error("Failed to load");
    }
  };

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin]);

  if (loading) return <div className="pt-40 text-center text-zinc-500">Loading...</div>;
  if (!isAdmin) return <Navigate to="/admin/login" replace />;

  const openCreate = () => {
    setForm(tab === "products" ? { requires_license: true, max_activations: "1", trial_enabled: true, trial_days: 7, status: "draft" } : {});
    setModal({ mode: "create" });
  };
  const openEdit = (item) => {
    const data = { ...item };
    if (data.specs && Array.isArray(data.specs)) data.specs = data.specs.join("\n");
    setForm(data);
    setModal({ mode: "edit", item });
  };

  const closeModal = () => {
    setModal(null);
    setForm({});
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const schema = SCHEMAS[tab];
      const payload = {};
      schema.forEach((f) => {
        let v = form[f.key];
        if (f.type === "lines") v = (v || "").split("\n").map((s) => s.trim()).filter(Boolean);
        else if (f.type === "number") v = v === "" || v == null ? null : Number(v);
        else if (f.type === "checkbox") v = !!v;
        else if (f.type === "textarea_lg") v = v ?? "";
        else v = v ?? "";
        payload[f.key] = v;
      });
      if (modal.mode === "create") {
        await api.post(tabConfig.admin, payload);
        toast.success("Created");
      } else {
        await api.put(`${tabConfig.admin}/${modal.item.id}`, payload);
        toast.success("Updated");
      }
      closeModal();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const uploadProductFile = async (file, fieldKey) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "tripleside/products");
    try {
      const r = await api.post("/admin/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm((f) => ({ ...f, [fieldKey]: r.data.url }));
      toast.success("File uploaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed (Cloudinary not configured?)");
    }
  };

  const remove = async (item) => {
    if (!window.confirm("Delete this item?")) return;
    try {
      await api.delete(`${tabConfig.admin}/${item.id}`);
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Delete failed");
    }
  };


  const setProductPublication = async (product, publish) => {
    const action = publish ? "publish" : "unpublish";
    const message = publish
      ? `Publish ${product.name}? It will become visible in the public shop.`
      : `Move ${product.name} back to Draft? It will disappear from the public shop.`;
    if (!window.confirm(message)) return;
    try {
      await api.post(`/admin/products/${product.id}/${action}`);
      toast.success(publish ? "Product published" : "Product moved to draft");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Status update failed");
    }
  };

  const copyProductId = async (product) => {
    try {
      await navigator.clipboard.writeText(product.id);
      toast.success("Product ID copied");
    } catch {
      toast.error("Could not copy Product ID");
    }
  };

  const resetLicense = async (lic) => {
    if (!window.confirm(`Reset hardware binding for ${lic.license_key}? Customer can then activate on a new computer.`)) return;
    try {
      await api.post(`/admin/licenses/${lic.id}/reset`);
      toast.success("License reset");
      load();
    } catch {
      toast.error("Reset failed");
    }
  };

  const revokeLicense = async (lic) => {
    if (!window.confirm(`Revoke ${lic.license_key}? Customer will no longer be able to use this license.`)) return;
    try {
      await api.post(`/admin/licenses/${lic.id}/revoke`);
      toast.success("License revoked");
      load();
    } catch {
      toast.error("Revoke failed");
    }
  };

  const deleteLicense = async (lic) => {
    if (!window.confirm(`Permanently delete license ${lic.license_key}?`)) return;
    try {
      await api.delete(`/admin/licenses/${lic.id}`);
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  const toggleLicenseGroup = (product) => {
  setLicenseGroups((prev) => ({
    ...prev,
    [product]: !(prev[product] ?? true),
  }));
  };

  const handleLogout = () => {
    logout();
    nav("/");
  };

  return (
    <div data-testid="admin-dashboard" className="min-h-screen pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-6 md:px-12 mt-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-2">Studio Admin</div>
            <h1 className="font-[Outfit] text-4xl font-black tracking-tighter">Dashboard</h1>
          </div>
          <button
            data-testid="logout-btn"
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/15 text-sm hover:bg-white/5"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>

        <div className="grid md:grid-cols-[220px_1fr] gap-6">
          <aside className="bg-[#0a0a0c] border border-white/10 rounded-2xl p-3 h-fit">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  data-testid={`tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors mb-1 ${
                    tab === t.id ? "bg-[#e11d48] text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </aside>

          <section className="bg-[#0a0a0c] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-[Outfit] text-2xl font-bold">{tabConfig.label}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{items.length} total</p>
              </div>
              {tab !== "transactions" && tab !== "customers" && tab !== "licenses" && (
                <button
                  data-testid="add-item-btn"
                  onClick={openCreate}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add new
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              {tab === "transactions" ? (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="text-left py-3 px-3">Product</th>
                      <th className="text-left py-3 px-3">Amount</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-left py-3 px-3">Session</th>
                      <th className="text-left py-3 px-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => (
                      <tr key={t.id} className="border-b border-white/5">
                        <td className="py-3 px-3 font-medium">{t.product_name}</td>
                        <td className="py-3 px-3 font-mono">{fmtPrice(t.amount)}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            t.payment_status === "paid" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                          }`}>
                            {t.payment_status}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-zinc-400 truncate max-w-[140px]">{t.session_id}</td>
                        <td className="py-3 px-3 font-mono text-xs text-zinc-400">{(t.created_at || "").slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : tab === "blog" ? (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="text-left py-3 px-3">Title</th>
                      <th className="text-left py-3 px-3">Slug</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-left py-3 px-3">Updated</th>
                      <th className="text-right py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-3 px-3 font-medium">{p.title}</td>
                        <td className="py-3 px-3 text-xs text-zinc-400 font-mono truncate max-w-[180px]">{p.slug}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            p.status === "published" ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-zinc-400 font-mono">{(p.updated_at || p.created_at || "").slice(0, 10)}</td>
                        <td className="py-3 px-3 text-right">
                          <button data-testid={`edit-${p.id}`} onClick={() => openEdit(p)} className="p-2 rounded hover:bg-white/5 mr-1"><Pencil className="w-3.5 h-3.5" /></button>
                          <button data-testid={`delete-${p.id}`} onClick={() => remove(p)} className="p-2 rounded hover:bg-white/5 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : tab === "coupons" ? (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="text-left py-3 px-3">Code</th>
                      <th className="text-left py-3 px-3">Discount</th>
                      <th className="text-left py-3 px-3">Used</th>
                      <th className="text-left py-3 px-3">Expires</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-right py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id} className="border-b border-white/5">
                        <td className="py-3 px-3 font-mono font-bold">{c.code}</td>
                        <td className="py-3 px-3 text-xs">
                          {c.discount_type === "percent" ? `${c.discount_value}%` : fmtPrice(c.discount_value)}
                        </td>
                        <td className="py-3 px-3 text-xs text-zinc-400 font-mono">
                          {c.times_used || 0}{c.max_uses ? `/${c.max_uses}` : ""}
                        </td>
                        <td className="py-3 px-3 text-xs text-zinc-400 font-mono">{c.expires_at?.slice(0, 10) || "—"}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            c.active ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"
                          }`}>
                            {c.active ? "active" : "inactive"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button data-testid={`edit-${c.id}`} onClick={() => openEdit(c)} className="p-2 rounded hover:bg-white/5 mr-1"><Pencil className="w-3.5 h-3.5" /></button>
                          <button data-testid={`delete-${c.id}`} onClick={() => remove(c)} className="p-2 rounded hover:bg-white/5 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : tab === "licenses" ? (

<div className="space-y-6">

{Object.entries(groupedLicenses).map(([product, licenses]) => {

const fullLicenses = licenses.filter(
  (l) => (l.license_type || "full") === "full"
);

const trialLicenses = licenses.filter(
  (l) => l.license_type === "trial"
);

return (

<div
key={product}
className="border border-white/10 rounded-xl overflow-hidden"
>

<button
onClick={() => toggleLicenseGroup(product)}
className="w-full flex items-center justify-between px-5 py-4 bg-white/5 hover:bg-white/10 transition"
>

<div>

<h3 className="font-bold text-lg">

🎹 {product}

</h3>

<p className="text-xs text-zinc-500">

{licenses.length} License

</p>

</div>

<div className="text-2xl">

{licenseGroups[product] === false ? "+" : "−"}

</div>

</button>

{licenseGroups[product] !== false && (

<table className="w-full text-sm">

<thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">

<tr>

<th className="text-left py-3 px-3">License Key</th>

<th className="text-left py-3 px-3">Customer</th>

<th className="text-left py-3 px-3">HW ID</th>

<th className="text-left py-3 px-3">Status</th>

<th className="text-right py-3 px-3">Actions</th>

</tr>

</thead>

<tbody>

{/* FULL LICENSE */}
{fullLicenses.length > 0 && (
  <>
    <tr className="bg-emerald-900/20">
      <td
        colSpan={5}
        className="px-4 py-2 font-semibold text-emerald-400"
      >
        🟢 Full License ({fullLicenses.length})
      </td>
    </tr>

    {fullLicenses.map((l) => (

      <tr
        key={l.id}
        className="border-b border-white/5"
      >

        <td className="py-3 px-3 font-mono text-xs">
          {l.license_key}
        </td>

        <td className="py-3 px-3 text-xs">
          <div>{l.customer_name}</div>
          <div className="text-zinc-500">
            {l.customer_email}
          </div>
        </td>

        <td className="py-3 px-3 font-mono text-[10px] text-zinc-400 truncate max-w-[120px]">
          {l.hardware_id || "—"}
        </td>

        <td className="py-3 px-3">

          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
              l.status === "active"
                ? "bg-emerald-500/15 text-emerald-400"
                : l.status === "revoked"
                ? "bg-red-500/15 text-red-400"
                : "bg-zinc-500/15 text-zinc-400"
            }`}
          >

            {l.status}

          </span>

        </td>

        <td className="py-3 px-3 text-right whitespace-nowrap">

          <button
            onClick={() => resetLicense(l)}
            title="Reset"
            className="p-2 rounded hover:bg-white/5 mr-1"
          >
            <RotateCcw className="w-3.5 h-3.5"/>
          </button>

          <button
            onClick={() => revokeLicense(l)}
            title="Revoke"
            className="p-2 rounded hover:bg-white/5 mr-1 text-amber-400"
          >
            <Ban className="w-3.5 h-3.5"/>
          </button>

          <button
            onClick={() => deleteLicense(l)}
            title="Delete"
            className="p-2 rounded hover:bg-white/5 text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5"/>
          </button>

        </td>

      </tr>

    ))}

  </>
)}

{/* TRIAL LICENSE */}

{trialLicenses.length > 0 && (
  <>
    <tr className="bg-yellow-900/20">
      <td
        colSpan={5}
        className="px-4 py-2 font-semibold text-yellow-400"
      >
        🟡 Trial License ({trialLicenses.length})
      </td>
    </tr>

    {trialLicenses.map((l) => (

      <tr
        key={l.id}
        className="border-b border-white/5"
      >

        <td className="py-3 px-3 font-mono text-xs">
          {l.license_key}
        </td>

        <td className="py-3 px-3 text-xs">
          <div>{l.customer_name}</div>
          <div className="text-zinc-500">
            {l.customer_email}
          </div>
        </td>

        <td className="py-3 px-3 font-mono text-[10px] text-zinc-400 truncate max-w-[120px]">
          {l.hardware_id || "—"}
        </td>

        <td className="py-3 px-3">

          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
              l.status === "active"
                ? "bg-emerald-500/15 text-emerald-400"
                : l.status === "revoked"
                ? "bg-red-500/15 text-red-400"
                : "bg-zinc-500/15 text-zinc-400"
            }`}
          >

            {l.status}

          </span>

        </td>

        <td className="py-3 px-3 text-right whitespace-nowrap">

          <button
            onClick={() => resetLicense(l)}
            title="Reset"
            className="p-2 rounded hover:bg-white/5 mr-1"
          >
            <RotateCcw className="w-3.5 h-3.5"/>
          </button>

          <button
            onClick={() => revokeLicense(l)}
            title="Revoke"
            className="p-2 rounded hover:bg-white/5 mr-1 text-amber-400"
          >
            <Ban className="w-3.5 h-3.5"/>
          </button>

          <button
            onClick={() => deleteLicense(l)}
            title="Delete"
            className="p-2 rounded hover:bg-white/5 text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5"/>
          </button>

        </td>

      </tr>

    ))}

  </>
)}

</tbody>

</table>

)}

</div>

);

})}

</div>

              ) : tab === "customers" ? (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="text-left py-3 px-3">Name</th>
                      <th className="text-left py-3 px-3">Email</th>
                      <th className="text-left py-3 px-3">Phone</th>
                      <th className="text-left py-3 px-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id} data-testid={`customer-row-${c.id}`} className="border-b border-white/5">
                        <td className="py-3 px-3 font-medium">{c.name}</td>
                        <td className="py-3 px-3 text-xs text-zinc-400">{c.email || "—"}</td>
                        <td className="py-3 px-3 text-xs text-zinc-400 font-mono">{c.phone || "—"}</td>
                        <td className="py-3 px-3 font-mono text-xs text-zinc-400">{(c.created_at || "").slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="text-left py-3 px-3">Item</th>
                      <th className="text-left py-3 px-3">Details</th>
                      <th className="text-right py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-b border-white/5">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-3">
                            <img src={it.cover_url || it.image_url} alt="" className="w-10 h-10 rounded object-cover" />
                            <div className="font-semibold">{it.title || it.name}</div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-zinc-400">
                          {tab === "songs" && `${it.artist} · ${it.genre}`}
                          {tab === "gear" && `${it.brand} · ${it.category}`}
                          {tab === "products" && (
                            <div className="space-y-1">
                              <div>{`${it.category} · ${fmtPrice(it.price)} · ${it.requires_license ? `${it.max_activations || 1} PC · Trial ${it.trial_enabled !== false ? `${it.trial_days || 7}d` : "Off"}` : "No license"}`}</div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                  (it.status || "published") === "published"
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-amber-500/15 text-amber-400"
                                }`}>
                                  {it.status || "published"}
                                </span>
                                <button type="button" onClick={() => copyProductId(it)} className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 hover:text-white" title="Copy Product ID">
                                  <Copy className="w-3 h-3" /> {it.id}
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {tab === "products" && (it.status || "published") === "published" && (
                            <button data-testid={`unpublish-${it.id}`} onClick={() => setProductPublication(it, false)} title="Move to Draft" className="p-2 rounded hover:bg-white/5 mr-1 text-amber-400"><EyeOff className="w-3.5 h-3.5" /></button>
                          )}
                          {tab === "products" && (it.status || "published") !== "published" && (
                            <button data-testid={`publish-${it.id}`} onClick={() => setProductPublication(it, true)} title="Publish product" className="p-2 rounded hover:bg-white/5 mr-1 text-emerald-400"><Eye className="w-3.5 h-3.5" /></button>
                          )}
                          <button data-testid={`edit-${it.id}`} onClick={() => openEdit(it)} className="p-2 rounded hover:bg-white/5 mr-1"><Pencil className="w-3.5 h-3.5" /></button>
                          <button data-testid={`delete-${it.id}`} onClick={() => remove(it)} className="p-2 rounded hover:bg-white/5 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {items.length === 0 && <div className="text-center py-12 text-zinc-500">No items.</div>}
            </div>
          </section>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4" onClick={closeModal}>
          <form
            onSubmit={submitForm}
            onClick={(e) => e.stopPropagation()}
            data-testid="item-form-modal"
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[#0a0a0c] border border-white/10 rounded-2xl p-8"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-[Outfit] text-2xl font-bold">{modal.mode === "create" ? "Add" : "Edit"} {tabConfig.label.slice(0, -1)}</h3>
              <button type="button" onClick={closeModal} className="p-2 rounded hover:bg-white/5"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4">
              {SCHEMAS[tab].filter((f) => !f.showWhen || f.showWhen(form)).map((f) => (
                <div key={f.key}>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1.5">{f.label}{f.required && <span className="text-[#e11d48]">*</span>}</label>
                  {f.help && <p className="mb-2 text-xs leading-relaxed text-zinc-500">{f.help}</p>}
                  {f.type === "textarea" || f.type === "lines" ? (
                    <textarea
                      data-testid={`field-${f.key}`}
                      value={form[f.key] || ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      rows={3}
                      className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                      placeholder={f.placeholder}
                      required={f.required}
                    />
                  ) : f.type === "textarea_lg" ? (
                    <textarea
                      data-testid={`field-${f.key}`}
                      value={form[f.key] || ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      rows={16}
                      className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#e11d48]"
                      placeholder={f.placeholder || "# Heading\n\nWrite in **Markdown**..."}
                      required={f.required}
                    />
                  ) : f.type === "select" ? (
                    <select
                      data-testid={`field-${f.key}`}
                      value={form[f.key] || ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      required={f.required}
                      className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                    >
                      <option value="">Choose...</option>
                      {(f.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : f.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                      <input
                        data-testid={`field-${f.key}`}
                        type="checkbox"
                        checked={!!form[f.key]}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })}
                        className="w-4 h-4 accent-[#e11d48]"
                      />
                      Enable
                    </label>
                  ) : f.type === "file_or_url" ? (
                    <div className="space-y-2">
                      <input
                        data-testid={`field-${f.key}`}
                        type="text"
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        placeholder="https://... or upload below"
                        className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                        required={f.required}
                      />
                      <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-white/15 text-xs text-zinc-400 cursor-pointer hover:bg-white/5">
                        <Upload className="w-4 h-4 text-[#e11d48]" />
                        <span>Upload product file</span>
                        <input
                          data-testid={`upload-${f.key}`}
                          type="file"
                          className="hidden"
                          onChange={(e) => uploadProductFile(e.target.files?.[0], f.key)}
                        />
                      </label>
                      {form[f.key] && form[f.key].startsWith("http") && (
                        <a href={form[f.key]} target="_blank" rel="noreferrer" className="block text-[10px] text-emerald-400 font-mono truncate">
                          ✓ {form[f.key]}
                        </a>
                      )}
                    </div>
                  ) : (
                    <input
                      data-testid={`field-${f.key}`}
                      type={f.type || "text"}
                      step={f.step}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                      placeholder={f.placeholder}
                      required={f.required}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-8 flex gap-3 justify-end">
              <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-full border border-white/15 text-sm font-semibold hover:bg-white/5">Cancel</button>
              <button data-testid="form-submit-btn" type="submit" disabled={saving} className="px-5 py-2.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold disabled:opacity-60">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
