import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);
let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message, { type = "default", duration = 3200 } = {}) => {
      const id = ++idSeq;
      setToasts((t) => [...t, { id, message, type }]);
      if (duration) setTimeout(() => remove(id), duration);
      return id;
    },
    [remove]
  );

  const toast = useCallback(
    (message, opts) => push(message, opts),
    [push]
  );
  toast.success = (msg, opts) => push(msg, { ...opts, type: "success" });
  toast.error = (msg, opts) => push(msg, { ...opts, type: "error" });

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => remove(t.id)}
              className={
                // Entrance only. There is no exit animation now that
                // AnimatePresence is gone -- keeping a library in the app
                // shell to fade a dismissed toast out over 200ms was not a
                // trade worth 77KB on every first visit.
                "pointer-events-auto max-w-[92%] animate-[toastIn_320ms_var(--ease-out-quart)_both] " +
                "rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl " +
                (t.type === "success"
                  ? "border-emerald-400/30 bg-emerald-950/90 text-emerald-200"
                  : t.type === "error"
                    ? "border-red-400/30 bg-red-950/90 text-red-200"
                    : "border-surface/10 bg-base-800/95 text-fg")
              }
            >
              {t.message}
            </div>
          ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
