import { m } from "framer-motion";
import { useLocation } from "react-router-dom";
import logoUrl from "../../assets/ashkan-medical-logo.webp";

export function BrandLogo({ className = "h-16 w-16" }) {
  // Same reasoning as PageTransition: on the first (server-rendered) page the
  // logo must ship visible, or the markup carries `opacity: 0` and the brand
  // mark is invisible to anything that doesn't run JS. It still springs in on
  // client-side navigations, which is where the flourish is actually seen.
  const isFirstPage = useLocation().key === "default";

  return (
    <m.img
      src={logoUrl}
      alt="Ashkan Medical Idea"
      initial={isFirstPage ? false : { scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`rounded-3xl bg-white object-contain p-1.5 shadow-lg shadow-emerald-500/30 ${className}`}
    />
  );
}
