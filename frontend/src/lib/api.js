import axios from "axios";

// Production uses the same domain through Nginx (/api).
// Local development may set REACT_APP_BACKEND_URL=http://127.0.0.1:8000.
const configuredBackend = (process.env.REACT_APP_BACKEND_URL || "").trim();

export const BACKEND_URL = configuredBackend.replace(/\/$/, "");
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

export const api = axios.create({
  baseURL: API,
  timeout: 20000,
});

// ✅ FIX UTAMA: KIRIM TOKEN KE SEMUA REQUEST
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ts_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// ✅ RESPONSE NORMAL (JANGAN DIUTAK-ATIK LAGI)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      error.userMessage = "Server tidak dapat dihubungi. Silakan coba lagi.";
    } else if (error.response.status === 404) {
      error.userMessage = "Data atau endpoint yang diminta tidak ditemukan.";
    } else {
      error.userMessage =
        error.response?.data?.detail ||
        "Permintaan gagal. Silakan coba lagi.";
    }

    return Promise.reject(error);
  }
);

export const fmtPrice = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
