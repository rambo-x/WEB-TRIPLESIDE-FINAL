import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

// Stores user as { kind: 'customer'|'admin', profile: {...} }
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshFromToken = async () => {
    const token = localStorage.getItem("ts_token");
    const kind = localStorage.getItem("ts_kind"); // 'customer' or 'admin'
    if (!token || !kind) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      if (kind === "admin") {
        const r = await api.get("/auth/me");
        setUser({ kind: "admin", profile: r.data });
      } else {
        const r = await api.get("/customer/me");
        setUser({ kind: "customer", profile: r.data });
      }
    } catch {
      localStorage.removeItem("ts_token");
      localStorage.removeItem("ts_kind");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshFromToken();
  }, []);

  const adminLogin = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    localStorage.setItem("ts_token", r.data.token);
    localStorage.setItem("ts_kind", "admin");
    setUser({ kind: "admin", profile: { email: r.data.email } });
    return r.data;
  };

  const customerLogin = async (identifier, password) => {
    const r = await api.post("/customer/login", { identifier, password });
    localStorage.setItem("ts_token", r.data.token);
    localStorage.setItem("ts_kind", "customer");
    setUser({ kind: "customer", profile: r.data.customer });
    return r.data;
  };

  const customerRegister = async (data) => {
    const r = await api.post("/customer/register", data);
    localStorage.setItem("ts_token", r.data.token);
    localStorage.setItem("ts_kind", "customer");
    setUser({ kind: "customer", profile: r.data.customer });
    return r.data;
  };

  const updateProfile = async (updates) => {
    const r = await api.put("/customer/me", updates);
    setUser({ kind: "customer", profile: r.data });
    return r.data;
  };

  const logout = () => {
    localStorage.removeItem("ts_token");
    localStorage.removeItem("ts_kind");
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isCustomer: user?.kind === "customer",
        isAdmin: user?.kind === "admin",
        adminLogin,
        customerLogin,
        customerRegister,
        updateProfile,
        logout,
        refresh: refreshFromToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
