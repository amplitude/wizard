/**
 * End-to-end regression test for the per-event wiring status chain:
 *
 *   inner-lifecycle.PostToolUse(SDK payload)
 *     → getUI().noteWrittenContent(merged)
 *     → InkUI.noteWrittenContent
 *     → WizardStore.noteWrittenContent
 *     → markEventStatus(name, 'done')
 *     → $eventPlan atom updates
 *
 * Replays the exact PostToolUse payload shapes the Claude Agent SDK emits
 * for `Write`, `Edit`, and `MultiEdit` (verified against
 * `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` —
 * `PostToolUseHookInput` carries `tool_name` + `tool_input` + `tool_response`).
 *
 * This test exists because PR #698 shipped the per-event status feature but
 * a real wizard run sat at "(0 done · 9 to go)" for ~10 minutes while the
 * agent was clearly editing files. The unit tests in
 * `event-wiring-status.test.ts` cover each layer in isolation; this file
 * pins the FULL chain so a regression in any layer (hook → UI → store)
 * surfaces here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInnerLifecycleHooks } from '../../../lib/inner-lifecycle.js';
import { setUI, getUI } from '../../index.js';
import { LoggingUI } from '../../logging-ui.js';
import { InkUI } from '../ink-ui.js';
import { WizardStore } from '../store.js';
import { Flow } from '../router.js';

function createInkUiWithStore(): { store: WizardStore; ui: InkUI } {
  const store = new WizardStore(Flow.Wizard);
  const ui = new InkUI(store);
  setUI(ui);
  return { store, ui };
}

describe('per-event wiring status — full PostToolUse → store chain', () => {
  let originalUI: ReturnType<typeof getUI>;

  beforeEach(() => {
    originalUI = getUI();
  });

  afterEach(() => {
    setUI(originalUI ?? new LoggingUI());
  });

  it('Write tool with track() in `content` flips the matching event to done', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([
      { name: 'User Signed Up', description: '' },
      { name: 'User Signed In', description: '' },
    ]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    // Real PostToolUseHookInput shape from the Claude Agent SDK.
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/app/src/auth.ts',
          content: `import { amplitude } from './amplitude';

export async function handleSignup(email: string) {
  amplitude.track('User Signed Up', { method: 'email' });
}
`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_01abc',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('done');
    expect(store.eventPlan[1].status).toBe('pending');
  });

  it('Edit tool with track() in `new_string` flips the matching event to done', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([{ name: 'Product Added To Cart', description: '' }]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    // The Edit tool sends the *replacement* fragment in `new_string`, NOT
    // the full file. The hook must scan that fragment for track() calls.
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/src/cart.ts',
          old_string: 'function addToCart(item) {',
          new_string: `function addToCart(item) {
  amplitude.track("Product Added To Cart", { sku: item.sku });`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_02def',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('done');
  });

  it('MultiEdit tool with track() spread across edits[].new_string fragments flips events to done', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([
      { name: 'User Signed Up', description: '' },
      { name: 'User Signed In', description: '' },
      { name: 'Order Completed', description: '' },
    ]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: '/tmp/app/src/auth.ts',
          edits: [
            {
              old_string: '// signup',
              new_string: `amplitude.track('User Signed Up', { method: 'email' });`,
            },
            {
              old_string: '// signin',
              new_string: `amplitude.track('User Signed In', {});`,
            },
            // No track() for "Order Completed" — that one stays pending.
          ],
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_03ghi',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('done');
    expect(store.eventPlan[1].status).toBe('done');
    expect(store.eventPlan[2].status).toBe('pending');
  });

  it('Edit with multiline track() spanning new_string still flips done', async () => {
    // Real-world shape: agent inserts a `track()` call whose object literal
    // wraps onto multiple lines. The regex must tolerate the line break
    // between the event-name string and the comma/closing paren.
    const { store } = createInkUiWithStore();
    store.setEventPlan([{ name: 'User Signed Up', description: '' }]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/src/auth.ts',
          old_string: 'await registerUser(email);',
          new_string: `await registerUser(email);
amplitude.track('User Signed Up', {
  userId: req.user.id,
  method: 'email',
});`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_04jkl',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('done');
  });

  it('Write tool whose content has no track() leaves events pending (no false positive)', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([{ name: 'User Signed Up', description: '' }]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/app/src/util.ts',
          content: `export function noop() { return undefined; }`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_05mno',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('pending');
  });

  it('Non-write tools (Read, Bash) never touch event status', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([{ name: 'User Signed Up', description: '' }]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    // Even if the Read result mentions track('User Signed Up'), Read isn't
    // a write tool — content scan must not run.
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/app/src/auth.ts' },
        tool_response: {
          content: `track('User Signed Up')`,
        },
        tool_use_id: 'toolu_06pqr',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('pending');
  });

  it('Edit whose new_string contains a name not in the plan does NOT match by accident', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([{ name: 'User Signed Up', description: '' }]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/src/cart.ts',
          old_string: 'function addToCart() {',
          new_string: `function addToCart() {
  amplitude.track('Cart Viewed', {});`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_07stu',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('pending');
  });

  // Regression for the production silent-lie bug captured on the
  // 2026-05-09 asciinema cast (PR #698 review). The agent's server-side
  // Next.js skill prompts it to wrap `client.track({ event_type: name,
  // … })` in a `trackServer(name, props, userId)` helper and call THAT
  // at every event site (because the Node analytics client takes an
  // object, not positional args). The earlier `\btrack\(` regex
  // required `track(` literally so `trackServer(` slipped past, no
  // event ever flipped done, and the per-event counter sat at "(0 done
  // · 9 to go)" for ~10 minutes while the file-writes panel showed
  // dozens of edits going through. This test pins the exact Edit
  // payload shape from that run.
  it('Edit with `trackServer(…)` wrapper from real Next.js cast flips events done', async () => {
    const { store } = createInkUiWithStore();
    store.setEventPlan([
      { name: 'User Signed Up', description: '' },
      { name: 'User Signed In', description: '' },
      { name: 'User Signed Out', description: '' },
      { name: 'Product Added To Cart', description: '' },
    ]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    // Sequence of edits the agent emitted on the cast — each one
    // wrapped in a separate Edit tool invocation.
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/app/(login)/actions.ts',
          old_string: 'await setSession(createdUser);',
          new_string: `await setSession(createdUser);
  trackServer("User Signed Up", { username: createdUser.username }, String(createdUser.id));`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_signup',
      },
      undefined,
      { signal: new AbortController().signal },
    );
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/app/(login)/actions.ts',
          old_string: 'await setSession(foundUser);',
          new_string: `await setSession(foundUser);
  trackServer("User Signed In", { username: foundUser.username }, String(foundUser.id));`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_signin',
      },
      undefined,
      { signal: new AbortController().signal },
    );
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/app/(login)/actions.ts',
          old_string: 'export async function signOut() {',
          new_string: `export async function signOut() {
  trackServer("User Signed Out");`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_signout',
      },
      undefined,
      { signal: new AbortController().signal },
    );
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/app/app/(shop)/cart/actions.ts',
          old_string: 'return "Item added to cart";',
          new_string: `trackServer("Product Added To Cart", { product_slug: productSlug });
  return "Item added to cart";`,
        },
        tool_response: { success: true },
        tool_use_id: 'toolu_cart',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan.map((e) => e.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  it('Write payload is the SHAPE the SDK emits — uses tool_input.content (not tool_response.content)', async () => {
    // Regression: an earlier hypothesis was that PostToolUse forwarded
    // `tool_response.content` instead of `tool_input.content`. This test
    // pins the contract: tool_input.content carries the written bytes
    // and is what the hook must scan. tool_response on Write tools is
    // typically just a success ack and SHOULD NOT be the source of truth.
    const { store } = createInkUiWithStore();
    store.setEventPlan([{ name: 'User Signed Up', description: '' }]);

    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle.hooks().PostToolUse(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/app/src/auth.ts',
          content: `track('User Signed Up')`,
        },
        // tool_response intentionally has no `content` — proves we're
        // scanning tool_input, not tool_response.
        tool_response: {
          type: 'create_result',
          filePath: '/tmp/app/src/auth.ts',
        },
        tool_use_id: 'toolu_08vwx',
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(store.eventPlan[0].status).toBe('done');
  });
});
