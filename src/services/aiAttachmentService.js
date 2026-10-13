import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { newId } from "../lib/id.js";
import { extractPdfText } from "../lib/pdfText.js";

// Files a visitor sends the assistant.
//
// Shaped after careerService.storeResume: a base64 data URL rather than
// multipart, because there is no multipart handling anywhere in this app and
// that precedent is already reviewed and working. The cost is ~33% more bytes
// over the wire against a 5MB cap, which is bounded and acceptable.
//
// Uploading happens BEFORE the message is sent, not with it. By the time the
// visitor presses send, the image is on disk and the PDF is already extracted,
// so the chat turn itself stays as fast as any other.

const MAX_BYTES = config.aiMaxAttachmentBytes;
const MAX_PER_MESSAGE = config.aiMaxAttachmentsPerMessage;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOC_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const EXT = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "application/pdf": ".pdf", "text/plain": ".txt", "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

/**
 * What the bytes actually are.
 *
 * The declared MIME is a claim by whoever built the request, and these bytes
 * are forwarded to a third-party model. `careerService` trusts the declaration;
 * for this path it is worth tightening, because a `.png` whose content is HTML
 * is a real upload vector and the cost of checking is four byte comparisons.
 */
function sniff(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12) {
    const riff = String.fromCharCode(b[0], b[1], b[2], b[3]);
    const webp = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  if (b.length >= 6 && String.fromCharCode(b[0], b[1], b[2]) === "GIF") return "image/gif";
  if (b.length >= 4 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "%PDF") return "application/pdf";
  // A zip container: xlsx and friends. Not distinguishable further without
  // reading the archive, so the declared type is accepted for these.
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b) return "zip";
  return null;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!match) throw Errors.badRequest("Expected a base64 data URL", "bad_data_url");
  const declared = match[1].toLowerCase();
  let bytes;
  try {
    bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
  } catch {
    throw Errors.badRequest("That file could not be decoded", "bad_data_url");
  }
  return { declared, bytes };
}

