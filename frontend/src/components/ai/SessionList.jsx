import { useEffect, useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { relativeTime } from "../../lib/format.js";
import { listSessions, renameSession, deleteSession } from "../../lib/aiClient.js";

// Past conversations, rendered inside the chat header's existing title
// dropdown rather than in new chrome of its own.
//
// Only signed-in visitors have anything to list: an anonymous thread lives in
// KV for two hours and belongs to a browser tab, not an account. Rather than
// hide the control, the signed-out state says so — that is the clearest place
// to explain what an account buys.

function Row({ session, active, onOpen, onRenamed, onDeleted, t }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    const title = draft.trim();
    if (!title || title === session.title) return setEditing(false);
    setBusy(true);
    try {
      const updated = await renameSession(session.id, title);
      onRenamed(updated);
      setEditing(false);
    } catch {
      setDraft(session.title || "");
      setEditing(false);
    }
    setBusy(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl border border-brand-green/40 bg-panel p-1.5">
        <input
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-ink outline-none"
        />
        <button type="button" onClick={save} aria-label={t("common.save")} className="cursor-pointer text-brand-green">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label={t("common.cancel")}
          className="cursor-pointer text-ink-3"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/row flex items-center gap-2 rounded-xl px-2 py-1.5",
        active ? "bg-brand-green/10" : "hover:bg-panel-2"
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-start"
      >
        <MessageSquare
          className={cn("h-3.5 w-3.5 shrink-0", active ? "text-brand-green" : "text-ink-3")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-ink">
            {session.title || t("ai.untitled")}
          </span>
          {session.last_message_at ? (
            <span className="block text-[11px] text-ink-3">{relativeTime(session.last_message_at)}</span>
          ) : null}
        </span>
      </button>

      {/* Kept visible on touch, revealed on hover on a pointer device --
          `group-hover` alone would make them unreachable on a phone. */}
      <span className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t("ai.renameConversation")}
          className="cursor-pointer p-1 text-ink-3 hover:text-ink"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={async () => {
            await deleteSession(session.id).catch(() => {});
            onDeleted(session.id);
          }}
          aria-label={t("ai.deleteConversation")}
          className="cursor-pointer p-1 text-ink-3 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

export function SessionList({ isAuthed, activeId, onOpen, onNew, t }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Refetched whenever the active conversation changes, which covers the case
  // that matters: the server created one for this turn and it is not in the
  // list yet.
  useEffect(() => {
    if (!isAuthed) return undefined;
    let cancelled = false;
    setLoading(true);
    listSessions()
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed, activeId]);

  return (
    <div className="w-72">
      <button
        type="button"
        onClick={onNew}
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-start hover:bg-panel-2"
      >
        <Plus className="h-3.5 w-3.5 text-brand-green" />
        <span className="text-[13px] font-black text-ink">{t("ai.reset")}</span>
      </button>

      {!isAuthed ? (
        <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-2">{t("ai.signInForHistory")}</p>
      ) : (
        <>
          <h3 className="mt-1 px-2 pt-2 text-[10px] font-extrabold tracking-[0.14em] text-ink-3 uppercase">
            {t("ai.recentConversations")}
          </h3>
          <div className="mt-1 max-h-[min(50vh,320px)] overflow-y-auto">
            {loading && sessions.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-ink-3">{t("common.loading")}</p>
            ) : null}
            {!loading && sessions.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-ink-2">{t("ai.noConversationsYet")}</p>
            ) : null}
            {sessions.map((s) => (
              <Row
                key={s.id}
                session={s}
                active={s.id === activeId}
                onOpen={onOpen}
                onRenamed={(u) => setSessions((rows) => rows.map((r) => (r.id === u.id ? { ...r, ...u } : r)))}
                onDeleted={(id) => setSessions((rows) => rows.filter((r) => r.id !== id))}
                t={t}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
