import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { LazyMotion, domAnimation } from "framer-motion";
import App from "./App.jsx";
import { AdminAuthProvider } from "./context/AdminAuthContext.jsx";
import { ErrorBoundary } from "@shared/components/ErrorBoundary.jsx";
import { ThemeProvider } from "@shared/context/ThemeContext.jsx";
import { ToastProvider } from "@shared/context/ToastContext.jsx";
import "./index.css";

// No hydration and no service worker here, unlike the storefront: this is an
// internal tool that is never server-rendered and never wants to be cached
// offline. A stale cached build of a money-handling console is a liability,
// not a feature.
//
// LazyMotion is required, not optional: BottomSheet, SegmentedControl, Button
// and Toast (all @shared) render framer-motion's `m` components, which need a
// LazyMotion ancestor to actually receive animation features. Without one
// they still render -- just as static, uncontrolled elements with every
// `animate`/`exit` prop silently inert -- so this was a real (if quiet) bug,
// not just a defensive addition. `strict` matches AppProviders.jsx: it's the
// same guard against a future `motion.div` accidentally pulling in the full,
// un-lazy bundle.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <LazyMotion features={domAnimation} strict>
            <ToastProvider>
              <AdminAuthProvider>
                <App />
              </AdminAuthProvider>
            </ToastProvider>
          </LazyMotion>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