export const aiAttachmentService = {
  MAX_BYTES,
  MAX_PER_MESSAGE,

  async upload({ userId, sessionId = null, dataUrl, filename }) {
    const { declared, bytes } = parseDataUrl(dataUrl);

    if (bytes.length > MAX_BYTES) {
      throw Errors.badRequest(
        `That file is ${(bytes.length / 1e6).toFixed(1)}MB. The limit is ${(MAX_BYTES / 1e6).toFixed(0)}MB.`,
        "attachment_too_large"
      );
    }
    if (!IMAGE_TYPES.has(declared) && !DOC_TYPES.has(declared)) {
      throw Errors.badRequest(`${declared} files are not supported`, "attachment_type");
    }

    const actual = sniff(bytes);
    const isZipDoc = actual === "zip" && declared.includes("openxmlformats");
    if (!isZipDoc && actual !== declared) {
      // The declaration and the content disagree. Refused rather than
      // corrected, because the interesting case is not a mislabelled holiday
      // photo -- it is content pretending to be an image.
      throw Errors.badRequest("That file's contents do not match its type", "attachment_mismatch");
    }

    const kind = IMAGE_TYPES.has(declared) ? "image" : "document";

    // The session id is a claim, not a fact. The composer sends whatever it
    // is currently attached to -- which may be a browser-generated id from
    // before the visitor signed in, a conversation that has since been
    // deleted, or somebody else's. An unowned one is dropped rather than
    // refused: the file is still perfectly usable, and it gets claimed for the
    // right conversation when the message is actually sent.
    const ownedSession = sessionId && db.aiSessions.getOwned(sessionId, userId) ? sessionId : null;

    // The filename is generated here and never taken from the client. The
    // client's name is kept separately, for display only, so `../../etc/passwd`
    // can reach a label but never a path.
    const safeName = `${Date.now()}-${newId("aiatt").slice(6, 14)}${EXT[declared] || ""}`;
    const dir = path.resolve(config.uploadDir, "ai");
    const storagePath = path.join(dir, safeName);
    if (!storagePath.startsWith(dir + path.sep)) {
      throw Errors.internal("Refusing to write outside the upload directory", "unsafe_path");
    }

    await mkdir(dir, { recursive: true });
    await writeFile(storagePath, bytes);

    let extractedText = null;
    if (declared === "application/pdf") {
      try {
        extractedText = extractPdfText(bytes) || null;
      } catch {
        extractedText = null;
      }
    } else if (declared === "text/plain" || declared === "text/csv") {
      extractedText = new TextDecoder().decode(bytes).slice(0, 8000);
    }

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    let row;
    try {
      row = db.aiAttachments.create({
        userId,
        sessionId: ownedSession,
        kind,
        mime: declared,
        byteSize: bytes.length,
        filename: safeName,
        originalName: String(filename || "").slice(0, 200) || null,
        storagePath,
        sha256,
        extractedText,
      });
    } catch (err) {
      // The bytes are already on disk. Without this, a row that fails to
      // insert leaves a file nothing points at and nothing will ever clean up.
      await unlink(storagePath).catch(() => {});
      throw err;
    }

    return {
      id: row.id,
      kind: row.kind,
      mime: row.mime,
      byte_size: row.byte_size,
      filename: row.original_name || row.filename,
      // Documents say up front whether anything was readable, so the composer
      // can warn before the visitor asks a question the model cannot answer.
      has_text: Boolean(extractedText),
      preview_url: `/ai/attachments/${row.id}`,
    };
  },

  /** Raw bytes, for the owner or for staff reading a transcript. */
  async read(id, { userId, canReadAll = false }) {
    const row = canReadAll ? db.aiAttachments.get(id) : db.aiAttachments.getOwned(id, userId);
    // Not found rather than forbidden: a 403 would confirm the id exists.
    if (!row) throw Errors.notFound("Attachment not found");
    try {
      const bytes = await readFile(row.storage_path);
      return { bytes, mime: row.mime, filename: row.original_name || row.filename };
    } catch {
      throw Errors.notFound("That file is no longer available", "attachment_missing");
    }
  },

  /**
   * Deletes the files behind rows that have already gone.
   *
   * The database rows cascade when a conversation is deleted; the bytes on
   * disk do not, and a visitor who deletes a conversation means the invoice
   * they put in it as well. Best effort and never awaited by the caller: a
   * file that is already gone is the outcome we wanted anyway.
   */
  async removeFiles(rows = []) {
    for (const row of rows) {
      if (!row?.storage_path) continue;
      await unlink(row.storage_path).catch(() => {});
    }
  },

  /** Claims uploads for a conversation once the message they belong to is sent. */
  attachToSession(ids, sessionId, userId) {
    const rows = [];
    for (const id of (ids || []).slice(0, MAX_PER_MESSAGE)) {
      const row = db.aiAttachments.getOwned(id, userId);
      if (!row) continue;
      rows.push(sessionId ? db.aiAttachments.attachToSession(id, sessionId) : row);
    }
    return rows;
  },

  /**
   * Turns attachments into OpenAI-style content parts.
   *
   * Images are inlined as data URLs rather than as https links: a link would
   * force the provider to fetch it, which would mean either making the
   * endpoint public (no) or building a signed-URL scheme (unnecessary).
   *
   * Documents are NOT image parts. Their extracted text goes in as text, and a
   * document with nothing extractable says so -- so the model can ask for a
   * photo instead of inventing a total.
   */
  async buildParts(rows) {
    const parts = [];
    for (const row of rows) {
      if (row.kind === "image") {
        try {
          const bytes = await readFile(row.storage_path);
          parts.push({
            type: "image_url",
            image_url: { url: `data:${row.mime};base64,${Buffer.from(bytes).toString("base64")}` },
          });
        } catch {
          parts.push({ type: "text", text: `[attachment ${row.original_name || row.filename} is no longer available]` });
        }
      } else if (row.extracted_text) {
        parts.push({
          type: "text",
          text: `[attachment: ${row.original_name || row.filename}]\n${row.extracted_text}`,
        });
      } else {
        parts.push({
          type: "text",
          text:
            `[attachment: ${row.original_name || row.filename} — no extractable text. ` +
            `If this is a scan or a photograph of a document, ask the visitor to send it as an image instead.]`,
        });
      }
    }
    return parts;
  },
};
