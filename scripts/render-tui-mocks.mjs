#!/usr/bin/env node
/**
 * render-tui-mocks — turn captured ANSI frames + hand-coded proposed
 * mocks into PNGs via Playwright.
 *
 * Inputs:
 *   - docs/_tui-current-state.json — output from the capture-current-screens
 *     vitest test (ANSI-preserved). One PNG written per entry under
 *     docs/mocks/current/.
 *   - PROPOSED_SCREENS (inline below) — hand-coded redesigned screens with
 *     explicit color spans. One PNG written per entry under
 *     docs/mocks/proposed/.
 *
 * Run:
 *   FORCE_COLOR=3 pnpm exec vitest run \
 *     src/ui/tui/__tests__/capture-current-screens.test.tsx
 *   node scripts/render-tui-mocks.mjs
 *
 * Output: PNGs in docs/mocks/{current,proposed}/.
 */

// Resolve Playwright from the global install (the sandbox provisions it
// at /opt/node22/lib/node_modules) — this script is a one-shot tool, not
// a runtime dep of the wizard itself, so we don't add it to package.json.
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
const { chromium } = requireCjs('/opt/node22/lib/node_modules/playwright');
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── Brand palette (mirrors src/ui/tui/styles.ts) ───────────────────────
const Brand = {
  darkBlue: '#001A4F',
  blue: '#1E61F0',
  blueOnDark: '#4083FF',
  lilac: '#6980FF',
  violet: '#A373FF',
  pink: '#FF7D78',
  amber: '#F59E0B',
  red: '#F23845',
  gray100: '#13171A',
  gray90: '#242A2E',
  gray80: '#373D42',
  gray70: '#50565B',
  gray60: '#697077',
  gray50: '#868D95',
  gray40: '#9FA5AD',
  gray30: '#B9BFC7',
  gray20: '#D5D9E0',
  gray10: '#F2F4F8',
  success: '#34D399',
  white: '#FFFFFF',
};

// ── ANSI 16-color → Brand mapping ──────────────────────────────────────
//
// chalk downgrades hex to 16-color when the destination tty isn't
// truecolor-capable. ink-testing-library's mock stdout falls in that
// bucket. We reverse the downgrade by mapping chalk's 16-color picks
// back to the Brand hex they came from. The result isn't pixel-accurate
// to the actual terminal output (chalk's downgrade is lossy) but it's
// faithful to the design intent — every grey / lilac / blue lands on
// the brand value the screen author chose.
const ANSI_FG = {
  30: Brand.gray100,   // black
  31: Brand.red,
  32: Brand.success,
  33: Brand.amber,
  34: Brand.blue,
  35: Brand.lilac,     // magenta — used for completed-state lilac
  36: Brand.blueOnDark,
  37: Brand.gray50,    // "muted" / secondary text
  39: null,            // default fg (inherit)
  90: Brand.gray60,    // bright black — dim chrome
  91: Brand.red,
  92: Brand.success,
  93: Brand.amber,
  94: Brand.blueOnDark,
  95: Brand.violet,    // bright magenta — active / in-progress
  96: Brand.blueOnDark,
  97: Brand.gray10,    // bright white — headings
};

// ── ANSI parser ────────────────────────────────────────────────────────
//
// Walks the input one char at a time. CSI sequences (`ESC [ ... m`)
// update an active-style record; everything else is emitted as a
// styled <span>. Handles 38;2;R;G;B truecolor and 38;5;N 256-color
// just in case the captured run produced them, but in practice
// ink-testing-library's chalk emits 16-color codes only.
function ansiToHtml(text) {
  // Split into "lines" first so a trailing newline produces an empty
  // row instead of being silently swallowed by the row generator. We
  // emit one <div class="row"> per line so each terminal row is its
  // own block-level box (preserves alignment with monospace).
  //
  // Critical: each row's inner pieces are joined WITHOUT a newline.
  // With `white-space: pre`, a literal `\n` between span tags becomes
  // a rendered newline, which breaks the row into multiple visual
  // lines and destroys the leading-whitespace centering that the TUI
  // relies on.
  const lines = text.split('\n');
  const rowsHtml = [];

  for (const line of lines) {
    let style = { fg: null, bold: false, dim: false };
    let buffer = '';
    const pieces = [];

    const flush = () => {
      if (buffer.length === 0) return;
      const css = [];
      if (style.fg) css.push(`color:${style.fg}`);
      if (style.bold) css.push('font-weight:700');
      if (style.dim) css.push('opacity:0.6');
      pieces.push(
        css.length
          ? `<span style="${css.join(';')}">${escapeHtml(buffer)}</span>`
          : escapeHtml(buffer),
      );
      buffer = '';
    };

    let i = 0;
    while (i < line.length) {
      // CSI introducer: ESC [
      if (line.charCodeAt(i) === 0x1b && line[i + 1] === '[') {
        flush();
        // Find the final byte: a letter A-Za-z. Parameter bytes are
        // digits and ';' separators between [ and the final byte.
        let j = i + 2;
        while (j < line.length && !/[A-Za-z]/.test(line[j])) {
          j += 1;
        }
        const finalByte = line[j];
        const params = line.slice(i + 2, j);
        if (finalByte === 'm') applySgr(params.split(';'), style);
        // Other final bytes (cursor moves etc.) — skip.
        i = j + 1;
        continue;
      }
      buffer += line[i];
      i += 1;
    }
    flush();
    rowsHtml.push(`<div class="row">${pieces.join('')}</div>`);
  }
  return rowsHtml.join('');
}

