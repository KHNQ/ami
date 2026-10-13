// A very small PDF writer: enough for a one-page proforma, and nothing else.
//
// The counterpart to lib/pdfText.js, and written for the same reason -- this
// repo ships one production dependency and a PDF library would be the second,
// for a document that is a title, a table and a total.
//
// What it does NOT do, deliberately: embedded fonts (the 14 PDF base fonts
// are enough and need no font program), images, wrapping beyond the helper
// below, or any character outside WinAnsi. A Persian-script invoice would
// need a real typesetter and should be an HTML page the browser prints.

const ESCAPES = { "\\": "\\\\", "(": "\\(", ")": "\\)" };

/** PDF strings are parenthesised, so three characters have to be escaped. */
function pdfString(text) {
  return String(text ?? "").replace(/[\\()]/g, (c) => ESCAPES[c]);
}

/**
 * Latin-1, because that is what the base fonts can actually draw.
 *
 * Anything outside it is transliterated where there is an obvious equivalent
 * and dropped otherwise -- a box glyph in the middle of a price is worse than
 * a missing accent.
 */
function toWinAnsi(text) {
  return String(text ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

const FONTS = { regular: "F1", bold: "F2" };

/**
 * A page of text, built by pushing lines onto it.
 *
 * Positioning is absolute in PDF points from the bottom-left, which is how
 * the format thinks; `cursor` tracks the top-down position most people think
 * in and converts on the way out.
 */
export function createPdf({ title = "Document", width = 595.28, height = 841.89 } = {}) {
  const ops = [];
  let cursor = height - 56; // 20mm top margin

  const api = {
    get y() {
      return cursor;
    },

    /** Moves down the page without drawing anything. */
    space(points = 12) {
      cursor -= points;
      return api;
    },

    text(value, { x = 56, size = 10, font = "regular", color = [0, 0, 0], y } = {}) {
      const at = y ?? cursor;
      ops.push(
        `BT /${FONTS[font] || FONTS.regular} ${size} Tf ` +
          `${color.join(" ")} rg ` +
          `1 0 0 1 ${x.toFixed(2)} ${at.toFixed(2)} Tm ` +
          `(${pdfString(toWinAnsi(value))}) Tj ET`
      );
      if (y === undefined) cursor -= size * 1.45;
      return api;
    },

    /** Right-aligned, by measuring the string against the font's average width. */
    textRight(value, { x = 539, size = 10, font = "regular", color = [0, 0, 0], y } = {}) {
      const clean = toWinAnsi(value);
      // 0.5em is the right average for Helvetica digits and mixed case; this
      // is an invoice column, not justified body text, so it is close enough
      // and costs no font metrics table.
      const estimated = clean.length * size * 0.5;
      return api.text(value, { x: x - estimated, size, font, color, y });
    },

    rule({ y, from = 56, to = 539, width: w = 0.5, color = [0.8, 0.8, 0.8] } = {}) {
      const at = y ?? cursor;
      ops.push(
        `${color.join(" ")} RG ${w} w ${from} ${at.toFixed(2)} m ${to} ${at.toFixed(2)} l S`
      );
      if (y === undefined) cursor -= 10;
      return api;
    },

    box({ y, from = 56, to = 539, height: h = 20, color = [0.96, 0.96, 0.96] } = {}) {
      const at = (y ?? cursor) - h + 14;
      ops.push(`${color.join(" ")} rg ${from} ${at.toFixed(2)} ${to - from} ${h} re f`);
      return api;
    },

    /** Breaks a paragraph at the column width and draws it line by line. */
    paragraph(value, { x = 56, size = 9, chars = 95, color = [0.35, 0.35, 0.35] } = {}) {
      let line = "";
      for (const word of toWinAnsi(value).split(/\s+/)) {
        if ((line + " " + word).trim().length > chars) {
          api.text(line, { x, size, color });
          line = word;
        } else {
          line = (line ? `${line} ` : "") + word;
        }
      }
      if (line) api.text(line, { x, size, color });
      return api;
    },

    /** Serialises the whole file. Returns the bytes, ready to send. */
    build() {
      const content = ops.join("\n");
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] ` +
          `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
        null, // the content stream, assembled below
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        `<< /Title (${pdfString(toWinAnsi(title))}) /Producer (Ashkan Medical) >>`,
      ];

      const chunks = [];
      const offsets = [];
      let length = 0;
      const push = (str) => {
        const bytes = Buffer.from(str, "latin1");
        chunks.push(bytes);
        length += bytes.length;
      };

      push("%PDF-1.4\n");
      objects.forEach((body, i) => {
        offsets[i + 1] = length;
        if (body === null) {
          push(`${i + 1} 0 obj\n<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n`);
          push(content);
          push("\nendstream\nendobj\n");
        } else {
          push(`${i + 1} 0 obj\n${body}\nendobj\n`);
        }
      });

      // The cross-reference table has to carry the byte offset of every
      // object, which is why the whole file is assembled before it is written.
      const xrefAt = length;
      let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= objects.length; i++) {
        xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
      }
      push(xref);
      push(
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
          `startxref\n${xrefAt}\n%%EOF`
      );

      return Buffer.concat(chunks);
    },
  };

  return api;
}
