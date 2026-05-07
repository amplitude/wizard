/**
 * Pure scoring helpers for the Haiku-vs-Sonnet quality A/B harness.
 *
 * This module is deliberately side-effect free: the runner and the
 * judge both import these functions, and the unit tests under
 * `__tests__/` exercise them directly with synthetic inputs. No
 * network, no fs, no env reads.
 *
 * Rubric version is pinned in each fixture (`rubricVersion`); when the
 * rubric changes meaningfully (new structural check, judge prompt
 * rewording, threshold change) bump the version so old result files
 * stay comparable to themselves and not silently mixed with new ones.
 */

/**
 * Run the structural (deterministic) scorers against a single output.
 *
 * @param {string} output            The model's full text response.
 * @param {object} checks            The fixture's `structuralChecks` block.
 * @returns {{ pass: boolean, failures: string[], details: object }}
 */
export function scoreStructural(output, checks) {
  const failures = [];
  const details = {};
  const text = output ?? '';
  const lower = text.toLowerCase();

  details.length = text.length;
  if (typeof checks.minLength === 'number' && text.length < checks.minLength) {
    failures.push(
      `length ${text.length} below minLength ${checks.minLength}`,
    );
  }
  if (typeof checks.maxLength === 'number' && text.length > checks.maxLength) {
    failures.push(
      `length ${text.length} above maxLength ${checks.maxLength}`,
    );
  }

  // Refusal / "I cannot help" detection. Substrings checked
  // case-insensitively. Hitting any of these is a hard structural
  // failure — these strings indicate the model bailed out instead of
  // attempting an answer.
  const forbidden = checks.forbiddenKeywords ?? [];
  const forbiddenHits = forbidden.filter((k) =>
    lower.includes(String(k).toLowerCase()),
  );
  if (forbiddenHits.length > 0) {
    failures.push(`forbidden keyword present: ${forbiddenHits.join(', ')}`);
  }
  details.forbiddenHits = forbiddenHits;

  // All-of keywords (every entry must appear).
  const required = checks.expectKeywords ?? [];
  const missingRequired = required.filter(
    (k) => !lower.includes(String(k).toLowerCase()),
  );
  if (missingRequired.length > 0) {
    failures.push(
      `missing required keywords: ${missingRequired.join(', ')}`,
    );
  }
  details.missingRequired = missingRequired;

  // Any-of keywords (at least one must appear).
  const anyOf = checks.expectKeywordsAnyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const matched = anyOf.some((k) =>
      lower.includes(String(k).toLowerCase()),
    );
    if (!matched) {
      failures.push(
        `none of expectKeywordsAnyOf matched: ${anyOf.join(', ')}`,
      );
    }
    details.anyOfMatched = matched;
  }

  // JSON output check. Strips a single ```json ...``` fence if present
  // before parsing — generous so models that ignore "no code fences"
  // still pass when the JSON itself is well-formed.
  if (checks.expectJson) {
    const stripped = stripCodeFence(text).trim();
    let parsed;
    try {
      parsed = JSON.parse(stripped);
      details.jsonParsed = true;
    } catch (err) {
      failures.push(`expectJson set but JSON.parse failed: ${err.message}`);
      details.jsonParsed = false;
    }
    if (parsed && Array.isArray(checks.jsonRequiredKeys)) {
      const missing = checks.jsonRequiredKeys.filter(
        (k) => !hasKey(parsed, k),
      );
      if (missing.length > 0) {
        failures.push(`json missing required keys: ${missing.join(', ')}`);
      }
      details.missingJsonKeys = missing;
    }
  }

  return { pass: failures.length === 0, failures, details };
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
  const m = trimmed.match(fence);
  return m ? m[1] : trimmed;
}

function hasKey(obj, key) {
  if (obj === null || typeof obj !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  if (Array.isArray(obj)) {
    return obj.some((item) => hasKey(item, key));
  }
  for (const v of Object.values(obj)) {
    if (hasKey(v, key)) return true;
  }
  return false;
}

/**
 * Build the LLM-judge prompt. A and B are anonymised to defeat
 * positional bias — the runner picks which order to feed them in and
 * records the mapping.
 */
export function buildJudgePrompt({ userMessage, outputA, outputB }) {
  return [
    'You are grading two AI assistant answers to the same user question.',
    'Both A and B answered the same prompt. Rate each on a 1-5 scale on a',
    'combined axis of accuracy, helpfulness, and completeness, where:',
    '  1 = wrong, refused, or off-topic',
    '  2 = partially correct but key info missing or misleading',
    '  3 = mostly correct, usable answer',
    '  4 = correct, helpful, complete',
    '  5 = correct, helpful, complete, and well-structured',
    '',
    'Then say which is better: "A", "B", or "tie".',
    '',
    'Respond with ONLY a JSON object on a single line, no markdown, no prose:',
    '{"scoreA": <1-5>, "scoreB": <1-5>, "winner": "A"|"B"|"tie", "reason": "<one sentence>"}',
    '',
    `USER QUESTION:\n${userMessage}`,
    '',
    `ANSWER A:\n${outputA}`,
    '',
    `ANSWER B:\n${outputB}`,
  ].join('\n');
}

/**
 * Parse a judge response. Accepts JSON with optional markdown fence.
 * Returns a normalised verdict or throws if the response is not
 * parseable / out of range.
 */
export function parseJudgeVerdict(rawText) {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new Error('judge response was empty');
  }
  const stripped = stripCodeFence(rawText.trim()).trim();
  let obj;
  try {
    obj = JSON.parse(stripped);
  } catch (err) {
    // Fall back: try to find the first {...} block.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error(`judge JSON.parse failed: ${err.message}`);
    }
    obj = JSON.parse(m[0]);
  }

  const scoreA = Number(obj.scoreA);
  const scoreB = Number(obj.scoreB);
  if (!Number.isFinite(scoreA) || scoreA < 1 || scoreA > 5) {
    throw new Error(`judge scoreA out of range: ${obj.scoreA}`);
  }
  if (!Number.isFinite(scoreB) || scoreB < 1 || scoreB > 5) {
    throw new Error(`judge scoreB out of range: ${obj.scoreB}`);
  }
  const winner = String(obj.winner ?? '').toLowerCase();
  if (winner !== 'a' && winner !== 'b' && winner !== 'tie') {
    throw new Error(`judge winner not A|B|tie: ${obj.winner}`);
  }

  return {
    scoreA,
    scoreB,
    winner,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  };
}

