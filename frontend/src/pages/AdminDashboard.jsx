import React, { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, fmtPrice } from "../lib/api";
import { Music2, Sliders, ShoppingBag, LogOut, Plus, Pencil, Trash2, Receipt, X, Users, Tag, Upload, Loader2, BookOpen, KeyRound, RotateCcw, Ban, Eye, EyeOff, Copy, Mail, Building2, Save, CheckCircle2, XCircle, ExternalLink, ShieldCheck } from "lucide-react";
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
  { id: "security", label: "Security", icon: ShieldCheck },
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
    {
      key: "download_mode",
      label: "Jenis Download",
      type: "select",
      options: ["platform", "single"],
      optionLabels: {
        platform: "Installer — pilihan Windows / macOS",
        single: "Product / Sample Pack — satu file download",
      },
      required: true,
    },
    {
      key: "download_url",
      label: "File / Link Download Product",
      required: true,
      type: "file_or_url",
      uploadLabel: "Upload product / sample pack",
      platform: "product",
      storageKey: "product_storage_key",
      filenameKey: "product_download_filename",
      showWhen: (data) => data.download_mode === "single",
    },
    {
      key: "windows_enabled",
      label: "Tersedia untuk Windows",
      type: "checkbox",
      showWhen: (data) => data.download_mode !== "single",
    },
    {
      key: "windows_download_url",
      label: "File / Link Download Windows",
      required: true,
      type: "file_or_url",
      uploadLabel: "Upload installer Windows",
      platform: "windows",
      storageKey: "windows_storage_key",
      filenameKey: "windows_download_filename",
      showWhen: (data) => data.download_mode !== "single" && !!data.windows_enabled,
    },
    {
      key: "macos_enabled",
      label: "Tersedia untuk macOS",
      type: "checkbox",
      showWhen: (data) => data.download_mode !== "single",
    },
    {
      key: "macos_download_url",
      label: "File / Link Download macOS",
      required: true,
      type: "file_or_url",
      uploadLabel: "Upload installer macOS",
      platform: "macos",
      storageKey: "macos_storage_key",
      filenameKey: "macos_download_filename",
      showWhen: (data) => data.download_mode !== "single" && !!data.macos_enabled,
    },
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
    {
      key: "coupon_type",
      label: "Coupon Type",
      type: "select",
      options: ["discount", "trial"],
      optionLabels: {
        discount: "Discount",
        trial: "Trial License",
      },
      required: true,
    },
    {
      key: "discount_type",
      label: "Discount Type",
      type: "select",
      options: ["percent", "amount"],
      required: true,
      showWhen: (data) => data.coupon_type !== "trial",
    },
    {
      key: "discount_value",
      label: "Discount Value (% or amount)",
      type: "number",
      step: "0.01",
      required: true,
      showWhen: (data) => data.coupon_type !== "trial",
    },
    {
      key: "discount_scope",
      label: "Discount Applies To",
      type: "select",
      options: ["all", "product"],
      optionLabels: {
        all: "All Products",
        product: "Specific Product",
      },
      required: true,
      showWhen: (data) => data.coupon_type !== "trial",
    },
    {
      key: "discount_product_id",
      label: "Product for Discount",
      type: "product_select",
      excludeFree: true,
      required: true,
      showWhen: (data) =>
        data.coupon_type !== "trial" && data.discount_scope === "product",
    },
    {
      key: "trial_product_id",
      label: "Product for Trial",
      type: "product_select",
      licensedOnly: true,
      required: true,
      showWhen: (data) => data.coupon_type === "trial",
      help: "Hanya product yang menggunakan sistem license yang dapat dipilih.",
    },
    {
      key: "trial_days",
      label: "Trial Duration (1–30 days)",
      type: "number",
      min: 1,
      max: 30,
      required: true,
      showWhen: (data) => data.coupon_type === "trial",
    },
    { key: "expires_at", label: "Berlaku sampai tanggal (opsional)", type: "date", help: "Coupon tetap aktif sampai akhir tanggal yang dipilih." },
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
  const [uploadingProductField, setUploadingProductField] = useState("");
  const [productUploadProgress, setProductUploadProgress] = useState(0);
  const [licenseGroups, setLicenseGroups] = useState(() => ({}));
  const [broadcastModal, setBroadcastModal] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastTarget, setBroadcastTarget] = useState("all");
  const [products, setProducts] = useState([]);
  const [paymentSettings, setPaymentSettings] = useState({
    doku_enabled: true,
    doku_configured: false,
    doku_mode: "sandbox",
    manual_enabled: false,
    midtrans_enabled: false,
    bank_name: "",
    account_number: "",
    account_holder: "",
    instructions: "",
    expiry_hours: 24,
  });
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [showArchivedTransactions, setShowArchivedTransactions] = useState(false);
  const [transactionActionId, setTransactionActionId] = useState("");

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
      if (tab === "security") {
        setItems([]);
      } else if (tab === "transactions") {
        const [transactions, settings] = await Promise.all([
          api.get(tabConfig.endpoint, {
            params: { archived: showArchivedTransactions },
          }),
          api.get("/admin/payment-settings"),
        ]);
        setItems(transactions.data);
        setPaymentSettings(settings.data);
      } else {
        const r = await api.get(tabConfig.endpoint);
        setItems(r.data);
      }
    } catch {
      toast.error("Failed to load");
    }
  };

  const loadBroadcastProducts = async () => {
  try {

    const r = await api.get("/admin/products");

    setProducts(r.data);

  } catch(err){

    console.log("Failed load products", err);

  }
  };

  useEffect(() => {
  if (isAdmin) {
    load();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [tab, isAdmin, showArchivedTransactions]);

useEffect(() => {
  if (broadcastModal || tab === "coupons") {
    loadBroadcastProducts();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [broadcastModal, tab]);

  if (loading) return <div className="pt-40 text-center text-zinc-500">Loading...</div>;
  if (!isAdmin) return <Navigate to="/admin/login" replace />;

  const openCreate = () => {
    setForm(
      tab === "products"
        ? {
            requires_license: true,
            max_activations: "1",
            trial_enabled: true,
            trial_days: 7,
            download_mode: "platform",
            download_url: "",
            product_storage_key: "",
            product_download_filename: "",
            windows_enabled: true,
            windows_download_url: "",
            windows_storage_key: "",
            windows_download_filename: "",
            macos_enabled: false,
            macos_download_url: "",
            macos_storage_key: "",
            macos_download_filename: "",
            status: "draft",
          }
        : tab === "coupons"
          ? {
              coupon_type: "discount",
              discount_type: "percent",
              discount_value: "",
              discount_scope: "all",
              discount_product_id: "",
              trial_product_id: "",
              trial_days: 7,
              expires_at: "",
              max_uses: 0,
              active: true,
            }
          : {},
    );
    setModal({ mode: "create" });
  };
  const openEdit = (item) => {
    const data = { ...item };
    if (data.specs && Array.isArray(data.specs)) data.specs = data.specs.join("\n");
    if (tab === "products") {
      data.download_mode = data.download_mode === "single" ? "single" : "platform";
      data.windows_enabled = data.windows_enabled !== false;
      data.windows_download_url = data.windows_download_url
        || (data.download_mode === "platform" ? data.download_url : "")
        || "";
      data.macos_enabled = !!data.macos_enabled;
      data.macos_download_url = data.macos_download_url || "";
    } else if (tab === "coupons") {
      data.coupon_type = data.coupon_type || "discount";
      data.discount_product_id = data.discount_product_id || "";
      data.discount_scope = data.discount_scope
        || (data.discount_product_id ? "product" : "all");
      data.trial_product_id = data.trial_product_id || "";
      data.trial_days = data.trial_days || 7;
    }
    setForm(data);
    setModal({ mode: "edit", item });
  };

  const closeModal = () => {
    setModal(null);
    setForm({});
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (tab === "products") {
      if (form.download_mode === "single") {
        if (!form.download_url?.trim() && !form.product_storage_key?.trim()) {
          toast.error("File atau link product wajib diisi");
          return;
        }
      } else {
        if (!form.windows_enabled && !form.macos_enabled) {
          toast.error("Aktifkan minimal satu platform: Windows atau macOS");
          return;
        }
        if (
          form.windows_enabled
          && !form.windows_download_url?.trim()
          && !form.windows_storage_key?.trim()
        ) {
          toast.error("File atau link Windows wajib diisi");
          return;
        }
        if (
          form.macos_enabled
          && !form.macos_download_url?.trim()
          && !form.macos_storage_key?.trim()
        ) {
          toast.error("File atau link macOS wajib diisi");
          return;
        }
      }
    }
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
      if (tab === "products") {
        [
          "product_storage_key",
          "product_download_filename",
          "windows_storage_key",
          "windows_download_filename",
          "macos_storage_key",
          "macos_download_filename",
        ].forEach((key) => {
          payload[key] = form[key] || "";
        });
      } else if (tab === "coupons") {
        payload.coupon_type = form.coupon_type || "discount";
        if (payload.coupon_type === "trial") {
          payload.discount_type = "percent";
          payload.discount_value = 0;
          payload.discount_scope = "all";
          payload.discount_product_id = "";
          payload.trial_days = Number(form.trial_days || 7);
          payload.trial_product_id = form.trial_product_id || "";
        } else {
          payload.discount_scope = form.discount_scope || "all";
          payload.discount_product_id = payload.discount_scope === "product"
            ? (form.discount_product_id || "")
            : "";
          payload.trial_days = 7;
          payload.trial_product_id = "";
        }
      }
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

  const uploadProductFile = async (file, field) => {
    if (!file) return;
    const isPrivateProductFile = !!field.storageKey;
    const maximumBytes = isPrivateProductFile
      ? 5 * 1024 * 1024 * 1024
      : 500 * 1024 * 1024;
    if (file.size > maximumBytes) {
      toast.error(isPrivateProductFile ? "Ukuran file maksimal 5 GB" : "Ukuran file maksimal 500 MB");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    if (isPrivateProductFile) {
      fd.append("platform", field.platform);
    } else {
      fd.append("folder", "tripleside/products");
    }
    setUploadingProductField(field.key);
    setProductUploadProgress(0);
    try {
      const r = await api.post(
        isPrivateProductFile ? "/admin/upload/product" : "/admin/upload",
        fd,
        {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 0,
          onUploadProgress: (event) => {
            if (event.total) {
              setProductUploadProgress(Math.round((event.loaded * 100) / event.total));
            }
          },
        },
      );
      if (isPrivateProductFile) {
        setForm((current) => ({
          ...current,
          [field.key]: "",
          [field.storageKey]: r.data.storage_key,
          [field.filenameKey]: r.data.filename,
        }));
        toast.success("File tersimpan privat di Cloudflare R2");
      } else {
        setForm((current) => ({ ...current, [field.key]: r.data.url }));
        toast.success("File uploaded");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload gagal");
    } finally {
      setUploadingProductField("");
      setProductUploadProgress(0);
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

  const savePaymentSettings = async (event) => {
    event.preventDefault();
    setSavingPaymentSettings(true);
    try {
      const response = await api.put("/admin/payment-settings", {
        ...paymentSettings,
        expiry_hours: Number(paymentSettings.expiry_hours || 24),
      });
      setPaymentSettings(response.data);
      toast.success("Pengaturan pembayaran disimpan");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Pengaturan pembayaran gagal disimpan");
    } finally {
      setSavingPaymentSettings(false);
    }
  };

  const changeAdminPassword = async (event) => {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("Konfirmasi password baru tidak sama");
      return;
    }
    if (passwordForm.newPassword.length < 12) {
      toast.error("Password baru minimal 12 karakter");
      return;
    }
    if (!window.confirm("Ubah password admin dan keluarkan semua sesi admin yang sedang aktif?")) {
      return;
    }

    setChangingPassword(true);
    try {
      const response = await api.post("/auth/change-password", {
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      toast.success(response.data.message || "Password admin berhasil diubah");
      logout();
      nav("/admin/login", { replace: true });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Password admin gagal diubah");
    } finally {
      setChangingPassword(false);
    }
  };

  const reviewManualPayment = async (transaction, action) => {
    const approving = action === "approve";
    const promptMessage = approving
      ? `Setujui pembayaran ${transaction.order_id}?`
      : `Alasan penolakan bukti ${transaction.order_id}:`;
    let note = "";
    if (approving) {
      if (!window.confirm(promptMessage)) return;
    } else {
      note = window.prompt(promptMessage, "Bukti pembayaran belum dapat diverifikasi.");
      if (note === null) return;
    }

    try {
      await api.post(`/admin/transactions/${transaction.id}/manual/${action}`, { note });
      toast.success(approving ? "Pembayaran disetujui" : "Bukti pembayaran ditolak");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Status pembayaran gagal diperbarui");
    }
  };

  const setTransactionArchived = async (transaction, archived) => {
    const reference = transaction.order_id || transaction.session_id || transaction.id;
    const actionLabel = archived ? "arsipkan" : "pulihkan";
    const message = archived
      ? `Arsipkan transaksi ${reference}? Transaksi hanya hilang dari daftar utama admin dan tetap tersedia untuk customer.`
      : `Pulihkan transaksi ${reference} ke daftar utama admin?`;
    if (!window.confirm(message)) return;

    setTransactionActionId(transaction.id);
    try {
      await api.post(
        `/admin/transactions/${transaction.id}/${archived ? "archive" : "restore"}`,
      );
      toast.success(
        archived ? "Transaksi berhasil diarsipkan" : "Transaksi berhasil dipulihkan",
      );
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || `Gagal ${actionLabel} transaksi`);
    } finally {
      setTransactionActionId("");
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

  const sendBroadcastEmail = async () => {

  if (!broadcastSubject.trim()) {
    toast.error("Subject is required");
    return;
  }

  if (!broadcastMessage.trim()) {
    toast.error("Message is required");
    return;
  }

  if (!window.confirm(
  `Send this email to ${broadcastTarget} recipients?`
  ))
  return;

  try {

    setSendingBroadcast(true);

  const res = await api.post("/admin/broadcast-email", {
  target: broadcastTarget,
  subject: broadcastSubject,
  message: broadcastMessage
    });

    toast.success(
      `Email sent to ${res.data.sent ?? 0} customers`
    );

    setBroadcastModal(false);
    setBroadcastSubject("");
    setBroadcastMessage("");
    setBroadcastTarget("all");

  } catch (err) {

    toast.error(
      err?.response?.data?.detail ||
      "Broadcast failed"
    );

  } finally {

    setSendingBroadcast(false);

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
      <h2 className="font-[Outfit] text-2xl font-bold">
        {tabConfig.label}
      </h2>
      {tab !== "security" && (
        <p className="text-xs text-zinc-500 mt-0.5">
          {items.length} total
        </p>
      )}
    </div>

    <div className="flex items-center gap-2">

      {tab === "customers" && (
        <button
          onClick={() => setBroadcastModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold transition-colors"
        >
          <Mail className="w-4 h-4" />
          Broadcast Email
        </button>
      )}

      {tab === "transactions" && (
        <div className="inline-flex rounded-full border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setShowArchivedTransactions(false)}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              !showArchivedTransactions
                ? "bg-[#e11d48] text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            Aktif
          </button>
          <button
            type="button"
            onClick={() => setShowArchivedTransactions(true)}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              showArchivedTransactions
                ? "bg-[#e11d48] text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Diarsipkan
          </button>
        </div>
      )}

      {tab !== "transactions" &&
        tab !== "customers" &&
        tab !== "licenses" &&
        tab !== "security" && (
          <button
            data-testid="add-item-btn"
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add new
          </button>
        )}

    </div>
  </div>


            {tab === "transactions" && (
              <form
                onSubmit={savePaymentSettings}
                className="mb-6 rounded-2xl border border-white/10 bg-black/20 p-5"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 mb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-[#e11d48]" />
                      <h3 className="font-[Outfit] text-lg font-bold">Payment Settings</h3>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                      DOKU menggantikan transfer manual. Kredensial API hanya disimpan di environment server.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={savingPaymentSettings}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] text-sm font-semibold disabled:opacity-50"
                  >
                    {savingPaymentSettings ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save settings
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className={`rounded-xl border px-4 py-3 ${
                    paymentSettings.doku_configured
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-amber-500/20 bg-amber-500/5"
                  }`}>
                    <div className="text-xs text-zinc-500">Status integrasi DOKU</div>
                    <div className={`mt-1 text-sm font-semibold ${
                      paymentSettings.doku_configured ? "text-emerald-400" : "text-amber-300"
                    }`}>
                      {paymentSettings.doku_configured
                        ? `Terhubung (${paymentSettings.doku_mode || "sandbox"})`
                        : "Menunggu kredensial API"}
                    </div>
                  </div>
                  <label className="text-xs text-zinc-400">
                    Kedaluwarsa checkout DOKU (jam)
                    <input
                      type="number"
                      min="1"
                      max="168"
                      value={paymentSettings.expiry_hours || 24}
                      onChange={(event) => setPaymentSettings((current) => ({ ...current, expiry_hours: event.target.value }))}
                      className="mt-2 w-full bg-[#050505] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#e11d48]"
                    />
                  </label>
                </div>

                <div className="grid md:grid-cols-2 gap-3 mt-4">
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold">Tampilkan DOKU</div>
                      <div className="text-xs text-zinc-500 mt-0.5">Aktif hanya jika kredensial server lengkap.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!paymentSettings.doku_enabled}
                      onChange={(event) => setPaymentSettings((current) => ({ ...current, doku_enabled: event.target.checked }))}
                      className="w-4 h-4 accent-[#e11d48]"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold">Tampilkan Midtrans</div>
                      <div className="text-xs text-zinc-500 mt-0.5">Biarkan mati sampai akun Midtrans disetujui.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!paymentSettings.midtrans_enabled}
                      onChange={(event) => setPaymentSettings((current) => ({ ...current, midtrans_enabled: event.target.checked }))}
                      className="w-4 h-4 accent-[#e11d48]"
                    />
                  </label>
                </div>

                {paymentSettings.doku_enabled && !paymentSettings.doku_configured && (
                    <div className="mt-4 text-xs text-amber-300 border border-amber-500/20 bg-amber-500/5 rounded-xl px-4 py-3">
                      Isi DOKU_CLIENT_ID dan DOKU_SECRET_KEY di environment backend agar tombol DOKU muncul di toko.
                    </div>
                )}
              </form>
            )}

            <div className="overflow-x-auto">
              {tab === "security" ? (
                <form
                  onSubmit={changeAdminPassword}
                  className="max-w-2xl rounded-2xl border border-white/10 bg-black/20 p-5 sm:p-6"
                >
                  <div className="flex items-start gap-3 mb-6">
                    <div className="rounded-xl bg-[#e11d48]/10 p-3 text-[#fb7185]">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-[Outfit] text-xl font-bold">Reset Password Admin</h3>
                      <p className="text-xs leading-5 text-zinc-500 mt-1">
                        Masukkan password saat ini untuk membuat password baru. Setelah berhasil,
                        semua sesi admin akan dikeluarkan dan Anda harus login kembali.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {[
                      {
                        key: "currentPassword",
                        label: "Password saat ini",
                        autoComplete: "current-password",
                      },
                      {
                        key: "newPassword",
                        label: "Password baru",
                        autoComplete: "new-password",
                      },
                      {
                        key: "confirmPassword",
                        label: "Ulangi password baru",
                        autoComplete: "new-password",
                      },
                    ].map((field) => (
                      <label key={field.key} className="block text-xs text-zinc-400">
                        {field.label}
                        <div className="relative mt-2">
                          <input
                            type={visiblePasswords[field.key] ? "text" : "password"}
                            autoComplete={field.autoComplete}
                            required
                            minLength={field.key === "currentPassword" ? 1 : 12}
                            maxLength={72}
                            value={passwordForm[field.key]}
                            onChange={(event) =>
                              setPasswordForm((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-white/10 bg-[#050505] px-4 py-3 pr-12 text-sm text-white focus:border-[#e11d48] focus:outline-none"
                          />
                          <button
                            type="button"
                            aria-label={visiblePasswords[field.key] ? `Sembunyikan ${field.label}` : `Tampilkan ${field.label}`}
                            onClick={() =>
                              setVisiblePasswords((current) => ({
                                ...current,
                                [field.key]: !current[field.key],
                              }))
                            }
                            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-500 hover:text-white"
                          >
                            {visiblePasswords[field.key] ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-amber-200">
                    Gunakan minimal 12 karakter yang memiliki huruf besar, huruf kecil, angka,
                    dan simbol. Password tidak pernah disimpan sebagai teks biasa.
                  </div>

                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#e11d48] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[#be123c] disabled:opacity-50"
                  >
                    {changingPassword ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    {changingPassword ? "Mengubah password..." : "Ubah password admin"}
                  </button>
                </form>
              ) : tab === "transactions" ? (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="text-left py-3 px-3">Product</th>
                      <th className="text-left py-3 px-3">Amount</th>
                      <th className="text-left py-3 px-3">Method</th>
                      <th className="text-left py-3 px-3">Status</th>
                      <th className="text-left py-3 px-3">Proof</th>
                      <th className="text-left py-3 px-3">Date</th>
                      <th className="text-right py-3 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => (
                      <tr key={t.id} className="border-b border-white/5">
                        <td className="py-3 px-3">
                          <div className="font-medium">{t.product_name}</div>
                          <div className="text-[10px] text-zinc-500 mt-1">{t.buyer_name || t.buyer_email || "Guest"}</div>
                        </td>
                        <td className="py-3 px-3 font-mono">{fmtPrice(t.payable_amount || t.amount)}</td>
                        <td className="py-3 px-3 text-xs text-zinc-400">
                          {t.payment_method === "manual_bank"
                            ? "Bank transfer (legacy)"
                            : t.payment_method === "doku"
                              ? "DOKU"
                              : t.payment_method || "Legacy"}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            t.payment_status === "paid"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : t.payment_status === "failed" || t.proof_status === "rejected"
                                ? "bg-red-500/15 text-red-400"
                                : "bg-amber-500/15 text-amber-400"
                          }`}>
                            {t.proof_status === "submitted" ? "verify proof" : t.status || t.payment_status}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          {t.proof_url ? (
                            <a
                              href={t.proof_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300"
                            >
                              View <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-zinc-600">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-zinc-400">{(t.created_at || "").slice(0, 10)}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {!showArchivedTransactions && t.payment_method === "manual_bank" && t.proof_status === "submitted" && (
                              <>
                              <button
                                onClick={() => reviewManualPayment(t, "approve")}
                                title="Approve payment"
                                className="p-2 rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => reviewManualPayment(t, "reject")}
                                title="Reject proof"
                                className="p-2 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                              </>
                            )}
                            <button
                              onClick={() => setTransactionArchived(t, !showArchivedTransactions)}
                              disabled={transactionActionId === t.id}
                              title={showArchivedTransactions ? "Pulihkan transaksi" : "Arsipkan transaksi"}
                              className={`p-2 rounded-full transition-colors disabled:opacity-50 ${
                                showArchivedTransactions
                                  ? "bg-sky-500/10 text-sky-400 hover:bg-sky-500/20"
                                  : "bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20"
                              }`}
                            >
                              {transactionActionId === t.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : showArchivedTransactions ? (
                                <RotateCcw className="w-4 h-4" />
                              ) : (
                                <EyeOff className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
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
                      <th className="text-left py-3 px-3">Benefit</th>
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
                          {(c.coupon_type || "discount") === "trial"
                            ? `Trial ${c.trial_days || 7} hari · ${
                                products.find((product) => product.id === c.trial_product_id)?.name
                                || "Product"
                              }`
                            : (
                              <>
                                <div>
                                  {c.discount_type === "percent"
                                    ? `${c.discount_value}%`
                                    : fmtPrice(c.discount_value)}
                                </div>
                                <div className="mt-1 text-[10px] text-zinc-500">
                                  {c.discount_product_id
                                    ? products.find((product) => product.id === c.discount_product_id)?.name
                                      || "Specific Product"
                                    : "All Products"}
                                </div>
                              </>
                            )}
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
className="w-full flex items-center justify-between px-4 py-2 bg-[#e11d48] hover:bg-[#be123c] text-white rounded-t-xl shadow-lg transition"
>

<div>

<h3 className="font-bold text-sm leading-tight">

🎹 {product}

</h3>

<p className="text-[10px] text-white/80 mt-0.5">
  
{licenses.length} {licenses.length === 1 ? "License" : "Licenses"}
  
</p>

</div>

<div className="text-lg leading-none">

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
              {tab !== "security" && items.length === 0 && (
                <div className="text-center py-12 text-zinc-500">No items.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Modal */}

      {broadcastModal && (

<div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50">

<div className="w-full max-w-xl bg-[#0a0a0c] border border-white/10 rounded-2xl p-8">

<h2 className="text-2xl font-bold mb-6">

Broadcast Email

</h2>

<div className="space-y-4">

<label className="text-sm text-gray-400">
Target Recipient
</label>

<select
value={broadcastTarget}
onChange={(e)=>setBroadcastTarget(e.target.value)}
className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3"
>

<option value="all">
All Customers
</option>

<option value="trial">
Trial Users
</option>

<option value="paid">
Paid Customers
</option>

<option value="license">
Active License Users
</option>

<option disabled>
──────── Products ────────
</option>

{products.map((p)=>(
<option
key={p.id}
value={`product:${p.id}`}
>
Product: {p.name}
</option>
))}

</select>


<input
value={broadcastSubject}
onChange={(e)=>setBroadcastSubject(e.target.value)}
placeholder="Subject"
className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3"
/>


<textarea
rows={10}
value={broadcastMessage}
onChange={(e)=>setBroadcastMessage(e.target.value)}
placeholder="Write your email..."
className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3"
/>


</div>

<div className="flex justify-end gap-3 mt-6">

<button
onClick={()=>setBroadcastModal(false)}
className="px-5 py-2 rounded-full border border-white/10"
>

Cancel

</button>

<button
onClick={sendBroadcastEmail}
disabled={sendingBroadcast}
className="px-5 py-2 rounded-full bg-[#e11d48]"
>

{sendingBroadcast
? "Sending..."
: "Send Email"}

</button>

</div>

</div>

</div>

)}
      
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
                        <option key={opt} value={opt}>{f.optionLabels?.[opt] || opt}</option>
                      ))}
                    </select>
                  ) : f.type === "product_select" ? (
                    <select
                      data-testid={`field-${f.key}`}
                      value={form[f.key] || ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      required={f.required}
                      className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                    >
                      <option value="">Pilih product...</option>
                      {products
                        .filter((product) => !f.licensedOnly || product.requires_license)
                        .filter((product) =>
                          !f.excludeFree
                          || (!product.is_free && Number(product.price || 0) > 0)
                        )
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
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
                        onChange={(e) => setForm({
                          ...form,
                          [f.key]: e.target.value,
                          ...(f.storageKey ? {
                            [f.storageKey]: "",
                            [f.filenameKey]: "",
                          } : {}),
                        })}
                        placeholder={
                          f.storageKey && form[f.storageKey]
                            ? `File privat: ${form[f.filenameKey] || "tersimpan di R2"}`
                            : "https://... atau upload di bawah"
                        }
                        className="w-full bg-[#050505] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#e11d48]"
                        required={f.required && !(f.storageKey && form[f.storageKey])}
                      />
                      <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-white/15 text-xs text-zinc-400 cursor-pointer hover:bg-white/5">
                        {uploadingProductField === f.key
                          ? <Loader2 className="w-4 h-4 text-[#e11d48] animate-spin" />
                          : <Upload className="w-4 h-4 text-[#e11d48]" />}
                        <span>
                          {uploadingProductField === f.key
                            ? `Mengunggah ${productUploadProgress}%`
                            : `${f.uploadLabel || "Upload product file"} (maks. ${f.storageKey ? "5 GB" : "500 MB"})`}
                        </span>
                        <input
                          data-testid={`upload-${f.key}`}
                          type="file"
                          className="hidden"
                          disabled={!!uploadingProductField}
                          onChange={(e) => uploadProductFile(e.target.files?.[0], f)}
                        />
                      </label>
                      {f.storageKey && form[f.storageKey] && (
                        <div className="text-[10px] text-emerald-400 font-mono truncate">
                          ✓ Privat R2: {form[f.filenameKey] || form[f.storageKey]}
                        </div>
                      )}
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
                      min={f.min}
                      max={f.max}
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
