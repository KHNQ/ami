import { defineTool } from "../registry.js";
import { db } from "../../../db/index.js";

// Files the visitor sent, after the turn they sent them in.
//
// An image costs 1-2k tokens *every turn it stays in the array*, so images
// drop out of the history after a couple of turns and leave a one-line
// mention behind carrying their id. These two tools are how the model gets
// one back when the conversation returns to it -- "and what was the total on
// that first invoice again?" -- without paying for every image on every turn.

defineTool("list_attachments", {
  auth: "user",
  description:
    "The files the visitor has sent in this conversation: id, filename, kind and when. Use this " +
    "when they refer to something they sent earlier and you no longer have it in view.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  summarise: (r) => `Found ${r.count} file${r.count === 1 ? "" : "s"} in this conversation`,
  handler(_args, ctx) {
    const rows = db.aiAttachments.listForSession(ctx.sessionId, ctx.userId);
    return {
      count: rows.length,
      note: rows.length
        ? "Call view_attachment with an id to look at one again."
        : "The visitor has not sent any files in this conversation.",
      attachments: rows.map((r) => ({
        attachment_id: r.id,
        filename: r.original_name || r.filename,
        kind: r.kind,
        has_text: Boolean(r.extracted_text),
        sent_at: r.created_at,
      })),
    };
  },
});

defineTool("view_attachment", {
  auth: "user",
  description:
    "Look at a file the visitor sent earlier, by its attachment id. An image comes back into " +
    "view so you can describe it; a document returns its text.",
  parameters: {
    type: "object",
    properties: { attachment_id: { type: "string", maxLength: 80 } },
    required: ["attachment_id"],
    additionalProperties: false,
  },
  summarise: (r) => (r.filename ? `Opened ${r.filename}` : undefined),
  async handler({ attachment_id }, ctx) {
    // Ownership-scoped, like every other read: an id is a guessable string
    // and the model is allowed to pass one, so the check is what makes that
    // safe rather than the id being secret.
    const row = db.aiAttachments.getOwned(attachment_id, ctx.userId);
    if (!row) return { error: "no such attachment in this visitor's files" };

    if (row.kind === "image") {
      if (!ctx.reviveAttachment) {
        return { error: "images cannot be reopened here" };
      }
      await ctx.reviveAttachment(row);
      return {
        filename: row.original_name || row.filename,
        status: "in_view",
        note: "The image is now in front of you. Answer from what you can see in it.",
      };
    }

    return {
      filename: row.original_name || row.filename,
      kind: row.kind,
      text: row.extracted_text || null,
      note: row.extracted_text
        ? undefined
        : "No text could be extracted from this file. If it is a scan, ask for a photograph instead.",
    };
  },
});
