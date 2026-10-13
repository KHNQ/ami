import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { adminApi, getToken, setToken, setUnauthorizedHandler } from "../lib/adminApi.js";

const AdminAuthContext = createContext(null);

// Purpose-built rather than reusing the storefront's AuthContext, because
// this app needs to gate on *permissions*, not on a role boolean. A sales
// agent and an inventory admin are both `role === "admin"`, and showing them
// the same navigation would mean half of it 403s the moment they click it.
//
// The API remains the authority -- every route re-checks server-side. This is
// only about not offering someone a door that is locked.
export function AdminAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(getToken() ? "loading" : "anonymous");

  const load = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setStatus("anonymous");
      return;
    }
    try {
      const me = await adminApi.me();
      setUser(me);
      setStatus(me.role === "admin" ? "authed" : "forbidden");
    } catch {
      setToken(null);
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    load();
    // A 401 from anywhere (an expired token, a password change on another
    // device retiring this session) drops straight back to the login screen
    // rather than leaving a half-broken page.
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("anonymous");
    });
  }, [load]);

  const login = useCallback(
    async (email, password) => {
      const res = await adminApi.login({ email, password });
      setToken(res.token);
      setUser(res.user);
      setStatus(res.user.role === "admin" ? "authed" : "forbidden");
      return res.user;
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const can = useCallback((permission) => user?.permissions?.includes(permission) ?? false, [user]);

  return (
    <AdminAuthContext.Provider value={{ user, status, login, logout, can, refresh: load }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}
