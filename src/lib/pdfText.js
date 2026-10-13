// Enough PDF to read an invoice.
//
// There is no PDF parser in this repo and adding one would be out of
// character -- the app ships a single production dependency. What this feature
// actually needs is the text out of machine-generated proformas and invoices,
// which is a small, well-behaved subset of the format: a handful of content
// streams, usually Flate-compressed, containing `Tj` and `TJ` text operators.
//
// What it deliberately does NOT do: fonts, encodings beyond WinAnsi-ish,
// layout reconstruction, or scanned images. A scan has no text objects at all,
// and OCR is a different project. When extraction finds nothing the caller is
// told so explicitly, and the visitor is asked to send a photo instead -- the
// multimodal path handles those natively.

/** PDF string escapes, per the spec's table 3. */
function unescapePdfString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "\n") continue; // line continuation
    else if (next >= "0" && next <= "7") {
      // Up to three octal digits.
      let oct = next;
      while (oct.length < 3 && raw[i + 1] >= "0" && raw[i + 1] <= "7") oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += next;
  }
  return out;
}

/**
 * Pulls the text operators out of one decoded content stream.
 *
 * `(text) Tj` and `[(a) -250 (b)] TJ` are the two that carry visible strings.
 * The numbers inside a TJ array are kerning adjustments; a large negative one
 * is how most generators represent a space, so they are worth reading rather
 * than discarding.
 */
function textFromStream(content) {
  const out = [];
  // Matches a parenthesised string, tolerating escaped parens inside it.
  const stringRe = /\((?:\\.|[^\\()])*\)/gs;
  const opRe = /((?:\((?:\\.|[^\\()])*\)|\[[^\]]*\]))\s*(Tj|TJ)|\bT\*|\bET\b/gs;

  let m;
  while ((m = opRe.exec(content)) !== null) {
    if (!m[1]) {
      // T* (next line) and ET (end text) both end a run.
      out.push("\n");
      continue;
    }
    const operand = m[1];
    const op = m[2];

    if (op === "Tj") {
      out.push(unescapePdfString(operand.slice(1, -1)));
    } else if (op === "TJ") {
      let piece = "";
      let last = 0;
      let sm;
      const inner = operand.slice(1, -1);
      stringRe.lastIndex = 0;
      while ((sm = stringRe.exec(inner)) !== null) {
        // The kerning between this string and the previous one. Below about
        // -100 thousandths of an em, a generator means a word break.
        const between = inner.slice(last, sm.index);
        const kern = parseFloat(between.match(/-?\d+(\.\d+)?/)?.[0] ?? "0");
        if (kern <= -100) piece += " ";
        piece += unescapePdfString(sm[0].slice(1, -1));
        last = sm.index + sm[0].length;
      }
      out.push(piece);
    }
  }
  return out.join("");
}

/**
 * Extracts readable text from a PDF buffer.
 *
 * Returns "" rather than throwing for anything it cannot read -- an encrypted
 * file, a scan, an object-stream-heavy PDF from a modern generator. The caller
 * distinguishes "no text" from "failed" by the empty result, and says so.
 */
export function extractPdfText(buffer, { maxChars = 8000 } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // latin1 keeps byte values intact through the string operations below, which
  // matters because a Flate stream is binary sitting inside the same file.
  const raw = new TextDecoder("latin1").decode(bytes);

  const pieces = [];
  // `stream` ... `endstream`, with the preceding dictionary so the filter is
  // visible.
  const streamRe = /<<([^>]*(?:>(?!>)[^>]*)*)>>\s*stream\r?\n/g;
  let m;

  while ((m = streamRe.exec(raw)) !== null && pieces.join("").length < maxChars * 3) {
    const dict = m[1];
    const start = streamRe.lastIndex;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;

    const slice = bytes.subarray(start, end);
    let content = null;

    if (/\/FlateDecode/.test(dict)) {
      try {
        content = new TextDecoder("latin1").decode(Bun.inflateSync(slice));
      } catch {
        // Not every Flate stream is a content stream -- images and fonts live
        // here too, and some simply will not inflate standalone.
        content = null;
      }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)/.test(dict)) {
      content = new TextDecoder("latin1").decode(slice);
    }

    if (!content) continue;
    // A content stream has text operators; an image or font stream does not.
    if (!/\b(Tj|TJ)\b/.test(content)) continue;
    pieces.push(textFromStream(content));
  }

  const text = pieces
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
