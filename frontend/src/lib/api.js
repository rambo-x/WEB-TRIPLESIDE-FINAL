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

api.interceptors.response.use(
  (response) => response,
  (error) => {

    // 🔥 PRIORITAS: HANDLE TRIAL DULU (SEBELUM APAPUN)
    if (
      error?.config?.url?.includes("/customer/trials/") &&
      error?.response?.data
    ) {
      return Promise.resolve(error.response);
    }

    // ❌ BARU HANDLE ERROR NORMAL
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
