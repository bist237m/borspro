// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { auth as authApi } from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true); // ilk yüklemede token kontrolü

  // Sayfa açılınca mevcut token'ı kontrol et
  useEffect(() => {
    const token = localStorage.getItem("bp_token");
    if (!token) { setLoading(false); return; }

    authApi.me()
      .then(u => setUser(u))
      .catch(() => localStorage.removeItem("bp_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await authApi.login({ email, password });
    localStorage.setItem("bp_token", token);
    setUser(u);
  }, []);

  const register = useCallback(async (email, password, full_name) => {
    const { token, user: u } = await authApi.register({ email, password, full_name });
    localStorage.setItem("bp_token", token);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("bp_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
