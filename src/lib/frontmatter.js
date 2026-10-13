// A small, strict front-matter reader for blog posts.
//
// Posts are authored as one Markdown document that may open with a metadata
// block:
//
//   ---
//   title: Our new CO2 laser
//   slug: new-co2-laser
//   excerpt: What changed in the 2025 range.
//   tags: [lasers, news]
//   cover: https://example.com/cover.jpg
//   status: published
//   ---
//   # Body starts here
//
// This is deliberately not a YAML parser. It reads the flat shape above --
// `key: value` lines, quoted or bare scalars, inline `[a, b]` lists and
// `- item` block lists -- and nothing else. A full YAML implementation would
// be a dependency (and an attack surface: aliases, tags, anchors) for an
// editor field that only ever holds half a dozen scalars.

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return v;
}

function scalar(raw) {
  const v = unquote(raw);
  if (raw.trim() !== v) return v; // was quoted -- always a string
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~" || v === "") return null;
  return v;
}

function inlineList(raw) {
  const inner = raw.trim().slice(1, -1);
  if (!inner.trim()) return [];
  // Split on commas that are not inside quotes.
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => unquote(x)).filter((x) => x !== "");
}

/**
 * Splits `source` into { data, body }.
 *
 * `data` is always an object (empty when there is no front matter) and
 * `body` is the document with the metadata block removed. A document that
 * does not open with `---` is returned untouched.
 */
export function parseFrontmatter(source) {
  const text = String(source ?? "").replace(/^﻿/, "");
  const match = FENCE.exec(text);
  if (!match) return { data: {}, body: text };

  const data = {};
  let listKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const item = /^\s+-\s+(.*)$/.exec(line) || /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue; // anything else is ignored rather than guessed at
    const [, key, rawValue] = pair;
    const value = rawValue.trim();
    listKey = null;
    if (value === "") {
      data[key] = [];
      listKey = key; // a block list may follow; an empty one stays []
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = inlineList(value);
    } else {
      data[key] = scalar(value);
    }
  }
  // `key:` with nothing after it and no list is an empty value, not [].
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0 && new RegExp(`^${k}\\s*:\\s*$`, "m").test(match[1])) data[k] = null;
  }

  return { data, body: text.slice(match[0].length).replace(/^\r?\n/, "") };
}

/** The inverse of parseFrontmatter, for loading a stored post back into the editor. */
export function stringifyFrontmatter(data, body = "") {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => quoteIfNeeded(v)).join(", ")}]`);
    } else {
      lines.push(`${key}: ${typeof value === "string" ? quoteIfNeeded(value) : value}`);
    }
  }
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function quoteIfNeeded(value) {
  const v = String(value);
  return /[:#[\],"']|^\s|\s$|^(true|false|null|~)$/.test(v) || v === ""
    ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
    : v;
}
