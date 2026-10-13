import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Crown, Minus, Plus, Scan, Users2, GitBranch, Wallet, Clock, Layers } from "lucide-react";
import { usePanZoom } from "../../hooks/usePanZoom.js";
import { layoutTree } from "../../lib/treeLayout.js";
import { StatusBadge } from "../ui/Badge.jsx";
import { money, relativeTime } from "../../lib/format.js";
import { useT } from "../../i18n/I18nProvider.jsx";
import { api } from "../../lib/api.js";
import { cn } from "../../lib/cn.js";

const STATUS_RING = {
  active: "ring-emerald-400/60",
  inactive: "ring-surface/20",
  suspended: "ring-red-400/60",
};

function nodeLabel(t, node, isRoot, isYou) {
  if (isYou) return t("space.you");
  if (isRoot) return t("space.root");
  return t("network.memberLabel", { id: node.node_id.slice(-6) });
}

function NodeChip({ pos, isRoot, isYou, isSelected, isHovered, onEnter, onLeave, onTap }) {
  const { node, x, y } = pos;
  const emphasized = isSelected || isHovered;
  return (
    <button
      type="button"
      data-tree-node
      onPointerDown={(e) => e.stopPropagation()}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className="absolute flex flex-col items-center focus:outline-none"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      <div
        className={cn(
          // Scale was a framer spring; a transform transition is the same
          // gesture without keeping an animation library on the critical path.
          "flex h-12 w-12 items-center justify-center rounded-full text-label font-bold ring-2",
          "transition-[transform,box-shadow] duration-md ease-back",
          emphasized ? "scale-[1.14]" : "scale-100",
          isRoot ? "bg-brand-gradient text-white" : "bg-panel-2 text-ink-2",
          isYou && !isRoot && "bg-brand-gradient/80 text-white",
          STATUS_RING[node.status] || STATUS_RING.inactive,
          emphasized && "shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-brand-green)_22%,transparent)]"
        )}
      >
        {isRoot ? <Crown size={17} /> : node.node_id.slice(-2).toUpperCase()}
      </div>
      <div
        className={cn(
          "mt-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-label font-semibold",
          emphasized ? "bg-panel-2 text-fg" : "text-ink-2"
        )}
      >
        {isYou ? "You" : isRoot ? "Root" : `#${node.node_id.slice(-4)}`}
      </div>
    </button>
  );
}