function applySgr(params, style) {
  let i = 0;
  while (i < params.length) {
    const code = parseInt(params[i] || '0', 10);
    if (code === 0) {
      style.fg = null;
      style.bold = false;
      style.dim = false;
    } else if (code === 1) {
      style.bold = true;
    } else if (code === 2) {
      style.dim = true;
    } else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 38) {
      // Truecolor / 256
      const sub = parseInt(params[i + 1] || '0', 10);
      if (sub === 2) {
        const r = parseInt(params[i + 2] || '0', 10);
        const g = parseInt(params[i + 3] || '0', 10);
        const b = parseInt(params[i + 4] || '0', 10);
        style.fg = `rgb(${r},${g},${b})`;
        i += 5;
        continue;
      }
      if (sub === 5) {
        // 256-color — collapse to the closest brand value.
        // Easiest: just leave default for now.
        i += 3;
        continue;
      }
      i += 1;
    } else if (code in ANSI_FG) {
      const c = ANSI_FG[code];
      if (c !== null) style.fg = c;
      else style.fg = null;
    }
    i += 1;
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── HTML wrapper ───────────────────────────────────────────────────────
//
// One terminal-shaped "page" per screen. 96-col window with comfortable
// padding, dark Brand background, a single thin separator under the
// chrome so the screenshot reads as a real terminal pane.
function pageHtml({ title, body, columns = 110, fontSize = 13 }) {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${Brand.gray100};
    color: ${Brand.gray30};
    font-family: 'DejaVu Sans Mono', 'Liberation Mono', ui-monospace, monospace;
    font-size: ${fontSize}px;
    line-height: 1.45;
    font-feature-settings: "liga" 0, "calt" 0;
  }
  .frame {
    box-sizing: border-box;
    width: ${Math.round(columns * (fontSize * 0.6))}px;
    padding: 18px 22px 22px 22px;
    background: ${Brand.gray100};
  }
  .title {
    font-size: 11px;
    color: ${Brand.gray60};
    margin-bottom: 6px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .row {
    white-space: pre;
    min-height: 1em;
  }
  /* Proposed-mock helpers --------------------------------------------- */
  .stripe {
    color: ${Brand.lilac};
    font-weight: 700;
  }
  .heading { color: ${Brand.gray10}; font-weight: 700; }
  .body    { color: ${Brand.gray30}; }
  .muted   { color: ${Brand.gray50}; }
  .subtle  { color: ${Brand.gray60}; }
  .accent  { color: ${Brand.blueOnDark}; }
  .active  { color: ${Brand.violet}; font-weight: 700; }
  .lilac   { color: ${Brand.lilac}; }
  .success { color: ${Brand.success}; }
  .error   { color: ${Brand.red};   font-weight: 700; }
  .warning { color: ${Brand.amber}; }
  .border  { color: ${Brand.gray80}; }
  .glyph-step-active { color: ${Brand.violet}; font-weight: 700; }
  .glyph-step-done   { color: ${Brand.lilac}; }
  .glyph-step-future { color: ${Brand.gray60}; }
  .glyph-step-failed { color: ${Brand.red}; font-weight: 700; }
</style>
</head>
<body>
  <div class="frame">
    <div class="title">${escapeHtml(title)}</div>
    ${body}
  </div>
</body>
</html>`;
}

// ── Proposed mocks (hand-styled) ───────────────────────────────────────
//
// Each entry returns the body HTML for that screen. We compose using
// the helper classes defined in the page CSS so per-screen HTML stays
// short and readable.
//
// The shared `chrome()` helper renders the proposed top bar (brand
// stripe + journey + breadcrumb) and the proposed bottom hint bar,
// stitched around the per-screen body so every PNG carries the new
// chrome.

function chrome({ active, breadcrumb, hints }) {
  const STEPS = [
    { label: 'Welcome', key: 'Welcome' },
    { label: 'Auth', key: 'Auth' },
    { label: 'Setup', key: 'Setup' },
    { label: 'Verify', key: 'Verify' },
    { label: 'Done', key: 'Done' },
  ];
  const stepperParts = STEPS.flatMap((s, i) => {
    const idx = STEPS.findIndex((x) => x.key === active);
    const cls =
      i < idx
        ? 'glyph-step-done'
        : i === idx
        ? 'glyph-step-active'
        : 'glyph-step-future';
    const glyph = i < idx ? '✓' : i === idx ? '●' : '○';
    const out = [
      `<span class="${cls}">${glyph} ${s.label}</span>`,
    ];
    if (i < STEPS.length - 1) out.push('<span class="border">  </span>');
    return out;
  });
  const top = `<div class="row">` +
    `<span class="stripe">▎</span> <span class="heading">amplitude wizard</span>` +
    `<span class="muted">   </span>` +
    stepperParts.join('') +
    (breadcrumb
      ? `   <span class="subtle">·</span> <span class="muted">${escapeHtml(breadcrumb)}</span>`
      : '') +
    `</div>`;
  const sep = `<div class="row"><span class="border">${'─'.repeat(110)}</span></div>`;
  const blank = `<div class="row"> </div>`;
  const bottomSep = sep;
  const prompt = `<div class="row"><span class="active">❯</span> <span class="border">▎</span></div>`;
  const hintRow = `<div class="row">  <span class="muted">${hints}</span></div>`;
  return { top, sep, blank, bottomSep, prompt, hintRow };
}

function wrap(content, opts) {
  const c = chrome(opts);
  return [
    c.top,
    c.sep,
    c.blank,
    content,
    c.blank,
    c.bottomSep,
    c.prompt,
    c.hintRow,
  ].join('\n');
}

const PROPOSED_SCREENS = [
  {
    file: 'IntroScreen__detecting',
    title: 'IntroScreen — detecting',
    body: wrap(
      [
        `<div class="row">  <span class="active">⠋</span> <span class="heading">Scanning /projects/my-app</span></div>`,
        `<div class="row">    <span class="muted">Looking for a framework, package manager, and existing Amplitude setup.</span></div>`,
      ].join('\n'),
      {
        active: 'Welcome',
        breadcrumb: '/projects/my-app',
        hints: 'esc cancel · / commands',
      },
    ),
  },
  {
    file: 'IntroScreen__detected',
    title: 'IntroScreen — detected (Next.js)',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Detected ▲ Next.js in /projects/my-app</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="body">We'll install the Amplitude SDK, plan events with you, and write</span></div>`,
        `<div class="row">  <span class="body">tracking code. Every file change is shown for review before it's</span></div>`,
        `<div class="row">  <span class="body">applied.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Sign in to your Amplitude account</span><span class="muted">                                  1</span></div>`,
        `<div class="row">    <span class="body">Create a new account</span><span class="muted">                                              2</span></div>`,
        `<div class="row">    <span class="body">Change framework</span><span class="muted">                                                  3</span></div>`,
        `<div class="row">    <span class="body">Change directory</span><span class="muted">                                                  4</span></div>`,
        `<div class="row">    <span class="body">Cancel</span><span class="muted">                                                            5</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="warning">⚠</span>  <span class="muted">No package.json here — double-check this is the right directory.</span></div>`,
      ].join('\n'),
      {
        active: 'Welcome',
        breadcrumb: '/projects/my-app',
        hints: '↑↓ navigate · enter select · esc back · / commands',
      },
    ),
  },
  {
    file: 'IntroScreen__welcome-back',
    title: 'IntroScreen — welcome back',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Welcome back, kelson@amplitude.com</span></div>`,
        `<div class="row">    <span class="muted">Acme Analytics · US · 3 events · last run just now</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="body">▲ Next.js detected in /projects/my-app</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Continue to workspace setup</span></div>`,
        `<div class="row">    <span class="body">Change framework</span></div>`,
        `<div class="row">    <span class="body">Change region</span></div>`,
        `<div class="row">    <span class="body">Change directory</span></div>`,
        `<div class="row">    <span class="body">Cancel</span></div>`,
      ].join('\n'),
      {
        active: 'Welcome',
        breadcrumb: 'Acme Analytics · /projects/my-app',
        hints: '↑↓ navigate · enter select · esc back · / commands',
      },
    ),
  },
  {
    file: 'IntroScreen__resume-checkpoint',
    title: 'IntroScreen — resume from checkpoint',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Previous session was interrupted</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="muted">Framework</span>      <span class="body">▲ Next.js</span></div>`,
        `<div class="row">    <span class="muted">Organization</span>   <span class="body">Acme Corp</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Resume where you left off</span></div>`,
        `<div class="row">    <span class="body">Start fresh</span></div>`,
        `<div class="row">    <span class="body">Cancel</span></div>`,
      ].join('\n'),
      {
        active: 'Welcome',
        breadcrumb: '/projects/my-app',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'SetupScreen__detecting',
    title: 'SetupScreen — detecting',
    body: wrap(
      [
        `<div class="row">  <span class="active">⠋</span> <span class="heading">Detecting project configuration</span></div>`,
        `<div class="row">    <span class="muted">Reading framework metadata, build tool, package manager.</span></div>`,
      ].join('\n'),
      {
        active: 'Setup',
        breadcrumb: 'Acme Corp · Production',
        hints: 'esc back',
      },
    ),
  },
  {
    file: 'AuthScreen__oauth',
    title: 'AuthScreen — OAuth waiting',
    body: wrap(
      [
        `<div class="row">  <span class="active">⠋</span> <span class="heading">Signing you in</span></div>`,
        `<div class="row">    <span class="muted">Opening your browser. If it didn't open, paste this URL:</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="accent">https://app.amplitude.com/oauth?response_type=code&amp;client_id=wizard</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: 'US',
        hints: 'r retry browser · m enter api key manually · esc cancel',
      },
    ),
  },
  {
    file: 'AuthScreen__org',
    title: 'AuthScreen — org picker',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Choose an organization</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Acme Corp</span></div>`,
        `<div class="row">    <span class="body">Globex</span></div>`,
        `<div class="row">    <span class="body">Initech</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: 'kelson@amplitude.com · US',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'AuthScreen__project',
    title: 'AuthScreen — project picker',
    body: wrap(
      [
        `<div class="row">  <span class="success">✓</span> <span class="muted">Organization · Acme Corp</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Choose a project</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Production</span></div>`,
        `<div class="row">    <span class="body">Staging</span></div>`,
        `<div class="row">    <span class="body">Internal Tools</span></div>`,
        `<div class="row">    <span class="lilac">+</span> <span class="body">Create new project…</span></div>`,
        `<div class="row">    <span class="muted">↩</span> <span class="body">Start over</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: 'Acme Corp · US',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'RegionSelectScreen__first-time',
    title: 'RegionSelectScreen — first-time picker',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Choose your data region</span></div>`,
        `<div class="row">    <span class="muted">Match the region your organization uses.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ United States</span><span class="muted">    app.amplitude.com</span></div>`,
        `<div class="row">    <span class="body">Europe</span><span class="muted">           app.eu.amplitude.com</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="muted">Data residency affects API endpoints and compliance.</span></div>`,
        `<div class="row">    <span class="muted">Change later with /region.</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: '',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'SignupEmailScreen__empty',
    title: 'SignupEmailScreen — empty input',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Create your Amplitude account</span></div>`,
        `<div class="row">    <span class="muted">Enter your email to get started.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯</span> <span class="border">▎</span></div>`,
        `<div class="row">    <span class="subtle">your.email@example.com</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="muted">We'll use this to create your Amplitude account.</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: '',
        hints: 'enter continue · esc back',
      },
    ),
  },
  {
    file: 'SigningUpScreen__checking',
    title: 'SigningUpScreen — checking account',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Create your Amplitude account</span></div>`,
        `<div class="row">    <span class="muted">Checking your account…</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="body">kelson@amplitude.com</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">⠋</span> <span class="muted">contacting Amplitude</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: '',
        hints: 'esc cancel',
      },
    ),
  },
  {
    file: 'SignupFullNameScreen__empty',
    title: 'SignupFullNameScreen — empty input',
    body: wrap(
      [
        `<div class="row">  <span class="heading">One more thing</span></div>`,
        `<div class="row">    <span class="muted">What's your full name?</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯</span> <span class="border">▎</span></div>`,
        `<div class="row">    <span class="subtle">First Last</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: 'kelson@amplitude.com',
        hints: 'enter continue · esc back',
      },
    ),
  },
  {
    file: 'ToSScreen__terms',
    title: 'ToSScreen — terms picker',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Terms of Service</span></div>`,
        `<div class="row">    <span class="muted">Please review before continuing.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="muted">Terms</span>      <span class="accent">https://amplitude.com/terms</span></div>`,
        `<div class="row">    <span class="muted">Privacy</span>    <span class="accent">https://amplitude.com/privacy</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ I accept</span></div>`,
        `<div class="row">    <span class="body">I do not accept</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="muted">Required to create an Amplitude account.</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: '',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'CreateProjectScreen__idle',
    title: 'CreateProjectScreen — idle prompt',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Create a new project</span></div>`,
        `<div class="row">    <span class="muted">in Acme Corp</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Project name</span></div>`,
        `<div class="row">    <span class="muted">Letters, numbers, and spaces. You can rename it later.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯</span> <span class="border">▎</span></div>`,
        `<div class="row">    <span class="subtle">My new project</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: 'Acme Corp · US',
        hints: 'enter create · esc back',
      },
    ),
  },
  {
    file: 'DataSetupScreen__analyzing',
    title: 'DataSetupScreen — analyzing project',
    body: wrap(
      [
        `<div class="row">  <span class="active">⠋</span> <span class="heading">Analyzing your Amplitude project</span></div>`,
        `<div class="row">    <span class="muted">Looking for existing SDK installation and event data.</span></div>`,
      ].join('\n'),
      {
        active: 'Setup',
        breadcrumb: 'Acme Corp · Production · US',
        hints: 'esc back',
      },
    ),
  },
  {
    file: 'ActivationOptionsScreen__waiting',
    title: 'ActivationOptionsScreen — waiting for events',
    body: wrap(
      [
        `<div class="row">  <span class="heading">SDK installed — waiting for events</span></div>`,
        `<div class="row">    <span class="muted">Your project is configured but hasn't received events yet.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">What would you like to do?</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Help me test locally</span><span class="muted">                 run the setup agent</span></div>`,
        `<div class="row">    <span class="body">Write a support report</span><span class="muted">               open log · save shareable report</span></div>`,
        `<div class="row">    <span class="body">Open the docs</span><span class="muted">                        amplitude.com/docs/sdks</span></div>`,
        `<div class="row">    <span class="body">Exit and resume later</span></div>`,
      ].join('\n'),
      {
        active: 'Verify',
        breadcrumb: 'Acme Corp · Production · US',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'RunScreen__cold-start',
    title: 'RunScreen — cold start',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Setting up Amplitude in Next.js</span><span class="muted">                  0/4 · 55s · cold start</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Tasks</span><span class="muted">                                          </span><span class="heading">Discovered</span></div>`,
        `<div class="row">  <span class="active">◐ Detecting your project setup</span><span class="muted">                  Framework         JavaScript (Web)</span></div>`,
        `<div class="row">  <span class="muted">○ Install Amplitude</span><span class="muted">                             TypeScript        yes</span></div>`,
        `<div class="row">  <span class="muted">○ Plan and approve events to track</span><span class="muted">              Package manager   Yarn V1</span></div>`,
        `<div class="row">  <span class="muted">○ Wire up event tracking</span><span class="muted">                        Project           Amplitude</span></div>`,
        `<div class="row">                                                  <span class="muted">Region            US</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">⠋</span> <span class="body">Reading package.json</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="border">──</span> <span class="active">progress</span> <span class="border">────</span> <span class="muted">logs</span> <span class="border">───</span> <span class="muted">snake</span> <span class="border">──</span><span class="muted">                                          ← → switch</span></div>`,
      ].join('\n'),
      {
        active: 'Setup',
        breadcrumb: 'Acme Analytics · Production · US',
        hints: 'enter pause · q quit · / commands',
      },
    ),
  },
  {
    file: 'McpScreen__looking',
    title: 'McpScreen — looking for AI tools',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Chat with your Amplitude data</span></div>`,
        `<div class="row">    <span class="muted">Wire Amplitude MCP into your AI tools — Claude Code, Cursor, Claude Desktop —</span></div>`,
        `<div class="row">    <span class="muted">so you can ask "show me yesterday's signups" from chat.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">⠋</span> <span class="muted">Looking for supported AI tools</span></div>`,
      ].join('\n'),
      {
        active: 'Setup',
        breadcrumb: 'Acme Analytics · Production · US',
        hints: 'esc skip',
      },
    ),
  },
  {
    file: 'DataIngestionCheckScreen__listening',
    title: 'DataIngestionCheckScreen — listening',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Trigger some events</span></div>`,
        `<div class="row">    <span class="muted">Start your dev server, visit it, and click around. We'll watch for events.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">⠋</span> <span class="muted">Listening for events…</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="warning">⚠</span>  <span class="muted">Heads up: if your dev server was already running, restart it so the new env</span></div>`,
        `<div class="row">       <span class="muted">values load.</span></div>`,
      ].join('\n'),
      {
        active: 'Verify',
        breadcrumb: 'Acme Analytics · Production · US',
        hints: 'q skip verification · x exit and resume later',
      },
    ),
  },
  {
    file: 'SlackScreen__connect',
    title: 'SlackScreen — connect prompt',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Connect Slack</span></div>`,
        `<div class="row">    <span class="muted">Get chart previews, dashboard sharing, and tracking-plan</span></div>`,
        `<div class="row">    <span class="muted">notifications in your Slack workspace.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Connect</span></div>`,
        `<div class="row">    <span class="body">Skip for now</span></div>`,
      ].join('\n'),
      {
        active: 'Done',
        breadcrumb: 'Acme Analytics · Production',
        hints: '↑↓ navigate · enter select · esc skip',
      },
    ),
  },
  {
    file: 'LogoutScreen__confirm',
    title: 'LogoutScreen — confirm',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Log out</span></div>`,
        `<div class="row">    <span class="muted">Clear your stored Amplitude credentials (wizard session and</span></div>`,
        `<div class="row">    <span class="muted">project binding) from this machine.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Log out</span></div>`,
        `<div class="row">    <span class="body">Cancel</span></div>`,
      ].join('\n'),
      {
        active: 'Welcome',
        breadcrumb: 'kelson@amplitude.com',
        hints: '↑↓ navigate · enter select · esc back',
      },
    ),
  },
  {
    file: 'LoginScreen__refreshing',
    title: 'LoginScreen — refreshing',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Re-authenticate</span></div>`,
        `<div class="row">    <span class="muted">Trying to refresh your stored credentials…</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">⠋</span> <span class="muted">Refreshing</span></div>`,
      ].join('\n'),
      {
        active: 'Auth',
        breadcrumb: '',
        hints: 'esc cancel',
      },
    ),
  },
  {
    file: 'OutroScreen__success',
    title: 'OutroScreen — success',
    body: wrap(
      [
        `<div class="row">  <span class="success">✓ Amplitude is live</span></div>`,
        `<div class="row">    <span class="muted">Setup complete in 2m 14s.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Changes</span></div>`,
        `<div class="row">    <span class="success">+</span> <span class="body">Installed @amplitude/analytics-browser</span></div>`,
        `<div class="row">    <span class="success">+</span> <span class="body">Added .env.local with AMPLITUDE_API_KEY</span></div>`,
        `<div class="row">    <span class="success">+</span> <span class="body">Added 3 planned events to your tracking plan</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Open Amplitude</span><span class="muted">                 amplitude.com</span></div>`,
        `<div class="row">    <span class="body">Exit</span></div>`,
      ].join('\n'),
      {
        active: 'Done',
        breadcrumb: 'Acme Analytics · Production · US',
        hints: '↑↓ navigate · enter select',
      },
    ),
  },
  {
    file: 'OutroScreen__error',
    title: 'OutroScreen — error',
    body: wrap(
      [
        `<div class="row">  <span class="error">✗ Setup failed</span></div>`,
        `<div class="row">    <span class="muted">The agent could not detect your framework. Re-run with --menu to pick</span></div>`,
        `<div class="row">    <span class="muted">one manually.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Try these</span></div>`,
        `<div class="row">    <span class="lilac">+</span> <span class="body">Check your API key and network connection</span></div>`,
        `<div class="row">    <span class="lilac">+</span> <span class="body">Re-run with --debug for more detail</span></div>`,
        `<div class="row">    <span class="lilac">+</span> <span class="body">Open the log</span><span class="muted">     /tmp/amplitude-wizard.log     </span><span class="active">l</span></div>`,
        `<div class="row">    <span class="lilac">+</span> <span class="body">Save bug report</span><span class="muted">                                </span><span class="active">c</span></div>`,
        `<div class="row">    <span class="lilac">+</span> <span class="body">Open docs</span><span class="muted">        amplitude.com/docs/get-started/quickstart</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="muted">press any key to exit</span></div>`,
      ].join('\n'),
      {
        active: 'Setup',
        breadcrumb: 'Setup failed',
        hints: 'l open log · c save report · any key exit',
      },
    ),
  },
  {
    file: 'OutroScreen__cancel',
    title: 'OutroScreen — cancel',
    body: wrap(
      [
        `<div class="row">  <span class="heading">Setup cancelled</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Resume later</span></div>`,
        `<div class="row">    <span class="muted">Run npx @amplitude/wizard in this directory anytime.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="heading">Manual setup</span></div>`,
        `<div class="row">    <span class="accent">amplitude.com/docs/get-started/quickstart</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="muted">press any key to exit</span></div>`,
      ].join('\n'),
      {
        active: 'Welcome',
        breadcrumb: '',
        hints: 'any key exit',
      },
    ),
  },
  {
    file: 'OutageScreen__degraded',
    title: 'OutageScreen — degraded services',
    body: wrap(
      [
        `<div class="row">  <span class="warning">⚠</span>  <span class="heading">Service degradation</span></div>`,
        `<div class="row">    <span class="muted">Elevated error rates affecting Anthropic API requests via gateway.</span></div>`,
        `<div class="row">    <span class="muted">The wizard may not work reliably until this clears.</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">    <span class="muted">Status page</span>    <span class="accent">status.anthropic.com</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">⠋</span> <span class="muted">Re-checking… attempt 1 of 10</span></div>`,
        `<div class="row"> </div>`,
        `<div class="row">  <span class="active">❯ Continue anyway</span></div>`,
        `<div class="row">    <span class="body">Cancel</span></div>`,
      ].join('\n'),
      {
        active: 'Setup',
        breadcrumb: 'Service incident',
        hints: '↑↓ navigate · enter select · esc cancel',
      },
    ),
  },
];

