import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  Clock3,
  Copy,
  FileCheck2,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { api, fmtPrice } from "../lib/api";

const statusPresentation = (order) => {
  if (order?.payment_status === "paid") {
    return {
      label: "Pembayaran disetujui",
      description: "Produk dan lisensi sudah tersedia di dashboard Anda.",
      tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (order?.status === "expired" || order?.payment_status === "failed") {
    return {
      label: "Pembayaran kedaluwarsa",
      description: "Buat pesanan baru dari halaman produk untuk melanjutkan.",
      tone: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }
  if (order?.proof_status === "submitted") {
    return {
      label: "Bukti sedang diperiksa",
      description: "Admin akan mencocokkan bukti dengan mutasi rekening.",
      tone: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }
  if (order?.proof_status === "rejected") {
    return {
      label: "Bukti perlu dikirim ulang",
      description: order.review_note || "Bukti sebelumnya belum dapat diverifikasi.",
      tone: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    };
  }
  return {
    label: "Menunggu transfer",
    description: "Transfer sesuai nominal persis, lalu unggah bukti pembayaran.",
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  };
};

export default function ManualPayment() {
  const { transactionId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);

  const loadOrder = useCallback(async () => {
    try {
      const response = await api.get(`/checkout/manual/${transactionId}`);
      setOrder(response.data);
    } catch (error) {
      if (error?.response?.status === 401) {
        navigate("/login", { state: { from: `/payment/manual/${transactionId}` } });
        return;
      }
      toast.error(error?.response?.data?.detail || "Pesanan tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [navigate, transactionId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const copyValue = async (value, label) => {
    try {
      await navigator.clipboard.writeText(String(value));
      toast.success(`${label} disalin`);
    } catch {
      toast.error(`${label} tidak dapat disalin`);
    }
  };

  const uploadProof = async () => {
    if (!file) {
      toast.error("Pilih file bukti pembayaran terlebih dahulu.");
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await api.post(
        `/checkout/manual/${transactionId}/proof`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setOrder(response.data);
      setFile(null);
      toast.success("Bukti pembayaran berhasil dikirim.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Bukti pembayaran gagal dikirim.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-32 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#e11d48]" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen pt-32 px-6 text-center">
        <AlertCircle className="w-10 h-10 mx-auto text-red-400 mb-4" />
        <h1 className="font-[Outfit] text-2xl font-bold mb-4">Pesanan tidak ditemukan</h1>
        <Link to="/shop" className="text-[#e11d48] hover:underline">Kembali ke toko</Link>
      </div>
    );
  }

  const status = statusPresentation(order);
  const canUpload =
    order.payment_status !== "paid" &&
    order.status !== "expired" &&
    order.proof_status !== "submitted";
  const expiresAt = order.expires_at
    ? new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(order.expires_at))
    : "-";

  return (
    <div className="min-h-screen pt-28 pb-24 px-6">
      <div className="max-w-3xl mx-auto">
        <Link
          to={`/shop/${order.product_id}`}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke produk
        </Link>

        <div className="bg-[#0a0a0c] border border-white/10 rounded-3xl overflow-hidden">
          <div className="p-7 md:p-9 border-b border-white/10">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-[#e11d48] font-bold mb-2">
                  Transfer Bank Manual
                </div>
                <h1 className="font-[Outfit] text-3xl font-black">{order.product_name}</h1>
                <div className="text-xs text-zinc-500 font-mono mt-2">{order.order_id}</div>
              </div>
              <div className={`border rounded-2xl px-4 py-3 max-w-sm ${status.tone}`}>
                <div className="font-semibold text-sm">{status.label}</div>
                <div className="text-xs opacity-80 mt-1">{status.description}</div>
              </div>
            </div>
          </div>

          <div className="p-7 md:p-9 grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex items-center gap-2 text-zinc-400 mb-5">
                <Building2 className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-[0.18em]">Rekening Tujuan</span>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-zinc-500">Bank</div>
                  <div className="font-semibold mt-1">{order.bank?.bank_name}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Nomor rekening</div>
                  <div className="flex items-center justify-between gap-3 mt-1">
                    <div className="font-mono text-lg font-bold">{order.bank?.account_number}</div>
                    <button
                      onClick={() => copyValue(order.bank?.account_number, "Nomor rekening")}
                      className="p-2 rounded-full border border-white/10 hover:bg-white/5"
                      title="Salin nomor rekening"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Atas nama</div>
                  <div className="font-semibold mt-1">{order.bank?.account_holder}</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#e11d48]/30 bg-[#e11d48]/5 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400 mb-3">
                Nominal yang harus ditransfer
              </div>
              <div className="font-[Outfit] text-4xl font-black text-white">
                {fmtPrice(order.payable_amount)}
              </div>
              <div className="flex items-center gap-2 text-xs text-amber-300 mt-3">
                <AlertCircle className="w-3.5 h-3.5" />
                Nominal termasuk kode unik {order.unique_code}. Transfer harus persis.
              </div>
              <button
                onClick={() => copyValue(Math.round(order.payable_amount), "Nominal transfer")}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-zinc-200"
              >
                <Copy className="w-3.5 h-3.5" />
                Salin nominal
              </button>
              <div className="flex items-center gap-2 text-xs text-zinc-500 mt-5">
                <Clock3 className="w-3.5 h-3.5" />
                Batas pembayaran: {expiresAt}
              </div>
            </div>
          </div>

          {order.bank?.instructions && (
            <div className="mx-7 md:mx-9 mb-6 rounded-2xl border border-white/10 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 mb-2">
                Catatan
              </div>
              <p className="text-sm text-zinc-300 whitespace-pre-line">{order.bank.instructions}</p>
            </div>
          )}

          <div className="p-7 md:p-9 pt-0">
            {canUpload ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-6">
                <div className="flex items-start gap-4">
                  <Upload className="w-5 h-5 text-[#e11d48] mt-0.5" />
                  <div className="flex-1">
                    <h2 className="font-semibold">Unggah bukti transfer</h2>
                    <p className="text-xs text-zinc-500 mt-1">JPG, PNG, WEBP, atau PDF. Maksimal 5 MB.</p>
                    {order.proof_status === "rejected" && order.review_note && (
                      <p className="text-xs text-rose-300 mt-3">{order.review_note}</p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-3 mt-4">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) => setFile(event.target.files?.[0] || null)}
                        className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15"
                      />
                      <button
                        onClick={uploadProof}
                        disabled={!file || uploading}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold text-sm disabled:opacity-50"
                      >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
                        Kirim bukti
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : order.payment_status === "paid" ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-500 hover:bg-emerald-600 font-semibold"
              >
                <Check className="w-4 h-4" />
                Buka dashboard
              </Link>
            ) : order.proof_status === "submitted" ? (
              <button
                onClick={loadOrder}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-white/15 hover:bg-white/5 text-sm font-semibold"
              >
                <RefreshCw className="w-4 h-4" />
                Perbarui status
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
