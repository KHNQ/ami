import { Link } from "react-router-dom";
import { m } from "framer-motion";
import { Package } from "lucide-react";
import { Card } from "../ui/Card.jsx";
import { StatusBadge } from "../ui/Badge.jsx";
import { TiltCard } from "../ui/TiltCard.jsx";
import { money } from "../../lib/format.js";
import { api } from "../../lib/api.js";

export function ProductCard({ product }) {
  const imageUrl = api.productImageUrl(product);
  return (
    <m.div whileTap={{ scale: 0.97 }}>
      <TiltCard className="rounded-2xl">
      <Link to={`/products/${product.id}`}>
        <Card className="group/card overflow-hidden p-0">
          {/* Large image panel -- these are physical medical devices that all
              look broadly similar in silhouette, so the photo has to be big
              enough to actually tell them apart. The photos are background-
              removed PNGs (scripts/make-transparent-images.py) so they sit
              directly on the themed surface with a soft glow behind them. */}
          <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-b from-surface/[0.06] to-transparent">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-24 rounded-full bg-brand-gradient opacity-[0.18] blur-[36px]" />
            </div>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={product.name}
                // The grid renders the whole catalogue; only the cards
                // actually on screen should cost a request. Explicit
                // dimensions keep the aspect box from reflowing on load.
                loading="lazy"
                decoding="async"
                width="320"
                height="320"
                // Lifts and grows very slightly on hover, so the device reads
                // as sitting above the card rather than printed on it.
                className="relative h-full w-full object-contain p-3 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:-translate-y-1 group-hover/card:scale-[1.06]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-brand-gradient">
                <Package size={40} className="text-white/90" />
              </div>
            )}
            {product.status && product.status !== "active" && (
              <div className="absolute end-2 top-2">
                <StatusBadge status={product.status} />
              </div>
            )}
          </div>

          <div className="p-3.5">
            <div className="truncate text-[14px] font-bold text-fg">{product.name}</div>
            {product.description && (
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg/45">{product.description}</div>
            )}
            <div className="mt-2.5 flex items-end justify-between gap-2">
              <div className="text-[17px] font-extrabold text-gradient">{money(product.list_price_y_cents)}</div>
              <div className="shrink-0 text-[10.5px] text-fg/35">{product.stock_count} in stock</div>
            </div>
          </div>
        </Card>
      </Link>
      </TiltCard>
    </m.div>
  );
}
