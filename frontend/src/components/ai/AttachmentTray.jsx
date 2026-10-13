import { FileText, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "../../lib/cn.js";

// The files staged for the next message.
//
// Each one is uploading, uploaded or failed, and says which. An upload that
// fails silently is the worst outcome here -- the visitor presses send, the
// assistant answers about nothing, and neither of them knows why.

function Thumb({ item }) {
  if (item.kind === "image" && item.previewUrl) {
    return (
      <img
        src={item.previewUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover"
      />
    );
  }
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-panel-2 text-ink-2">
      <FileText className="h-4 w-4" />
    </span>
  );
}

export function AttachmentTray({ items, onRemove, t }) {
  if (!items.length) return null;

  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item.key}
          className={cn(
            "flex max-w-[15rem] items-center gap-2 rounded-xl border bg-panel-2 py-1 ps-1 pe-1.5",
            item.status === "failed" ? "border-rose-500/40" : "border-line"
          )}
        >
          <Thumb item={item} />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-bold text-ink">{item.filename}</span>
            <span
              className={cn(
                "block truncate text-[11px]",
                item.status === "failed" ? "text-rose-600 dark:text-rose-300" : "text-ink-3"
              )}
            >
              {item.status === "uploading" ? (
                <>
                  <Loader2 className="me-1 inline h-3 w-3 animate-spin" />
                  {t("ai.attachUploading")}
                </>
              ) : item.status === "failed" ? (
                <>
                  <TriangleAlert className="me-1 inline h-3 w-3" />
                  {item.error}
                </>
              ) : item.hasText === false && item.kind === "document" ? (
                // A scan has no text in it. Saying so here is what stops the
                // visitor asking a question the model cannot answer and
                // concluding the assistant is broken.
                t("ai.attachNoText")
              ) : (
                t("ai.attachReady")
              )}
            </span>
          </span>

          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={t("ai.attachRemove", { name: item.filename })}
            className="shrink-0 cursor-pointer rounded-md p-1 text-ink-3 hover:bg-panel hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The same files, after the message was sent: read-only, on the bubble. */
export function AttachmentChips({ items, align = "end" }) {
  if (!items?.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", align === "end" ? "justify-end" : "")}>
      {items.map((item) => (
        <li key={item.key || item.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1">
          {item.kind === "image" && item.previewUrl ? (
            <img src={item.previewUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-ink-2" />
          )}
          <span className="max-w-[12rem] truncate text-[11.5px] font-bold text-ink-2">{item.filename}</span>
        </li>
      ))}
    </ul>
  );
}