function MiniStat({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface/[0.03] px-3 py-2">
      <span className="text-ink-2">{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-xs font-bold text-fg">{value}</div>
        <div className="truncate text-label font-medium uppercase tracking-wide text-ink-2">{label}</div>
      </div>
    </div>
  );
}

function NodeStatPanel({ pos, isRoot, isYou, canViewEarnings }) {
  const t = useT();
  const { node, depth, childCount, descendantCount } = pos;
  const [earnings, setEarnings] = useState(null);
  const [loadingEarnings, setLoadingEarnings] = useState(canViewEarnings);

  // Commission earnings are private to the node's owner (and admins) --
  // only fetch when we're actually allowed to see them, otherwise the API
  // correctly 403s and we'd just be generating noisy failed requests.
  useEffect(() => {
    if (!canViewEarnings) {
      setEarnings(null);
      setLoadingEarnings(false);
      return;
    }
    let ignore = false;
    setEarnings(null);
    setLoadingEarnings(true);
    api
      .getNodeEarnings(node.node_id)
      .then((res) => {
        if (!ignore) setEarnings(res.totals);
      })
      .catch(() => {
        if (!ignore) setEarnings(null);
      })
      .finally(() => {
        if (!ignore) setLoadingEarnings(false);
      });
    return () => {
      ignore = true;
    };
  }, [node.node_id, canViewEarnings]);

  return (
    <div className="glass absolute inset-x-2 bottom-2 animate-[panelIn_220ms_var(--ease-out-quart)_both] rounded-3xl border border-line p-4">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label font-bold",
            isRoot ? "bg-brand-gradient text-white" : "bg-panel-2 text-ink-2"
          )}
        >
          {isRoot ? <Crown size={15} /> : node.node_id.slice(-2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-fg">
            {nodeLabel(t, node, isRoot, isYou)}
          </div>
          <div className="text-label text-ink-2">
            {t("space.levelInSpace", { level: depth + 1 })}
          </div>
        </div>
        <StatusBadge status={node.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat
          icon={<Wallet size={15} />}
          label={t("network.lifetimeVolume")}
          value={money(node.lifetime_volume_cents)}
        />
        <MiniStat
          icon={<Layers size={15} />}
          label={t("space.volumeThisPeriod")}
          value={money(node.personal_volume_period_cents)}
        />
        <MiniStat icon={<Users2 size={15} />} label={t("space.directInvites")} value={childCount} />
        <MiniStat
          icon={<GitBranch size={15} />}
          label={t("space.totalDownline")}
          value={descendantCount}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <MiniStat
          icon={<Clock size={15} />}
          label={t("network.joined")}
          value={relativeTime(node.joined_at)}
        />
        <MiniStat
          icon={<Wallet size={15} />}
          label={t("space.commissionEarned")}
          value={
            !canViewEarnings
              ? t("space.private")
              : loadingEarnings
                ? "···"
                : earnings
                  ? money(earnings.total_cents)
                  : "—"
          }
        />
      </div>
    </div>
  );
}

export function SpaceTreeCanvas({ root, currentUserId, isAdmin = false }) {
  const t = useT();
  const layout = layoutTree(root);
  const { containerRef, scale, tx, ty, handlers, zoomBy, setTransform } = usePanZoom({ initialScale: 1 });
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const fitted = useRef(false);

  // Center + fit the tree into the viewport once we know both its size and
  // the container's size (runs once per space; re-fit if the tree changes).
  useLayoutEffect(() => {
    fitted.current = false;
  }, [root?.node_id]);

  useLayoutEffect(() => {
    if (fitted.current || !layout.width || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fitScale = Math.min(1, (rect.width - 32) / layout.width);
    const scaledWidth = layout.width * fitScale;
    setTransform({
      scale: fitScale,
      tx: (rect.width - scaledWidth) / 2,
      ty: 24,
    });
    fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width, layout.height]);

  if (!root) return null;

  const activeId = hoveredId ?? selectedId;
  const activePos = activeId ? layout.positions.get(activeId) : null;

  return (
    <div className="relative h-full w-full select-none overflow-hidden rounded-3xl border border-line bg-panel/60">
      <div
        ref={containerRef}
        className="absolute inset-0"
        onClick={() => setSelectedId(null)}
        {...handlers}
      >
        <div
          className="absolute left-0 top-0" /* rtl-keep: pan/zoom is computed in a left-origin space */
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            className="absolute left-0 top-0 overflow-visible" /* rtl-keep: same left-origin space as the canvas */
            width={layout.width}
            height={layout.height}
          >
            {layout.edges.map((edge) => {
              const from = layout.positions.get(edge.fromId);
              const to = layout.positions.get(edge.toId);
              if (!from || !to) return null;
              const midY = (from.y + to.y) / 2;
              const d = `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
              const dim = activeId && edge.fromId !== activeId && edge.toId !== activeId;
              return (
                <path
                  key={`${edge.fromId}-${edge.toId}`}
                  d={d}
                  fill="none"
                  stroke={
                    dim
                      ? "color-mix(in oklab, var(--color-fg) 8%, transparent)"
                      : "color-mix(in oklab, var(--color-brand-blue) 40%, transparent)"
                  }
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {[...layout.positions.values()].map((pos) => (
            <NodeChip
              key={pos.node.node_id}
              pos={pos}
              isRoot={pos.depth === 0}
              isYou={pos.node.user_id === currentUserId}
              isSelected={selectedId === pos.node.node_id}
              isHovered={hoveredId === pos.node.node_id}
              onEnter={() => setHoveredId(pos.node.node_id)}
              onLeave={() => setHoveredId((h) => (h === pos.node.node_id ? null : h))}
              onTap={() => setSelectedId((id) => (id === pos.node.node_id ? null : pos.node.node_id))}
            />
          ))}
        </div>
      </div>

      {/* Zoom controls -- sibling of the transformed content, so they stay fixed size/position. */}
      <div className="absolute end-3 top-3 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => zoomBy(1.35)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas/80 text-ink-2 backdrop-blur"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.35)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas/80 text-ink-2 backdrop-blur"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            fitted.current = false;
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const fitScale = Math.min(1, (rect.width - 32) / layout.width);
            setTransform({ scale: fitScale, tx: (rect.width - layout.width * fitScale) / 2, ty: 24 });
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas/80 text-ink-2 backdrop-blur"
        >
          <Scan size={15} />
        </button>
      </div>

      {!activePos && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="rounded-full border border-line bg-canvas/80 px-3.5 py-2 text-label font-medium text-ink-2 backdrop-blur">
            {t("space.tapHint")}
          </div>
        </div>
      )}

      {activePos && (
          <NodeStatPanel
            pos={activePos}
            isRoot={activePos.depth === 0}
            isYou={activePos.node.user_id === currentUserId}
            canViewEarnings={isAdmin || activePos.node.user_id === currentUserId}
          />
      )}
    </div>
  );
}
