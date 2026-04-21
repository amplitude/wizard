# Direct Signup Outcome Telemetry — Design

> Spec for the follow-up PR to #165 (direct signup). This is the telemetry layer
> that gates ramping the `wizard-direct-signup` Amplitude Experiment flag off
> 0%.

## Problem

`performSignupOrAuth` (the direct-signup wrapper in
`src/utils/signup-or-auth.ts`) has five attempt outcomes that are externally
indistinguishable today:

1. `performDirectSignup` returned `requires_redirect` → wrapper returns `null`.
2. `performDirectSignup` returned `error` or threw → wrapper returns `null`.
3. Direct signup succeeded, but internal `fetchAmplitudeUser` failed after
   retries → wrapper persists an `{ id: 'pending' }` sentinel, returns with
   `userInfo: null`.
4. Direct signup succeeded but the freshly provisioned account has no
   environment with an API key yet.
5. Full success — tokens persisted, real `userInfo` returned.

Plus two "never attempted" cases that the CLI still takes the `--signup` path
for:

- `wizard-direct-signup` flag evaluates off.
- `--email` or `--full-name` is missing.

From the outside, failures 1–4 all collapse to "the wrapper returned `null`, the
caller's fallback ran." During canary and gradual ramp we cannot distinguish
"flag off in prod because we're at 0%" from "flag on but server-side integration
is broken."

This is the blocker for ramping the flag off 0%.

## Scope

**In scope:** Amplitude event emission covering every attempt exit of
`performSignupOrAuth`, plus a `signup` boolean on the existing `session started`
event so attempt-rate and end-to-end conversion are measurable via funnel.

**Out of scope:**

- Sentry / Datadog instrumentation (separate concern).
- Fixing the pre-existing gap where non-TUI modes (agent, CI, classic) never
  call `analytics.applyOptOut()` and therefore don't honor
  `wizard-agent-analytics=off`. Tracked separately; intentionally not widened
  here.
