import { Link } from "react-router-dom";
import { ArrowRight, Package } from "lucide-react";
import { money } from "../../lib/format.js";
import { useT } from "../../i18n/I18nProvider.jsx";
import { cn } from "../../lib/cn.js";

// A device, rendered inside the conversation.
//
// This exists because the assistant kept being asked to "show me" something
// and had to answer that it could not display images -- while the photograph
// sat one join away in the database. A named product in a chat reply is a
// dead end; a card with the real unit on it is the answer to the question
// that was actually asked.
//
// The slug behind every one of these was validated server-side against the
// live catalogue, so a card can never point at a product that does not exist.

export function AiProductCard({ item, onNavigate }) {
  const t = useT();

  // Non-product suggestions (a category, a manufacturer) have no photo or
  // stock, so they render as a compact row rather than a card pretending to
  // be a product with missing fields.
  if (item.kind !== "product") {
    return (
      <Link
        to={item.href}
        onClick={onNavigate}
        className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/30 bg-brand-green/8 px-3 py-1.5 text-[12px] font-bold text-brand-green transition-colors hover:bg-brand-green/15"
      >
        {item.name}
        <ArrowRight size={12} />
      </Link>
    );
  }

  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      className="group flex gap-3 overflow-hidden rounded-2xl border border-surface/12 bg-surface/[0.04] p-2.5 transition-all hover:border-brand-green/35 hover:bg-surface/[0.07]"
    >
      {/* White plate behind the device, for the same reason the lightbox uses
          one: these are background-removed photographs shot on white, and on
          a dark surface the bodywork disappears into it. */}
      <div className="relative flex h-[74px] w-[74px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-1.5 transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <Package size={22} className="text-black/25" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[13.5px] font-extrabold leading-tight text-fg">{item.name}</p>
          <ArrowRight
            size={14}
            className="mt-0.5 shrink-0 text-fg/25 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-green"
          />
        </div>

        {item.manufacturer && (
          <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wide text-brand-green">
            {item.manufacturer}
          </p>
        )}
        {item.summary && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-fg/45">{item.summary}</p>
        )}

        <div className="mt-1.5 flex items-center gap-2 text-[11.5px]">
          {/* Absent price is not an error -- it is the show_prices flag doing
              its job, so it reads as a deliberate "on request" rather than a
              blank. */}
          <span className="font-bold tabular-nums text-fg/85">
            {item.price_cents != null ? money(item.price_cents) : t("common.priceOnRequest")}
          </span>
          {item.in_stock != null && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-semibold",
                item.in_stock ? "text-brand-green" : "text-fg/35"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", item.in_stock ? "bg-brand-green" : "bg-fg/30")} />
              {item.in_stock ? t("ai.inStock") : t("common.outOfStock")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