/**
 * Aggregate per-fixture results into a decision-ready summary.
 *
 * Decision framework (also documented in the README):
 *   - Haiku KEEP if median Haiku judge score >= 4 AND every Haiku
 *     output passes structural scorers AND no refusals.
 *   - Haiku REVERT otherwise.
 *
 * @param {Array<{
 *   model: 'haiku'|'sonnet',
 *   promptId: string,
 *   structural: { pass: boolean, failures: string[] },
 *   judge?: { score: number },
 * }>} rows
 * @returns {{
 *   haikuStructuralPass: number,
 *   haikuStructuralFail: number,
 *   sonnetStructuralPass: number,
 *   sonnetStructuralFail: number,
 *   haikuMedianJudgeScore: number | null,
 *   sonnetMedianJudgeScore: number | null,
 *   recommendation: 'keep-haiku' | 'revert-to-sonnet' | 'inconclusive',
 *   reasons: string[],
 * }}
 */
export function summariseResults(rows) {
  const summary = {
    haikuStructuralPass: 0,
    haikuStructuralFail: 0,
    sonnetStructuralPass: 0,
    sonnetStructuralFail: 0,
    haikuMedianJudgeScore: null,
    sonnetMedianJudgeScore: null,
    recommendation: 'inconclusive',
    reasons: [],
  };
  const haikuJudge = [];
  const sonnetJudge = [];

  for (const row of rows) {
    const passed = row.structural?.pass === true;
    if (row.model === 'haiku') {
      if (passed) summary.haikuStructuralPass += 1;
      else summary.haikuStructuralFail += 1;
      if (row.judge && Number.isFinite(row.judge.score)) {
        haikuJudge.push(row.judge.score);
      }
    } else if (row.model === 'sonnet') {
      if (passed) summary.sonnetStructuralPass += 1;
      else summary.sonnetStructuralFail += 1;
      if (row.judge && Number.isFinite(row.judge.score)) {
        sonnetJudge.push(row.judge.score);
      }
    }
  }

  summary.haikuMedianJudgeScore = median(haikuJudge);
  summary.sonnetMedianJudgeScore = median(sonnetJudge);

  // Decision logic.
  if (summary.haikuStructuralFail > 0) {
    summary.recommendation = 'revert-to-sonnet';
    summary.reasons.push(
      `Haiku has ${summary.haikuStructuralFail} structural failures`,
    );
    return summary;
  }
  if (
    summary.haikuMedianJudgeScore !== null &&
    summary.haikuMedianJudgeScore < 4
  ) {
    summary.recommendation = 'revert-to-sonnet';
    summary.reasons.push(
      `Haiku median judge score ${summary.haikuMedianJudgeScore} below threshold 4`,
    );
    return summary;
  }
  if (summary.haikuStructuralPass === 0) {
    summary.recommendation = 'inconclusive';
    summary.reasons.push('no Haiku rows scored');
    return summary;
  }
  if (summary.haikuMedianJudgeScore === null) {
    // Structural passed but no judge data — fixture may have skipped
    // the judge (e.g. gateway-probe binary fixture).
    summary.recommendation = 'keep-haiku';
    summary.reasons.push(
      'all structural checks passed; judge skipped (binary fixture)',
    );
    return summary;
  }
  summary.recommendation = 'keep-haiku';
  summary.reasons.push(
    `all structural checks passed; Haiku median judge ${summary.haikuMedianJudgeScore} >= 4`,
  );
  return summary;
}

function median(nums) {
  if (!nums || nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Hardcoded model aliases used by the harness. These mirror the
 * `'oneshot'` and `'standard'` tiers from
 * `src/lib/agent/model-config.ts` (#590), but are pinned directly
 * here so the harness can run regardless of whether that PR has
 * landed on main yet. Override with WIZARD_HAIKU_MODEL / WIZARD_CLAUDE_MODEL
 * env vars to test alternative aliases.
 */
export const MODEL_ALIASES = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
};

export function resolveModelAlias(model) {
  if (model === 'haiku') {
    const override = process.env.WIZARD_HAIKU_MODEL?.trim();
    return override && override.length > 0 ? override : MODEL_ALIASES.haiku;
  }
  if (model === 'sonnet') {
    const override = process.env.WIZARD_CLAUDE_MODEL?.trim();
    return override && override.length > 0 ? override : MODEL_ALIASES.sonnet;
  }
  throw new Error(`unknown model role: ${model}`);
}

/**
 * Build the gateway model string. The Amplitude LLM gateway expects
 * `anthropic/<alias>`; the direct API expects the bare alias. Mirrors
 * `selectModel` in `src/lib/agent/model-config.ts`.
 */
export function gatewayModelString(alias, useDirectApiKey) {
  return useDirectApiKey ? alias : `anthropic/${alias}`;
}
