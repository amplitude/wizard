/**
 * Unit tests for the rubric scorers in
 * `evals/model-quality/lib/scorers.mjs`. The scorers are pure
 * functions; these tests exercise them with synthetic inputs.
 *
 * The judge LLM is mocked at the parsing boundary
 * (`parseJudgeVerdict`) — we never spin up a real model in unit tests.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs import path; vitest resolves via Node ESM loader.
import {
  scoreStructural,
  buildJudgePrompt,
  parseJudgeVerdict,
  summariseResults,
  resolveModelAlias,
  gatewayModelString,
  MODEL_ALIASES,
} from '../lib/scorers.mjs';

describe('scoreStructural', () => {
  it('passes when all checks pass', () => {
    const r = scoreStructural(
      'You can call amplitude.track("Sign Up Clicked").',
      {
        minLength: 10,
        maxLength: 200,
        expectKeywords: ['amplitude', 'track'],
        expectKeywordsAnyOf: ['Sign Up', 'sign up'],
        forbiddenKeywords: ['I cannot help'],
        expectJson: false,
      },
    );
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('flags short outputs', () => {
    const r = scoreStructural('hi', {
      minLength: 10,
      forbiddenKeywords: [],
      expectKeywords: [],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/below minLength/);
  });

  it('flags refusals via forbiddenKeywords', () => {
    const r = scoreStructural('I cannot help with that request.', {
      minLength: 0,
      forbiddenKeywords: ['I cannot help'],
      expectKeywords: [],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/forbidden keyword present/);
  });

  it('flags missing required keywords', () => {
    const r = scoreStructural('A short answer.', {
      minLength: 0,
      expectKeywords: ['amplitude', 'track'],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/missing required keywords/);
  });

  it('honours expectKeywordsAnyOf as an OR', () => {
    const r = scoreStructural('You should consider Next.js for SSR.', {
      minLength: 0,
      expectKeywords: [],
      expectKeywordsAnyOf: ['nextjs', 'Next.js', 'next.js'],
    });
    expect(r.pass).toBe(true);
  });

  it('fails expectKeywordsAnyOf when none match', () => {
    const r = scoreStructural('Generic answer about routing.', {
      minLength: 0,
      expectKeywords: [],
      expectKeywordsAnyOf: ['nextjs', 'react-router'],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/none of expectKeywordsAnyOf/);
  });

  it('passes expectJson on plain JSON', () => {
    const r = scoreStructural('{"events":[{"name":"Page Viewed"}]}', {
      minLength: 0,
      expectKeywords: [],
      expectJson: true,
    });
    expect(r.pass).toBe(true);
    expect(r.details.jsonParsed).toBe(true);
  });

  it('passes expectJson on fenced JSON', () => {
    const r = scoreStructural('```json\n{"a":1}\n```', {
      minLength: 0,
      expectKeywords: [],
      expectJson: true,
    });
    expect(r.pass).toBe(true);
  });

  it('fails expectJson on prose', () => {
    const r = scoreStructural('Here is a list of events:', {
      minLength: 0,
      expectKeywords: [],
      expectJson: true,
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/JSON.parse failed/);
  });

  it('flags missing jsonRequiredKeys', () => {
    const r = scoreStructural('{"a":1}', {
      minLength: 0,
      expectKeywords: [],
      expectJson: true,
      jsonRequiredKeys: ['name', 'properties'],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/json missing required keys/);
  });
});

describe('buildJudgePrompt + parseJudgeVerdict', () => {
  it('builds a prompt that mentions both A and B', () => {
    const p = buildJudgePrompt({
      userMessage: 'how do I track?',
      outputA: 'use amplitude.track(...)',
      outputB: 'call track on the SDK',
    });
    expect(p).toContain('USER QUESTION');
    expect(p).toContain('ANSWER A');
    expect(p).toContain('ANSWER B');
    expect(p).toContain('how do I track?');
  });

  it('parses a clean JSON verdict', () => {
    const v = parseJudgeVerdict(
      '{"scoreA":4,"scoreB":3,"winner":"A","reason":"more complete"}',
    );
    expect(v.scoreA).toBe(4);
    expect(v.scoreB).toBe(3);
    expect(v.winner).toBe('a');
    expect(v.reason).toMatch(/complete/);
  });

  it('parses a fenced JSON verdict', () => {
    const v = parseJudgeVerdict(
      '```json\n{"scoreA":5,"scoreB":5,"winner":"tie","reason":"both fine"}\n```',
    );
    expect(v.winner).toBe('tie');
  });

  it('parses verdict embedded in prose', () => {
    const v = parseJudgeVerdict(
      'Here is my judgement: {"scoreA":2,"scoreB":4,"winner":"B","reason":"B more accurate"} done.',
    );
    expect(v.scoreA).toBe(2);
    expect(v.winner).toBe('b');
  });

  it('rejects out-of-range scores', () => {
    expect(() =>
      parseJudgeVerdict('{"scoreA":0,"scoreB":3,"winner":"B"}'),
    ).toThrow(/scoreA out of range/);
    expect(() =>
      parseJudgeVerdict('{"scoreA":3,"scoreB":7,"winner":"B"}'),
    ).toThrow(/scoreB out of range/);
  });

  it('rejects unknown winner', () => {
    expect(() =>
      parseJudgeVerdict('{"scoreA":3,"scoreB":3,"winner":"both"}'),
    ).toThrow(/winner not A\|B\|tie/);
  });

  it('rejects empty input', () => {
    expect(() => parseJudgeVerdict('')).toThrow(/empty/);
  });
});

describe('summariseResults', () => {
  function row(model: 'haiku' | 'sonnet', pass: boolean, judgeScore?: number) {
    return {
      model,
      promptId: 'p',
      structural: { pass, failures: pass ? [] : ['fail'] },
      ...(judgeScore !== undefined ? { judge: { score: judgeScore } } : {}),
    };
  }

  it('recommends keep-haiku on clean structural + median judge >= 4', () => {
    const s = summariseResults([
      row('haiku', true, 4),
      row('haiku', true, 5),
      row('haiku', true, 4),
      row('sonnet', true, 4),
      row('sonnet', true, 5),
      row('sonnet', true, 4),
    ]);
    expect(s.recommendation).toBe('keep-haiku');
    expect(s.haikuMedianJudgeScore).toBe(4);
    expect(s.sonnetMedianJudgeScore).toBe(4);
  });

  it('recommends revert-to-sonnet on any haiku structural failure', () => {
    const s = summariseResults([
      row('haiku', true, 5),
      row('haiku', false, 5),
      row('sonnet', true, 5),
    ]);
    expect(s.recommendation).toBe('revert-to-sonnet');
    expect(s.reasons[0]).toMatch(/structural failures/);
  });

  it('recommends revert-to-sonnet when haiku median judge < 4', () => {
    const s = summariseResults([
      row('haiku', true, 3),
      row('haiku', true, 3),
      row('haiku', true, 4),
      row('sonnet', true, 5),
    ]);
    expect(s.recommendation).toBe('revert-to-sonnet');
    expect(s.reasons[0]).toMatch(/below threshold/);
  });

  it('recommends keep-haiku when judge skipped (binary fixture) and structural clean', () => {
    const s = summariseResults([row('haiku', true), row('sonnet', true)]);
    expect(s.recommendation).toBe('keep-haiku');
    expect(s.reasons[0]).toMatch(/judge skipped/);
  });

  it('returns inconclusive when haiku has no rows', () => {
    const s = summariseResults([row('sonnet', true, 5)]);
    expect(s.recommendation).toBe('inconclusive');
  });

  it('ignores rows tagged structural.skipped (runner errors do not trigger revert)', () => {
    // Regression: a transient API/network error during the haiku phase
    // produced an empty `row.text`, which `scoreStructural` counted as
    // a structural failure (any fixture with `minLength > 0` fails on
    // empty text). Since `summariseResults` triggers `revert-to-sonnet`
    // on ANY `haikuStructuralFail > 0`, a single transient blip would
    // flip the recommendation. `score-quality.mjs` now tags errored
    // rows `structural: { skipped: true }`, and the summariser must
    // skip them so infrastructure issues don't masquerade as model
    // quality failures.
    const erroredHaiku = {
      model: 'haiku' as const,
      promptId: 'p',
      structural: { skipped: true, reason: 'runner error' },
    };
    const s = summariseResults([
      erroredHaiku,
      row('haiku', true, 5),
      row('haiku', true, 5),
      row('sonnet', true, 5),
      row('sonnet', true, 5),
    ]);
    expect(s.haikuStructuralFail).toBe(0);
    expect(s.haikuStructuralPass).toBe(2);
    expect(s.recommendation).toBe('keep-haiku');
  });
});

describe('model alias resolution', () => {
  it('resolves haiku to the pinned alias by default', () => {
    const before = process.env.WIZARD_HAIKU_MODEL;
    delete process.env.WIZARD_HAIKU_MODEL;
    try {
      expect(resolveModelAlias('haiku')).toBe(MODEL_ALIASES.haiku);
    } finally {
      if (before !== undefined) process.env.WIZARD_HAIKU_MODEL = before;
    }
  });

  it('honours WIZARD_HAIKU_MODEL override', () => {
    const before = process.env.WIZARD_HAIKU_MODEL;
    process.env.WIZARD_HAIKU_MODEL = 'claude-haiku-test';
    try {
      expect(resolveModelAlias('haiku')).toBe('claude-haiku-test');
    } finally {
      if (before === undefined) delete process.env.WIZARD_HAIKU_MODEL;
      else process.env.WIZARD_HAIKU_MODEL = before;
    }
  });

  it('resolves sonnet to claude-sonnet-4-6 by default', () => {
    const before = process.env.WIZARD_CLAUDE_MODEL;
    delete process.env.WIZARD_CLAUDE_MODEL;
    try {
      expect(resolveModelAlias('sonnet')).toBe(MODEL_ALIASES.sonnet);
    } finally {
      if (before !== undefined) process.env.WIZARD_CLAUDE_MODEL = before;
    }
  });

  it('throws on unknown role', () => {
    expect(() => resolveModelAlias('mystery' as never)).toThrow(
      /unknown model role/,
    );
  });

  it('prefixes with anthropic/ on the gateway path', () => {
    expect(gatewayModelString('claude-haiku-4-5', false)).toBe(
      'anthropic/claude-haiku-4-5',
    );
    expect(gatewayModelString('claude-haiku-4-5', true)).toBe(
      'claude-haiku-4-5',
    );
  });
});
