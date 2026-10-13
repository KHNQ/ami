import { Suspense, lazy } from "react";
import { Sparkles } from "lucide-react";
import { useAiEnabled } from "./useAiEnabled.js";
import { useAiChat } from "../../context/AiChatContext.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { cn } from "../../lib/cn.js";

// cult-ui's metal-fx button. Lazy, and isolated into its own chunk by
// vite.config.js: `metal-fx` is a 132KB WebGL shader and this is a launcher
// for a chat panel -- it must not sit in the first paint of a storefront.
// Until it arrives (and for anyone on reduced motion) the plain gradient
// button below renders instead, which is a complete, working control.
const MetalButton = lazy(() =>
  import("../cult/metal-button.jsx").then((m) => ({ default: m.MetalButton }))
);

// A floating entry point to the assistant, for the screens that have no
// bottom dock to put it in (product, category, partners, story, careers).
//
// It is now only a trigger. The overlay itself is AiOverlay, mounted once per
// layout and driven by AiChatContext -- previously this component owned both,
// which meant every screen with a button also carried its own copy of the
// panel, and the bottom navigation could not open the assistant at all.
export function AskButton({
  productId = null,
  productName = null,
  offsetClass = "bottom-[max(1rem,env(safe-area-inset-bottom))]",
}) {
  const t = useT();
  const enabled = useAiEnabled();
  const { open, openChat } = useAiChat();
  const reduced = useReducedMotion();

  if (!enabled || open) return null;

  const position = cn("group fixed end-4 z-40", offsetClass);
  const label = (
    <>
      <Sparkles size={17} />
      <span className="text-[13px] font-extrabold">{t("ai.open")}</span>
    </>
  );

  const plain = (
    <button
      type="button"
      onClick={() => openChat({ productId, productName })}
      aria-label={t("ai.open")}
      className={cn(
        position,
        "flex h-12 cursor-pointer items-center gap-2 rounded-full bg-gradient-to-br from-brand-green to-brand-blue px-4 text-white shadow-xl shadow-brand-green/30 transition-transform active:scale-95"
      )}
    >
      {label}
    </button>
  );

  if (reduced) return plain;

  return (
    <Suspense fallback={plain}>
      <MetalButton
        onClick={() => openChat({ productId, productName })}
        aria-label={t("ai.open")}
        className={cn(position, "h-12 cursor-pointer gap-2 rounded-full px-4 text-[13px] font-extrabold")}
        metalFxClassName="rounded-full shadow-xl shadow-brand-green/25"
      >
        {label}
      </MetalButton>
    </Suspense>
  );
}
