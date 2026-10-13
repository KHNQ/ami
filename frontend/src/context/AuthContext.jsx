import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, setUnauthorizedHandler } from "../lib/api.js";
import { getToken, setToken } from "../lib/token.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | signed-in | signed-out

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus("signed-out");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
  }, [clear]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStatus("signed-out");
      return;
    }
    // Resolving the stored token must survive a bad network, because the cost
    // of getting this wrong is silent and total: this used to be a bare
    // `.catch(() => { setToken(null); ... })`, so ANY failure -- a dropped
    // connection, a request starved behind the browser's six-per-origin limit,
    // a server still warming up -- deleted a perfectly valid session. The user
    // was simply logged out, with nothing on screen to explain it, and the
    // token was gone so reloading did not help either.
    //
    // Only a 401 means "this credential is no longer good". api.js already
    // clears the token in that one case, so nothing here needs to; everything
    // else is transient and gets retried before we give up.
    let cancelled = false;
    const attempt = (remaining) =>
      api.me().then(
        (u) => {
          if (cancelled) return;
          setUser(u);
          setStatus("signed-in");
        },
        (err) => {
          if (cancelled) return;
          const isAuthFailure = err instanceof ApiError && err.status === 401;
          if (!isAuthFailure && remaining > 0) {
            // Brief backoff: the failures this guards against are contention,
            // not a server that is down for the day.
            setTimeout(() => attempt(remaining - 1), 400 * (3 - remaining));
            return;
          }
          // Out of retries: we cannot render a signed-in UI without the user
          // record, but the token stays put unless it was actually rejected,
          // so the next page load can still recover the session.
          setStatus("signed-out");
        }
      );
    attempt(2);
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { user, token } = await api.login({ email, password });
    setToken(token);
    setUser(user);
    setStatus("signed-in");
    return user;
  }, []);

  const signup = useCallback(async (email, password, name) => {
    const { user, token } = await api.signup({ email, password, name });
    setToken(token);
    setUser(user);
    setStatus("signed-in");
    return user;
  }, []);

  const logout = useCallback(() => {
    clear();
  }, [clear]);

  const refreshMe = useCallback(async () => {
    const u = await api.me();
    setUser(u);
    return u;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthed: status === "signed-in",
      // `status` is three-valued, so `!isAuthed` is NOT "signed out" -- it is
      // also true for the whole "loading" window while GET /me is in flight on
      // every page load. Anything that *acts* on being logged out (redirecting
      // to /login, say) must wait for certainty and read this instead.
      isSignedOut: status === "signed-out",
      isAdmin: user?.role === "admin",
      login,
      signup,
      logout,
      refreshMe,
    }),
    [user, status, login, signup, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