- The `direct-signup` → `headless-signup` rename (deferred follow-up from #165).
- Dashboards. A dashboard owner must be named in the PR description, but the
  dashboard itself ships separately.
- Any mutation of signup-flow behavior. This PR instruments only.

## Decisions

### Event name — `wizard cli: agentic signup attempted`

Fires once per actual signup attempt (flag on, inputs present). The name is
action-oriented, per Amplitude taxonomy practice. "Outcome" is a meta-word;
"attempted" is a semantic event that a chart title can describe cleanly.
"Agentic" matches the backend endpoint naming (`/t/agentic/signup/v1`) and
survives the deferred `direct-signup` → `headless-signup` rename tracked
against #165 — renaming the event later would lose continuity.

### Properties

| Key                      | Type    | When set                                          | Values                                                                                           |
| ------------------------ | ------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `status`                 | string  | always                                            | `success` \| `requires_redirect` \| `signup_error` \| `user_fetch_failed` \| `wrapper_exception` |
| `zone`                   | string  | always                                            | `us` \| `eu`                                                                                     |
| `has env with api key`   | boolean | only when `status = success`                      | —                                                                                                |
| `user fetch retry count` | number  | only when `status ∈ {success, user_fetch_failed}` | `0..3`                                                                                           |

Flat single-enum `status` matches the existing codebase pattern
(`session ended { status }`, `outro reached { 'outro kind' }`). A split
`outcome + failure reason` was considered and rejected — five values segments
fine in Amplitude without introducing a novel two-axis shape to this codebase.

Session-scoped properties (`mode`, `wizard_version`, `platform`, `session id`,
`run id`, `integration`) come for free via `analytics.capture`.

### What does NOT fire `agentic signup attempted`

- **Flag off.** Not an attempt. A `log.debug` line remains; nothing emitted.
- **Missing `--email` or `--full-name`.** Same — not an attempt.

These cases are observable via the denominator below.

### Denominator — `signup` boolean on `session started`

One-line addition in `src/run.ts:81`:

```diff
 analytics.wizardCapture('session started', {
   integration,
   ci: session.ci ?? false,
+  signup: session.signup ?? false,
 });
```

This is what makes the attempt-rate metric computable. Without it, we have no
way to distinguish "flag off at 0%" from "users aren't passing `--signup`."

### Emission site — inside `performSignupOrAuth`

Single emission point. The wrapper is the only layer with full visibility into
every attempt path (network result, internal fetch retry count,
`hasEnvWithApiKey` on the success branch). `bin.ts:runDirectSignupIfRequested`
only sees `null` vs `PerformSignupOrAuthResult` and cannot reconstruct the
status. Moving emission to the caller would require a richer wrapper return
shape (invasive for no observable benefit); emitting at the wrapper couples it
to analytics (small, and the wrapper already has side effects via `storeToken`).

The one exception: **`wrapper_exception`** fires from the outer catch in
`bin.ts:runDirectSignupIfRequested`, since a thrown wrapper means the in-wrapper
emission never ran. One belt-and-suspenders `wizardCapture` call there covers
the edge.

### Metrics enabled

- **Attempt rate** —
  `count(agentic signup attempted) / count(session started where signup = true)`.
  Shows whether the flag is actually reaching users during ramp.
- **Success rate** —
  `count(agentic signup attempted where status = success) / count(agentic signup attempted)`.
  Shows whether the signup flow itself works.
- **End-to-end conversion** — funnel: `session started {signup: true}` →
  `agent started`. Shows whether users on the signup path got credentials at all
  (captures both direct-signup success and fallback recovery).
- **Failure distribution** — segment
  `agentic signup attempted where status != success` by `status`. Shows which
  failure mode dominates.
- **Provisioning-lag signal** — segment successful attempts by
  `has env with api key = false` and `user fetch retry count > 0`. Shows whether
  post-signup backend provisioning is keeping up.

Fallback-recovery measurement uses the existing funnel rather than a chained
event or a telemetry-only session field. Amplitude funnels correlate the two
events via `device_id` / `user_id` without any additional code.

## Implementation sketch

### `src/utils/signup-or-auth.ts`

```ts
type SignupAttemptStatus =
  | 'success'
  | 'requires_redirect'
  | 'signup_error'
  | 'user_fetch_failed';

function emitAttempted(
  status: SignupAttemptStatus,
  zone: AmplitudeZone,
  extras: { hasEnvWithApiKey?: boolean; userFetchRetryCount?: number } = {},
): void {
  const props: Record<string, unknown> = { status, zone };
  if (extras.hasEnvWithApiKey !== undefined) {
    props['has env with api key'] = extras.hasEnvWithApiKey;
  }
  if (extras.userFetchRetryCount !== undefined) {
    props['user fetch retry count'] = extras.userFetchRetryCount;
  }
  analytics.wizardCapture('agentic signup attempted', props);
}
```

Emit at these points:

- `performDirectSignup` returned `requires_redirect` →
  `emitAttempted('requires_redirect', zone)`.
- `performDirectSignup` returned `error` (or wrapper's own try/catch caught a
  throw) → `emitAttempted('signup_error', zone)`.
- `fetchUserWithProvisioningRetry` threw →
  `emitAttempted('user_fetch_failed', zone, { userFetchRetryCount: <final> })`.
- Success branch →
  `emitAttempted('success', zone, { hasEnvWithApiKey, userFetchRetryCount })`.

The existing `fetchUserWithProvisioningRetry` helper needs to surface
`retryCount` (current implementation internalizes it). Minimal change: return
`{ userInfo, retryCount }` from the helper.

### `bin.ts:runDirectSignupIfRequested`

```ts
} catch (err) {
  analytics.wizardCapture('agentic signup attempted', {
    status: 'wrapper_exception',
    zone,
  });
  getUI().log.warn(/* existing message */);
}
```

### `src/run.ts`

Add `signup` prop to the existing `session started` emission (see diff in
"Denominator" above).

## Testing

Extend `src/utils/__tests__/signup-or-auth.test.ts`:

- Spy on `analytics.wizardCapture` (existing global mock in
  `src/__tests__/cli.test.ts` follows this pattern).
- Assert `status`, `zone`, and conditional properties for each of the four
  wrapper-internal outcomes.
- Assert no emission on flag-off and missing-inputs paths.
- Add a test for the `bin.ts` `wrapper_exception` emission (may live in
  `cli.test.ts` or a new targeted test).

Extend `src/__tests__/run.test.ts` (or the closest `session started` assertion):

- Confirm `signup` boolean is present and matches `session.signup`.

No new test infrastructure. No snapshot tests.

## Risks

- **Emission before user identity is known.** `analytics.capture` (line 210 of
  `src/utils/analytics.ts`) handles missing `distinctId` — events send with
  `device_id` only. No change needed.
- **Emission before `applyOptOut()` runs in non-TUI modes.** In these modes
  `applyOptOut` is never called today (pre-existing gap, explicitly out of
  scope). Signup events will ship regardless of `wizard-agent-analytics` value
  in those modes — same behavior as every other event fired from those modes
  today. The pre-existing gap is documented separately and not widened by this
  change.
- **`wrapper_exception` expected frequency = ~0.** The wrapper internally
  catches everything except a `storeToken` disk/permission failure. Listed for
  completeness, not because we expect volume.
- **PII.** Constraint enforced by construction — no event property references
  `email` or `fullName`. Verified by test (no property-name regex matches PII
  fields in the event shape).

## Rollout

1. Merge this PR.
2. Name a dashboard owner in the PR description; they stand up a "direct signup
   ramp health" Amplitude chart set before step 3.
3. Flip `wizard-direct-signup` to internal canary; monitor attempt rate, success
   rate, failure distribution, and the end-to-end funnel.
4. Gradual ramp: 10% → 50% → 100% with the dashboard as the gate.

## Known follow-ups (not this PR)

- Fix the non-TUI `applyOptOut` gap so `wizard-agent-analytics` opt-out is
  honored in agent / CI / classic modes.
- Rename `direct-signup` → `headless-signup` throughout.
- A separate `'signup succeeded but no env with api key'` alert / follow-up path
  if the adjacent edge case surfaces at non-trivial rates.