// ── Renderer driver ────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Current screens — read JSON, ANSI-parse, render.
  const jsonPath = path.join(REPO_ROOT, 'docs', '_tui-current-state.json');
  const captures = JSON.parse(await fs.readFile(jsonPath, 'utf8'));

  const currentDir = path.join(REPO_ROOT, 'docs', 'mocks', 'current');
  await fs.mkdir(currentDir, { recursive: true });

  for (const c of captures) {
    const safeState = c.state.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+|-$/g, '-').replace(/^-|-$/g, '');
    const filename = `${c.screen}__${safeState}.png`;
    const html = pageHtml({
      title: `current · ${c.screen} · ${c.state}`,
      body: ansiToHtml(c.rawFrame),
    });
    await page.setContent(html, { waitUntil: 'load' });
    const frameEl = await page.$('.frame');
    if (!frameEl) throw new Error('frame element missing');
    await frameEl.screenshot({ path: path.join(currentDir, filename) });
    process.stdout.write(`current  ${filename}\n`);
  }

  // Proposed screens — hand-coded HTML.
  const proposedDir = path.join(REPO_ROOT, 'docs', 'mocks', 'proposed');
  await fs.mkdir(proposedDir, { recursive: true });

  for (const s of PROPOSED_SCREENS) {
    const filename = `${s.file}.png`;
    const html = pageHtml({ title: `proposed · ${s.title}`, body: s.body });
    await page.setContent(html, { waitUntil: 'load' });
    const frameEl = await page.$('.frame');
    if (!frameEl) throw new Error('frame element missing');
    await frameEl.screenshot({ path: path.join(proposedDir, filename) });
    process.stdout.write(`proposed ${filename}\n`);
  }

  await browser.close();
}

await main();
