/**
 * fuzzyRank — small, deterministic ranker for command-palette items.
 *
 * Powers the SlashPalette typeahead. Not a general-purpose fuzzy
 * matcher: the scoring is tuned for short, slash-prefixed command
 * tokens where users either type the literal prefix (`/dia` → `/diagnostics`)
 * or a memorable subsequence (`/dh` → `/dashboard`).
 *
 * Scoring tiers (highest beats lowest):
 *   • Exact prefix match → 100 (plus a small ranks-shorter-first bonus
 *     so `/diff` beats `/diagnostics` for `/di` — both are prefix
 *     matches, but the shorter command is the closer fit).
 *   • Contiguous substring → 80 − offset (earlier match wins).
 *   • Fuzzy subsequence → 50 − gaps (fewer gaps = tighter match).
 *   • Otherwise → −Infinity, filtered out.
 *
 * Keywords contribute via the same scoring on each keyword string and
 * the best score across (label, keywords) wins for that item.
 *
 * Stable order: items with equal scores preserve their input order so
 * the palette doesn't reshuffle visually when scores tie.
 */

export interface FuzzyRankItem {
  /** Stable id used by the caller to dispatch the selected item. */
  id: string;
  /** Human-readable label that the user sees and types against. */
  label: string;
  /** Optional alternative search terms (synonyms, aliases). */
  keywords?: string[];
}

interface ScoredItem<T> {
  item: T;
  score: number;
  /** Input position — used as a tiebreaker so equal scores stay stable. */
  inputIndex: number;
}

/**
 * Score a single candidate string against a query. Returns the score
 * for the best matching tier, or `-Infinity` when no tier matches.
 *
 * Both `query` and `candidate` are lowercased by the caller.
 */
function scoreCandidate(query: string, candidate: string): number {
  if (query.length === 0) return 0;
  if (candidate.length === 0) return -Infinity;

  // Tier 1 — exact prefix. The shorter the candidate, the closer the
  // fit (so `/diff` (5 chars) beats `/diagnostics` (12 chars) for
  // query `/di`). The bonus is intentionally tiny so it can't push a
  // prefix score below a substring score.
  if (candidate.startsWith(query)) {
    return 100 + Math.max(0, 20 - (candidate.length - query.length));
  }

  // Tier 2 — contiguous substring. Earlier offset = tighter match.
  const subIdx = candidate.indexOf(query);
  if (subIdx !== -1) {
    return 80 - subIdx;
  }

  // Tier 3 — fuzzy subsequence. Walk both strings, counting matched
  // characters and the gap size between consecutive matches.
  let qi = 0;
  let lastMatch = -1;
  let gaps = 0;
  for (let ci = 0; ci < candidate.length && qi < query.length; ci++) {
    if (candidate[ci] === query[qi]) {
      if (lastMatch !== -1) {
        gaps += ci - lastMatch - 1;
      }
      lastMatch = ci;
      qi++;
    }
  }
  if (qi === query.length) {
    return 50 - gaps;
  }

  return -Infinity;
}

/**
 * Best score across (label, keywords). Picks the strongest tier any
 * candidate string achieves; keywords are not penalised relative to
 * the label so `/snake` matches a `game` keyword as well as it would
 * match a substring of the label.
 */
function bestScoreForItem(query: string, item: FuzzyRankItem): number {
  const q = query.toLowerCase();
  let best = scoreCandidate(q, item.label.toLowerCase());
  if (item.keywords) {
    for (const kw of item.keywords) {
      const s = scoreCandidate(q, kw.toLowerCase());
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * Rank `items` by descending fuzzy-match score against `query`.
 *
 * Empty / whitespace-only query → returns `items` unchanged (original
 * order). Items with no matching tier are filtered out.
 */
export function fuzzyRank<T extends FuzzyRankItem>(
  query: string,
  items: T[],
): T[] {
  const q = query.trim();
  if (q.length === 0) return items.slice();

  const scored: ScoredItem<T>[] = items.map((item, inputIndex) => ({
    item,
    score: bestScoreForItem(q, item),
    inputIndex,
  }));

  return scored
    .filter((s) => s.score > -Infinity)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable: preserve input order for equal scores.
      return a.inputIndex - b.inputIndex;
    })
    .map((s) => s.item);
}
