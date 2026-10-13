// A small in-process BM25 index.
//
// Deliberately not a vector database. The corpus here is the whole company:
// 13 products, 7 categories, 11 partners and a handful of pages -- roughly a
// hundred short documents. At that size embeddings would mean an API call per
// chunk to build, a service (or a file) to store them in, and a cold-start
// cost, all to beat keyword search on a catalogue whose queries are
// overwhelmingly *literal*: people ask for "InBody", "tattoo removal",
// "1470nm", "CO2 laser". Those are exact-token matches, which is precisely
// where BM25 is strongest and dense retrieval is weakest.
//
// BM25 over stemmed tokens, scored as:
//
//   score(q, d) = Σ  IDF(t) · f(t,d)·(k1+1) / ( f(t,d) + k1·(1 - b + b·|d|/avgdl) )
//                t∈q
//
// k1 controls how fast term frequency saturates; b how much long documents
// are penalised. The defaults (1.2 / 0.75) are the standard ones and are not
// worth tuning against a corpus this small.

const K1 = 1.2;
const B = 0.75;

// Words carrying no retrieval signal. Kept short on purpose -- an aggressive
// stop list hurts a corpus this small, where "body" in "body analysis" or
// "removal" in "hair removal" are the whole query.
const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "has", "have", "how", "i", "in", "is", "it", "its", "me",
  "my", "of", "on", "or", "our", "so", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "to", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

/**
 * Very light suffix stripping, so "lasers" matches "laser" and "treatments"
 * matches "treatment".
 *
 * Not a real stemmer (no Porter, no dependency): those over-stem product
 * names badly -- Porter turns "Angela" into "angela" fine but mangles enough
 * medical vocabulary that the cure is worse than the disease. This only
 * removes the plural/possessive endings that actually cause misses here, and
 * refuses to shorten anything below four characters so "ipl" and "ent"
 * survive intact.
 */
export function stem(word) {
  if (word.length < 5) return word;
  if (word.endsWith("ies") && word.length > 5) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Text -> scoreable tokens.
 *
 * Keeps digits attached to their unit, because "1470nm" and "308nm" are how
 * this catalogue is actually searched, and splitting them into "1470" + "nm"
 * would make every wavelength query match every other wavelength.
 */
export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    // Keep letters, digits and the hyphen inside compound names; everything
    // else is a separator. \p{L} rather than a-z so Persian and Arabic
    // product copy tokenizes rather than vanishing.
    .split(/[^\p{L}\p{N}-]+/u)
    .flatMap((raw) => {
      const t = raw.replace(/^-+|-+$/g, "");
      if (!t) return [];
      // Index a hyphenated compound both whole and in parts, so
      // "tattoo-removal" answers "tattoo" and "removal" too.
      if (t.includes("-")) return [t, ...t.split("-").filter(Boolean)];
      return [t];
    })
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

/**
 * Builds an index over `[{ id, text, ...meta }]`.
 *
 * Documents keep whatever extra fields they carry; `search` hands the whole
 * object back so callers can read `kind`, `slug` etc. without a second lookup.
 */
export function buildIndex(documents) {
  const docs = documents.map((doc) => {
    const tokens = tokenize(doc.text);
    const freq = new Map();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
    return { doc, freq, length: tokens.length };
  });

  const totalLength = docs.reduce((sum, d) => sum + d.length, 0);
  const avgLength = docs.length > 0 ? totalLength / docs.length : 0;

  // How many documents contain each term -- the denominator of IDF.
  const docFreq = new Map();
  for (const d of docs) {
    for (const term of d.freq.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }

  const N = docs.length;

  // Standard BM25 IDF with the +0.5 smoothing. A term in *every* document
  // scores near zero (correctly: it separates nothing), and the max(…, small
  // positive) floor stops it going negative, which would otherwise let a
  // ubiquitous term actively push a document down the ranking.
  function idf(term) {
    const n = docFreq.get(term) || 0;
    return Math.max(1e-6, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  return {
    size: N,
    /** Top-k documents for a natural-language query. */
    search(query, { limit = 6, minScore = 0.1 } = {}) {
      const terms = tokenize(query);
      if (terms.length === 0) return [];

      const scored = [];
      for (const d of docs) {
        let score = 0;
        for (const term of terms) {
          const f = d.freq.get(term);
          if (!f) continue;
          const norm = 1 - B + (B * d.length) / (avgLength || 1);
          score += idf(term) * ((f * (K1 + 1)) / (f + K1 * norm));
        }
        if (score > minScore) scored.push({ score, ...d.doc });
      }

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    _debug: { docFreq, avgLength },
  };
}
