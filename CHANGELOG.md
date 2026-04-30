# Changelog

## [1.13.1](https://github.com/amplitude/wizard/compare/wizard-v1.13.0...wizard-v1.13.1) (2026-04-30)


### Bug Fixes

* **agent:** bound observer hooks so a hung hook can't pin the SDK turn ([#470](https://github.com/amplitude/wizard/issues/470)) ([386f647](https://github.com/amplitude/wizard/commit/386f64755bb82ac91c74860b50f10825b6323e00))
* **agent:** explicitly disable extended thinking on agent query ([#471](https://github.com/amplitude/wizard/issues/471)) ([e367b15](https://github.com/amplitude/wizard/commit/e367b15808fbd847e2093f3424c09a2a48afa785))
* **agent:** preserve files-on-disk + last-status across retry attempts ([#468](https://github.com/amplitude/wizard/issues/468)) ([e42e925](https://github.com/amplitude/wizard/commit/e42e92575896f73fccfaa18c91cd5437fbeb4d7e))
* **agent:** stop masking gateway hangs as progress on the SDK's pre-wait envelope ([#467](https://github.com/amplitude/wizard/issues/467)) ([00d4cf5](https://github.com/amplitude/wizard/commit/00d4cf555020fecddc3782894a312dfabdff8ff4))
* **agent:** tighten the stall timer's signal-to-noise (status + stream_event) ([#473](https://github.com/amplitude/wizard/issues/473)) ([2d0b5ee](https://github.com/amplitude/wizard/commit/2d0b5ee9642393e7ae18166aaf4b0591761f26fc))
* **auth:** route MCP to bearer's issuer zone, not the env's data zone ([#466](https://github.com/amplitude/wizard/issues/466)) ([63c0f3c](https://github.com/amplitude/wizard/commit/63c0f3c78a7cd830d6482c657da3aa610e5a7817))
* **mcp:** bound every gateway fetch with a per-call timeout ([#469](https://github.com/amplitude/wizard/issues/469)) ([a8d00a0](https://github.com/amplitude/wizard/commit/a8d00a02ecffe9738090aa3063671e37c4ff27fd))
* **mcp:** fail fast on auth errors instead of burning agent fallback time ([#465](https://github.com/amplitude/wizard/issues/465)) ([8f4406f](https://github.com/amplitude/wizard/commit/8f4406f67faf3499ecf5531c2b14bb97c0d69e58))
* **tui:** clear requiresAccountConfirmation on region switch ([#458](https://github.com/amplitude/wizard/issues/458)) ([b5df370](https://github.com/amplitude/wizard/commit/b5df3705de730788b8e7cddf0fd387ea569364ce))
* **tui:** gate authTask on !regionForced so IntroScreen "Change region" hits the new zone ([#461](https://github.com/amplitude/wizard/issues/461)) ([0fe40d8](https://github.com/amplitude/wizard/commit/0fe40d8acdf86119cde3a59de8652a2347fc08fe))
* **tui:** re-auth watcher fires on /region during AuthScreen SUSI ([#472](https://github.com/amplitude/wizard/issues/472)) ([4756054](https://github.com/amplitude/wizard/commit/4756054f490d62dd08d92795641b3f0d895c4338))


### Performance Improvements

* cut redundant disk scans and MCP handshakes per wizard run ([#463](https://github.com/amplitude/wizard/issues/463)) ([b476b65](https://github.com/amplitude/wizard/commit/b476b656fc59cbd9d0f19f04253fb59638b40d67))
* slim shell-shape rules + allow multi-file Edit parallelism ([#464](https://github.com/amplitude/wizard/issues/464)) ([e680db0](https://github.com/amplitude/wizard/commit/e680db04d6bdb775a06b62e10e52fe6cb77b4a04))


### Reverts

* clear requiresAccountConfirmation on region switch ([#460](https://github.com/amplitude/wizard/issues/460)) ([51df833](https://github.com/amplitude/wizard/commit/51df833e0e9d660df5abb9a3a5165319e396d44d))

## [1.13.0](https://github.com/amplitude/wizard/compare/wizard-v1.12.0...wizard-v1.13.0) (2026-04-30)


### Features

* **commandments:** fan out independent discovery probes in one message ([#453](https://github.com/amplitude/wizard/issues/453)) ([e3a6f8e](https://github.com/amplitude/wizard/commit/e3a6f8ea51365ea89c78447f34630937f061c8dc))

## [1.12.0](https://github.com/amplitude/wizard/compare/wizard-v1.11.1...wizard-v1.12.0) (2026-04-30)


### Features

* **tui:** scope Logs tab to current session by default; press a for full history ([#452](https://github.com/amplitude/wizard/issues/452)) ([82031c2](https://github.com/amplitude/wizard/commit/82031c2b0a624df97fbbf4796b29b3e7aa978d3d))

## [1.11.1](https://github.com/amplitude/wizard/compare/wizard-v1.11.0...wizard-v1.11.1) (2026-04-30)


### Bug Fixes

* **cli:** shadow benchmark/log env vars so --help survives strict mode ([#448](https://github.com/amplitude/wizard/issues/448)) ([86f42a0](https://github.com/amplitude/wizard/commit/86f42a0defb95f0253d2709ee4907ce53e088fe5))
* **intro:** wire up redetector so "Change directory" stops hanging ([#441](https://github.com/amplitude/wizard/issues/441)) ([#447](https://github.com/amplitude/wizard/issues/447)) ([b3a6ed3](https://github.com/amplitude/wizard/commit/b3a6ed3bc4ba55b582a24a82937ff8234386d883))
* stop calling broken Amplitude MCP write tools and skill menu ([#445](https://github.com/amplitude/wizard/issues/445)) ([7acfb8e](https://github.com/amplitude/wizard/commit/7acfb8e952b4fcfac32f4e6324ffcd0a994e0a65))
* stop the wizard from telling users a 5-minute run is "unusually slow" ([#410](https://github.com/amplitude/wizard/issues/410)) ([3095afe](https://github.com/amplitude/wizard/commit/3095afeb7fe620066a9d89f3606f7865d83489d1))
* stop wizard from creating the dashboard twice ([#446](https://github.com/amplitude/wizard/issues/446)) ([8f89ec9](https://github.com/amplitude/wizard/commit/8f89ec97a3e28a26d953e0d5f6080e64fa04e960))
* strip SSE stream-event noise from CLI subprocess logs ([#450](https://github.com/amplitude/wizard/issues/450)) ([a0c1a97](https://github.com/amplitude/wizard/commit/a0c1a974fdc5f40ba9ac5a3bd7c41f70691938af))
* **tui:** sync credentials.appId/projectApiKey on project switch ([#439](https://github.com/amplitude/wizard/issues/439)) ([247bdf9](https://github.com/amplitude/wizard/commit/247bdf953625ed1c6b4b872ad899e28b5b7994e8))

## [1.11.0](https://github.com/amplitude/wizard/compare/wizard-v1.10.0...wizard-v1.11.0) (2026-04-30)


### Features

* add ToS acceptance flow for --signup option ([#352](https://github.com/amplitude/wizard/issues/352)) ([dfc323b](https://github.com/amplitude/wizard/commit/dfc323b17f80855cb154b3573fd4691c7a5eae5e))
* **agent:** cap env_selection NDJSON payload at 50 choices ([#420](https://github.com/amplitude/wizard/issues/420)) ([b4fe558](https://github.com/amplitude/wizard/commit/b4fe558b71a953cacdd9184052677ef5fb92d17b))
* **agent:** circuit-breaker for repeated PreToolUse Bash denies ([#393](https://github.com/amplitude/wizard/issues/393)) ([b898fc3](https://github.com/amplitude/wizard/commit/b898fc3c17b7519f6d9800e645d24b599be74010))
* **agent:** emit checkpoint events + add --resume flag ([#417](https://github.com/amplitude/wizard/issues/417)) ([0f07ab8](https://github.com/amplitude/wizard/commit/0f07ab8da12165377bcff920007ae181116b41ce))
* **agent:** emit heartbeat NDJSON event on a fixed 10s cadence ([#415](https://github.com/amplitude/wizard/issues/415)) ([88d7b1a](https://github.com/amplitude/wizard/commit/88d7b1ab12830b3e129d0829ce7e7b85b97db5f7))
* **agent:** inject orchestrator context via --context-file ([#414](https://github.com/amplitude/wizard/issues/414)) ([0baea5f](https://github.com/amplitude/wizard/commit/0baea5fcee94d1f51c6fafa08908636b395750e6))
* **agent:** per-tool invocation counts in agent_metrics ([#396](https://github.com/amplitude/wizard/issues/396)) ([81ee19a](https://github.com/amplitude/wizard/commit/81ee19af4fd89d9869f8d87d22fb75840b5b8781))
* **agent:** recoverable error tags + truncate large Read tool outputs ([#432](https://github.com/amplitude/wizard/issues/432)) ([576cbb6](https://github.com/amplitude/wizard/commit/576cbb6b2c5cd1f1365095631665cd71df40bffd))
* **agent:** stream model text deltas into the status pill ([#426](https://github.com/amplitude/wizard/issues/426)) ([2fcdbca](https://github.com/amplitude/wizard/commit/2fcdbca13cb8cabce2a40b2b92604c21405efcd8))
* **agent:** structured rejection on bad scope-flag in agent mode ([#391](https://github.com/amplitude/wizard/issues/391)) ([d755191](https://github.com/amplitude/wizard/commit/d755191a4e3ae558ca2e90ebb2d2e90494290432))
* **intro:** welcome back returning users with project + activation context ([#400](https://github.com/amplitude/wizard/issues/400)) ([35c4f67](https://github.com/amplitude/wizard/commit/35c4f67f16611781a8eeea898d8ec2a3c7d7c878))
* **outro:** press D to review changed files before exit ([#412](https://github.com/amplitude/wizard/issues/412)) ([cda7633](https://github.com/amplitude/wizard/commit/cda763373cb78f6239ee1411b13f8738555e40f3))
* **outro:** press R to retry from checkpoint on error/cancel ([#413](https://github.com/amplitude/wizard/issues/413)) ([7ed246d](https://github.com/amplitude/wizard/commit/7ed246d38e14e1982386b794272bd5fde194b142))
* **tui:** show tracking plan and live event arrivals at verification step ([#401](https://github.com/amplitude/wizard/issues/401)) ([b604deb](https://github.com/amplitude/wizard/commit/b604deb7ed5c48440b62e199bb1f1ba4f39e54c3))


### Bug Fixes

* **activation:** short-circuit agent on fully-wired re-runs ([#434](https://github.com/amplitude/wizard/issues/434)) ([d1eb1c4](https://github.com/amplitude/wizard/commit/d1eb1c423d17372f752ec63b5dee0ccba60cdf71))
* address Cursor Bugbot findings from merged PRs ([#424](https://github.com/amplitude/wizard/issues/424)) ([e2d4344](https://github.com/amplitude/wizard/commit/e2d43448005736d82a4d80a141a25bb2c12bbfdb))
* address Cursor Bugbot findings from recently merged PRs ([#419](https://github.com/amplitude/wizard/issues/419)) ([ea78975](https://github.com/amplitude/wizard/commit/ea789756aeb225a7ea80ffb4d5217ce4950dddae))
* **agent:** cross-tier Haiku fallback at attempt &gt;= 3 for outage recovery ([#422](https://github.com/amplitude/wizard/issues/422)) ([c739d25](https://github.com/amplitude/wizard/commit/c739d2562c58462876db7110a8d74f88a398f8df))
* **agent:** cut Stop hook timeout 30s → 8s so the outro never feels frozen ([#436](https://github.com/amplitude/wizard/issues/436)) ([7b486ea](https://github.com/amplitude/wizard/commit/7b486ea5f4c21b4b9a09c5387402b3285a9e6d9d))
* **agent:** trust SDK internal-retry recovery in post-loop classifier ([#433](https://github.com/amplitude/wizard/issues/433)) ([d7cf4b0](https://github.com/amplitude/wizard/commit/d7cf4b0645ff0328be4d27d59cb2418495318536))
* **auth:** probe other zone before failing with no-orgs error ([#402](https://github.com/amplitude/wizard/issues/402)) ([cfe7470](https://github.com/amplitude/wizard/commit/cfe74704f4ac6417a8b4afc46e6d790b470c8c1c))
* **auth:** refresh OAuth token at post-run boundary so long agent runs don't break MCP/dashboard/ingestion ([#407](https://github.com/amplitude/wizard/issues/407)) ([ca4b111](https://github.com/amplitude/wizard/commit/ca4b11187f819247e299a820a3f470bab9216e71))
* **auth:** restore mid-session re-auth watcher dropped in the bin.ts split ([#416](https://github.com/amplitude/wizard/issues/416)) ([be49207](https://github.com/amplitude/wizard/commit/be4920720002c6f834bfffaaa479daf81c5a6815))
* avoid gitignoring committed env templates and protect CLAUDE.md ([#392](https://github.com/amplitude/wizard/issues/392)) ([1864e3d](https://github.com/amplitude/wizard/commit/1864e3df0e22d6923fad6fbe1c6dabf5025ed348))
* **commandments:** align browser init pattern with context-hub (no wrapper re-export) ([#423](https://github.com/amplitude/wizard/issues/423)) ([9f71702](https://github.com/amplitude/wizard/commit/9f7170209bd5114d2edf9ad5d869374ace48626d))
* **commandments:** make project-local amplitude.ts re-export load-bearing ([#408](https://github.com/amplitude/wizard/issues/408)) ([12088d4](https://github.com/amplitude/wizard/commit/12088d431345eeb9f58c89409b0f020b52e7ab93))
* **commandments:** teach agent simple build/typecheck shapes that survive bash allowlist ([#411](https://github.com/amplitude/wizard/issues/411)) ([3ac3090](https://github.com/amplitude/wizard/commit/3ac30904434ebf488b355023c0efeea2c14c1bb7))
* **deps:** drop release-age gate so SDK platform binaries install ([#438](https://github.com/amplitude/wizard/issues/438)) ([3a9bff4](https://github.com/amplitude/wizard/commit/3a9bff49e022d59ebbb539ee330bbfd0fc0cae8b))
* **eu:** make MCP URL region-aware so EU users hit mcp.eu.amplitude.com ([#390](https://github.com/amplitude/wizard/issues/390)) ([74f6a96](https://github.com/amplitude/wizard/commit/74f6a9659bcb980cd7110f9f936356b5bdc3fbd7))
* **outro:** honor outro kind in screen-initiated dismissal exit code ([#399](https://github.com/amplitude/wizard/issues/399)) ([827dcda](https://github.com/amplitude/wizard/commit/827dcdafa1f9812f179850007ec7c03ce72f8ef1))
* **outro:** re-fork-on-every-keystroke + analytics dedup (Bugbot, PR [#412](https://github.com/amplitude/wizard/issues/412)) ([#418](https://github.com/amplitude/wizard/issues/418)) ([4bd1a91](https://github.com/amplitude/wizard/commit/4bd1a916cfe7f8ae70505e71bfa31b89b9a91352))
* **planned-events:** short-circuit when Amplitude MCP has no create_events tool ([#385](https://github.com/amplitude/wizard/issues/385)) ([2f3ad12](https://github.com/amplitude/wizard/commit/2f3ad125cab708b5029eb02029a4cc349eea9bd1))
* **recovery:** catch uncaught exceptions and route through wizardAbort ([#406](https://github.com/amplitude/wizard/issues/406)) ([7ff1300](https://github.com/amplitude/wizard/commit/7ff13005aef4fbc42f2e5fd4aed6d3b944b02151))
* **safety:** apply-lock TOCTOU race + scanner false-positive tightening ([#395](https://github.com/amplitude/wizard/issues/395)) ([eee34ea](https://github.com/amplitude/wizard/commit/eee34ead060f87a0fc59794903b2c63aaef85959))
* slash command menu only fires when input begins with a known command ([#351](https://github.com/amplitude/wizard/issues/351)) ([7dedba5](https://github.com/amplitude/wizard/commit/7dedba525c645703741a384d9402ae2458b23f8f))
* three correctness/UX bugs from post-launch hunt ([#409](https://github.com/amplitude/wizard/issues/409)) ([2fa7c57](https://github.com/amplitude/wizard/commit/2fa7c57b51d3b8bab8344669cefcb1537667a88d))
* **tui:** probe TTY before applying theme + reset on signal exits ([#429](https://github.com/amplitude/wizard/issues/429)) ([2edc2d4](https://github.com/amplitude/wizard/commit/2edc2d4f3b503c991143df95a45a3ec084704831))
* **tui:** surface async effect errors and stop feedback-timer races ([#427](https://github.com/amplitude/wizard/issues/427)) ([316a528](https://github.com/amplitude/wizard/commit/316a5286ab47041334173da9335cd11e3b6ff591))
* **windows:** resolve .cmd shims via cross-spawn + drop unzip CLI for adm-zip ([#397](https://github.com/amplitude/wizard/issues/397)) ([7119d65](https://github.com/amplitude/wizard/commit/7119d655401bdc059d66adf80cb1cf7d79076371))
* **wizard:** seven correctness bugs across credential + ingestion paths ([#389](https://github.com/amplitude/wizard/issues/389)) ([ffe16f9](https://github.com/amplitude/wizard/commit/ffe16f90b14c4f636afbdcd427fa2b57632e78ab))


### Performance Improvements

* **agent:** cache the first user message so turn 2+ pays 0.1× input cost ([#431](https://github.com/amplitude/wizard/issues/431)) ([8cca212](https://github.com/amplitude/wizard/commit/8cca212e5e2e1833a797d52982d53ada2a407f51))
* **agent:** parallelize PreToolUse/PostToolUse hook observers ([#421](https://github.com/amplitude/wizard/issues/421)) ([528723b](https://github.com/amplitude/wizard/commit/528723b2605a6a81b75e89b7a9db15d688e5c7f1))
* extract deps-free helpers for framework detection cold path ([#404](https://github.com/amplitude/wizard/issues/404)) ([116b5e9](https://github.com/amplitude/wizard/commit/116b5e98694ed1aa5c4deaa2b6414a2a6590b5cf))
* **mcp:** cache MCP session per token+url + cut fallback timeout 30s→12s ([#435](https://github.com/amplitude/wizard/issues/435)) ([682e3ae](https://github.com/amplitude/wizard/commit/682e3ae354176cd402f48ec9ad765fb3a4116d60))
* **startup:** batch cold-start tail fixes (dotenv guard, sentinel, inline node check) ([#428](https://github.com/amplitude/wizard/issues/428)) ([531dea7](https://github.com/amplitude/wizard/commit/531dea71dec3da907b8def1d1933a6809f1b7898))
* **startup:** lazy-load @sentry/node + drop zod from context.ts ([#398](https://github.com/amplitude/wizard/issues/398)) ([ac7828b](https://github.com/amplitude/wizard/commit/ac7828be201d1d9aced89679a84824d26ec3e515))
* **startup:** lazy-load AgentUI in bin.ts (saves ~80–150 ms cold start) ([#425](https://github.com/amplitude/wizard/issues/425)) ([5cb5cbb](https://github.com/amplitude/wizard/commit/5cb5cbb7dcd52db3e6df76c851f6b1cf6a02fbec))
* **tui:** gate DissolveTransition + slightly faster default tick ([#437](https://github.com/amplitude/wizard/issues/437)) ([b330781](https://github.com/amplitude/wizard/commit/b330781e731acc7883fff6c35ce486e82d3ef957))

## [1.10.0](https://github.com/amplitude/wizard/compare/wizard-v1.9.0...wizard-v1.10.0) (2026-04-30)


### Features

* **agent-ux:** top-notch agent setup UX for launch ([#381](https://github.com/amplitude/wizard/issues/381)) ([b83903b](https://github.com/amplitude/wizard/commit/b83903b3071561a55745121ff03c16d10e43ce6f))
* **auth:** support AMPLITUDE_WIZARD_PROXY_BEARER env-var separation ([#380](https://github.com/amplitude/wizard/issues/380)) ([97355ab](https://github.com/amplitude/wizard/commit/97355ab03dee73c88c76f1e94543ff00b6330d7b))
* internal --mode flag for agent model tier (hidden from --help) ([#376](https://github.com/amplitude/wizard/issues/376)) ([fb55fcc](https://github.com/amplitude/wizard/commit/fb55fcc38bcfa4829b732184e68d0ef54ffda435))


### Bug Fixes

* **auth:** drop OS keychain backend + clean up gitignore ([#384](https://github.com/amplitude/wizard/issues/384)) ([0d1bf30](https://github.com/amplitude/wizard/commit/0d1bf30c486fe1f997a770306d558800201d820d))
* **auth:** resilient returning-user auth + always-actionable AuthScreen ([#383](https://github.com/amplitude/wizard/issues/383)) ([9cdeb88](https://github.com/amplitude/wizard/commit/9cdeb88f128e9390ac9dd941c378d101c1bfd2f2))
* move dashboard creation out of agent loop; stop false-positive ingestion ([#154](https://github.com/amplitude/wizard/issues/154)) ([006d130](https://github.com/amplitude/wizard/commit/006d1304c5f121f7db63dbbfdd79d105985babbc))
* **tui:** run-screen status, cancel-outro exit, intro warning cleanup ([#379](https://github.com/amplitude/wizard/issues/379)) ([716a7dd](https://github.com/amplitude/wizard/commit/716a7ddc7b4dd609f92818ed0048eb7a3e46fda0))

## [1.9.0](https://github.com/amplitude/wizard/compare/wizard-v1.8.1...wizard-v1.9.0) (2026-04-29)


### Features

* **safety:** L2 scanner for destructive bash + hardcoded secrets ([#377](https://github.com/amplitude/wizard/issues/377)) ([c700892](https://github.com/amplitude/wizard/commit/c700892eadcaa464e8c80f77fa4537fa96a23806))
* **tui:** real-time per-file write activity panel in RunScreen ([#371](https://github.com/amplitude/wizard/issues/371)) ([f736a71](https://github.com/amplitude/wizard/commit/f736a7123cfa86ec238da83432f1f43049df8c7a))


### Bug Fixes

* **agent:** make --agent NDJSON contract reliable for orchestrators ([#367](https://github.com/amplitude/wizard/issues/367)) ([35ef309](https://github.com/amplitude/wizard/commit/35ef309fe3e7439a3488faca90de5c188d9a766e))
* **agent:** slim environment_selection NDJSON + add silent-refresh tests ([#378](https://github.com/amplitude/wizard/issues/378)) ([b9d2e62](https://github.com/amplitude/wizard/commit/b9d2e62ec088c5a7e9941c52c774f0a00f12cb68))
* **auth:** persist rotated id_token on silent refresh + accurate auth_required reason ([#373](https://github.com/amplitude/wizard/issues/373)) ([b4fe173](https://github.com/amplitude/wizard/commit/b4fe1736cd0f6f4d86f382200ba0675692641d15))
* **auth:** source stored expiresAt from id_token JWT exp + 3-way auth_required reason ([#375](https://github.com/amplitude/wizard/issues/375)) ([a809e3d](https://github.com/amplitude/wizard/commit/a809e3d7fdee4987481a8d28321b2fbb1ab84376))
* thread --install-dir into the TUI store before first render ([#365](https://github.com/amplitude/wizard/issues/365)) ([4ee0912](https://github.com/amplitude/wizard/commit/4ee0912dd8799d4bf74a0b39b8f41354c9dc9d24))


### Performance Improvements

* skip node_modules in python-family detection globs (130x speedup) ([#366](https://github.com/amplitude/wizard/issues/366)) ([59c01e3](https://github.com/amplitude/wizard/commit/59c01e38a819d0b245807f75acb650c7c99107a6))

## [1.8.1](https://github.com/amplitude/wizard/compare/wizard-v1.8.0...wizard-v1.8.1) (2026-04-29)


### Bug Fixes

* **outro:** unblock "Press any key to exit" with hard exit deadline + commandMode reset ([#368](https://github.com/amplitude/wizard/issues/368)) ([5dde591](https://github.com/amplitude/wizard/commit/5dde5914f55296b911f1625cb23dca6c26bf2aa1))
* **tui:** skip RegionSelect for returning users with a stored zone ([#355](https://github.com/amplitude/wizard/issues/355)) ([75a4602](https://github.com/amplitude/wizard/commit/75a460277a5b73a003bfc4a6d025b3a84bedd7fc))


### Performance Improvements

* cut agent latency via 1M context, tool-search deferral, and trimmed commandments ([#363](https://github.com/amplitude/wizard/issues/363)) ([37cc590](https://github.com/amplitude/wizard/commit/37cc590726424a3d02feff05001d1e6466e6f1c8))

## [1.8.0](https://github.com/amplitude/wizard/compare/wizard-v1.7.0...wizard-v1.8.0) (2026-04-29)


### Features

* [BA-35] persist install UUID as Amplitude device_id ([#218](https://github.com/amplitude/wizard/issues/218)) ([64d69f6](https://github.com/amplitude/wizard/commit/64d69f6cb78404f455b44a8efcea98b7e5e9e0fb))
* [BA-61] add reason to wizard-tools calls + wizard_feedback tool ([#324](https://github.com/amplitude/wizard/issues/324)) ([25ce525](https://github.com/amplitude/wizard/commit/25ce525126182d2e2e5df624c5b2048faa27f580))
* **agent:** typed UI-hint protocol on needs_input + projects list command ([#299](https://github.com/amplitude/wizard/issues/299)) ([8fc25a9](https://github.com/amplitude/wizard/commit/8fc25a9cc03e5f21be57318f6a0b34f461f26c14))
* **agent:** wire AgentState persistence + inner-lifecycle hooks (Bet 2 slice 11) ([#288](https://github.com/amplitude/wizard/issues/288)) ([a86d6bb](https://github.com/amplitude/wizard/commit/a86d6bb924843357d010d55fb3a43d912f485893))
* **analytics:** per-run x-amp-wizard-session-id for Agent Analytics ([#357](https://github.com/amplitude/wizard/issues/357)) ([a204e5f](https://github.com/amplitude/wizard/commit/a204e5f72c991edb2bda124d387e45d6ada05eff))
* auto-enable autocapture + SR + G&S for unified browser SDK projects ([#313](https://github.com/amplitude/wizard/issues/313)) ([5bb1264](https://github.com/amplitude/wizard/commit/5bb126438ab771fefdac30021761e307e93be368))
* commit instrumented events to tracking plan as planned ([#167](https://github.com/amplitude/wizard/issues/167)) ([9dad02f](https://github.com/amplitude/wizard/commit/9dad02f03258f44b163e02eb042b843d71e7b307))
* consent-gated diagnostics on /feedback (MCP-163) ([#192](https://github.com/amplitude/wizard/issues/192)) ([a9e60c3](https://github.com/amplitude/wizard/commit/a9e60c3da530c09a044bcbd1f5efee7b34ce59c8))
* guarantee amplitude-setup-report.md on every successful run ([#327](https://github.com/amplitude/wizard/issues/327)) ([fd12ae7](https://github.com/amplitude/wizard/commit/fd12ae7e2958abe771736d6bf2aacb63809694f5))
* hide command bar on intro and make /region fully swap API host ([#156](https://github.com/amplitude/wizard/issues/156)) ([8ba23d5](https://github.com/amplitude/wizard/commit/8ba23d5db7549272e8282ad42a0eb0bd863cf91c))
* **observability:** instrument MCP servers + token measurements via Sentry ([#292](https://github.com/amplitude/wizard/issues/292)) ([b4f748d](https://github.com/amplitude/wizard/commit/b4f748d5a0801a3a7b7584d20c18aaf12e93486f))
* outro polish, setup-report archive, stable task counter ([#316](https://github.com/amplitude/wizard/issues/316)) ([10bf016](https://github.com/amplitude/wizard/commit/10bf016b3baf3e9bb3de8ee9979473f7ccdd379d))
* pre-stage skills + Title-Case event names + instrumentation gates ([#320](https://github.com/amplitude/wizard/issues/320)) ([107a429](https://github.com/amplitude/wizard/commit/107a429843e28153a82bada73228df9448ecfcdc))
* **tui:** add Esc-based back navigation through wizard decisions ([#301](https://github.com/amplitude/wizard/issues/301)) ([1f9e218](https://github.com/amplitude/wizard/commit/1f9e21810a4514f80002c5c9883359d45b87e915))
* **tui:** coach users when long-running screens take longer than expected ([#342](https://github.com/amplitude/wizard/issues/342)) ([e1cc2a9](https://github.com/amplitude/wizard/commit/e1cc2a951c9b391b07b9088fd8677779f55b16a9))
* **tui:** error-outro recovery actions + last-used persistence ([#303](https://github.com/amplitude/wizard/issues/303)) ([f53b057](https://github.com/amplitude/wizard/commit/f53b057e69886e30e4776fdb17dfa2acb0e5596d))


### Bug Fixes

* **agent:** detect Anthropic gateway 401 patterns as auth errors ([#318](https://github.com/amplitude/wizard/issues/318)) ([09d8dfb](https://github.com/amplitude/wizard/commit/09d8dfb7417636b265954f8cd8e2ed7cc78aa902))
* **async:** bound fetch() callsites with timeouts and clear stranded Promise.race timers ([#334](https://github.com/amplitude/wizard/issues/334)) ([fe5b7a0](https://github.com/amplitude/wizard/commit/fe5b7a0dd932b00383915a2ce677659c943bb6d7))
* **async:** wire SIGINT to AbortController across agent + MCP and make graceful-exit idempotent ([#341](https://github.com/amplitude/wizard/issues/341)) ([4d6f5f4](https://github.com/amplitude/wizard/commit/4d6f5f45205a7c8b3ee39087c75d49d3e73f07cc))
* **auth:** clean up OAuth callback server on timeout/abort and pick a dynamic port for concurrent runs ([#339](https://github.com/amplitude/wizard/issues/339)) ([debbbbf](https://github.com/amplitude/wizard/commit/debbbbfe1ebb4341c4ff647337f3e4424b18bd14))
* **auth:** scope getStoredToken lookup to the requested zone ([#345](https://github.com/amplitude/wizard/issues/345)) ([98a1583](https://github.com/amplitude/wizard/commit/98a15835602ca76dac8d6816f1fe47707636ade6))
* **claude-settings:** scope wizard env to settings.local.json instead of nuking the user's settings ([#349](https://github.com/amplitude/wizard/issues/349)) ([cccd175](https://github.com/amplitude/wizard/commit/cccd1759e3cc284c94d7ec847eef7ff7aaa4f4a1))
* **commandments:** break agent's bash-deny retry loop + forbid runtime env verify ([#330](https://github.com/amplitude/wizard/issues/330)) ([d5ef159](https://github.com/amplitude/wizard/commit/d5ef15943bc610e2d06caee49d9037f82ef5d77b))
* **commandments:** forbid installing non-Amplitude packages ([#328](https://github.com/amplitude/wizard/issues/328)) ([4834eae](https://github.com/amplitude/wizard/commit/4834eaed1220229f32ccc84a6e0445019bba525a))
* **commandments:** inline browser API key unless framework has a clean env convention ([#329](https://github.com/amplitude/wizard/issues/329)) ([e3b8bf9](https://github.com/amplitude/wizard/commit/e3b8bf95a993685a1e866e8f4be8d40e808088e3))
* **commandments:** plan TodoWrite tasks upfront, don't grow mid-run ([#315](https://github.com/amplitude/wizard/issues/315)) ([94401bf](https://github.com/amplitude/wizard/commit/94401bf85150ae9ceaf139fea96773af5ca3c563))
* **cross-platform:** replace hardcoded /tmp paths with os.tmpdir() so wizard works on Windows ([#333](https://github.com/amplitude/wizard/issues/333)) ([40d9614](https://github.com/amplitude/wizard/commit/40d96141ec0bd674c4fa9a3dcce3f85a79930a36))
* don't throw away the run when MCP fails late ([#344](https://github.com/amplitude/wizard/issues/344)) ([51fba52](https://github.com/amplitude/wizard/commit/51fba5271f9e9e1fddacb6a2b5e05c0005e9af5f))
* **eu:** pass zone to in-run token refresh + pin agent to wizard's project + region ([#348](https://github.com/amplitude/wizard/issues/348)) ([b7370d4](https://github.com/amplitude/wizard/commit/b7370d430f2304d1a26bdc3d25ead68a9e82aa37))
* gracefully handle late-stage API errors so users see the Outro ([#331](https://github.com/amplitude/wizard/issues/331)) ([6c5f0af](https://github.com/amplitude/wizard/commit/6c5f0af98a7fa9803501f9406421063225264302))
* **mcp:** support Cursor on Linux ([#332](https://github.com/amplitude/wizard/issues/332)) ([22ff61b](https://github.com/amplitude/wizard/commit/22ff61b792a22b92ed1ad97deeaf611fafe05187))
* Next.js surface detection, stale-activation guard, lint-phase scope ([#346](https://github.com/amplitude/wizard/issues/346)) ([85549b1](https://github.com/amplitude/wizard/commit/85549b1087f3fa78fe9ee421ac90116cf0eee10f))
* **observability:** preserve report_status detail in wizardAbort context ([#326](https://github.com/amplitude/wizard/issues/326)) ([aeec14e](https://github.com/amplitude/wizard/commit/aeec14e9e39d8f216a13b9f8f9e744b45a394016))
* **observability:** suppress hook-bridge-race stderr noise from CLI subprocess ([#317](https://github.com/amplitude/wizard/issues/317)) ([8bc31e3](https://github.com/amplitude/wizard/commit/8bc31e3efa2b9c3ca5dd9efb781d9d07fc78eb07))
* **observability:** swallow EPIPE on stdout/stderr to prevent crashes ([#321](https://github.com/amplitude/wizard/issues/321)) ([50874a5](https://github.com/amplitude/wizard/commit/50874a54c192e608a0191dd76a6cb42267b39779))
* **plan:** lock TodoWrite to 5 user-visible steps; disable thinking ([#347](https://github.com/amplitude/wizard/issues/347)) ([635eb73](https://github.com/amplitude/wizard/commit/635eb7340a12935f2bb197a07ffa65f14785935c))
* recover from stale macOS keychain search-list entries ([#361](https://github.com/amplitude/wizard/issues/361)) ([60d5f58](https://github.com/amplitude/wizard/commit/60d5f585440cf0086ecbfecdacab1e7f9193c2a4))
* route screen exits through wizardSuccessExit / wizardAbort ([#343](https://github.com/amplitude/wizard/issues/343)) ([760a1a9](https://github.com/amplitude/wizard/commit/760a1a9c1c715a7e933b27f26fc6c83dee06f94a))
* **security:** harden OAuth, command exec, file modes, and skill download ([#335](https://github.com/amplitude/wizard/issues/335)) ([691879a](https://github.com/amplitude/wizard/commit/691879a9d22efcf87391d5d00cb9565a7072c5c1))
* stop localhost:8010 leaking into user-facing setup output ([#312](https://github.com/amplitude/wizard/issues/312)) ([6dd1000](https://github.com/amplitude/wizard/commit/6dd10004856e581d10800581fed79a22773f67fa))
* surface newly created dashboard URL in outro instead of Amplitude Home ([#325](https://github.com/amplitude/wizard/issues/325)) ([e7b28e1](https://github.com/amplitude/wizard/commit/e7b28e1adba0413294877e9d53dbe3ef65bf46c6))
* **tui:** clarify error labels and keybinding hint in log viewer ([#311](https://github.com/amplitude/wizard/issues/311)) ([c57b415](https://github.com/amplitude/wizard/commit/c57b415fb4860ae1d8b9754649888373528e9ac1))
* **tui:** close fs.watch swap race and leaked timers in screen cleanup ([#338](https://github.com/amplitude/wizard/issues/338)) ([c0425ac](https://github.com/amplitude/wizard/commit/c0425accb06dcdf864753ff2bd32ce76d2841a3b))
* **tui:** confirm target directory before any agent run, with inline change + monorepo warnings ([#358](https://github.com/amplitude/wizard/issues/358)) ([ce4f795](https://github.com/amplitude/wizard/commit/ce4f79597c38fb802edd417c31de93ced08cb0cd))
* **tui:** guard mid-run slash commands and rewrite MCP_MISSING copy without internal jargon ([#336](https://github.com/amplitude/wizard/issues/336)) ([e24c557](https://github.com/amplitude/wizard/commit/e24c557c3cd7c287108e64a0acce4a5660fb47d5))
* **tui:** make ActivationOptions debug path honest and verify Slack connection on confirm ([#337](https://github.com/amplitude/wizard/issues/337)) ([ed78fa8](https://github.com/amplitude/wizard/commit/ed78fa85af32976efaac1ffceda3a8a0fa714188))
* **tui:** resolve log path at render time + friendlier empty state ([#322](https://github.com/amplitude/wizard/issues/322)) ([d7eec77](https://github.com/amplitude/wizard/commit/d7eec779abf601bc0df06b4443345388d44f049d))
* **tui:** slash menu mid-sentence + setup-report color leak ([#314](https://github.com/amplitude/wizard/issues/314)) ([96e7115](https://github.com/amplitude/wizard/commit/96e711595a50eb081fccab5b1627e54eee410d96))
* **tui:** unblock dead-end screens with admin-handoff, manual-edit guidance, and Esc cancel ([#340](https://github.com/amplitude/wizard/issues/340)) ([4343aac](https://github.com/amplitude/wizard/commit/4343aacb327d757441b1e02448fb9984bf789eba))

## [1.7.0](https://github.com/amplitude/wizard/compare/wizard-v1.6.0...wizard-v1.7.0) (2026-04-26)


### Features

* **agent:** AMPLITUDE_WIZARD_MAX_TURNS env override for the maxTurns cap ([#291](https://github.com/amplitude/wizard/issues/291)) ([2c304f1](https://github.com/amplitude/wizard/commit/2c304f1ec9d4f4fc921b17efd95864820be36d6c))
* **agent:** generic needs_input NDJSON event + INPUT_REQUIRED exit code ([#253](https://github.com/amplitude/wizard/issues/253)) ([207be5d](https://github.com/amplitude/wizard/commit/207be5dbeee7af1f9e29723173177ff8c1034b65))
* **agent:** inner-agent lifecycle + file_change NDJSON events ([#270](https://github.com/amplitude/wizard/issues/270)) ([31be2eb](https://github.com/amplitude/wizard/commit/31be2ebdfcf7e67032c0b8357356240227304fc1))
* **agent:** runPlan reads pre-existing .amplitude-events.json into the plan ([#295](https://github.com/amplitude/wizard/issues/295)) ([8939987](https://github.com/amplitude/wizard/commit/89399879d173eb5aeccc389edb54bd6746496dcd))
* AgentState recovery bag for PreCompact persistence ([#267](https://github.com/amplitude/wizard/issues/267)) ([e638af4](https://github.com/amplitude/wizard/commit/e638af427110cfdf1900bfbe66f4fc57e9750438))
* **cli:** --auto-approve / --yes / --force capability matrix + write-gate ([#254](https://github.com/amplitude/wizard/issues/254)) ([548617c](https://github.com/amplitude/wizard/commit/548617c3d77941948ea40824adc463258645b893))
* **cli:** plan / apply / verify subcommands with plan persistence ([#269](https://github.com/amplitude/wizard/issues/269)) ([b419869](https://github.com/amplitude/wizard/commit/b419869415a6fa7de99d9bb30ba4fa91bde253e5))
* **mcp:** expose plan / verify on wizard-mcp-server ([#285](https://github.com/amplitude/wizard/issues/285)) ([c503547](https://github.com/amplitude/wizard/commit/c50354728627c667b87cf9d219a01bbe320826d9))
* **observability:** instrument OAuth, MCP, and steps with Sentry spans ([#264](https://github.com/amplitude/wizard/issues/264)) ([8ba1168](https://github.com/amplitude/wizard/commit/8ba11686d2a9d69060f6af01068c268561faa75f))
* structured status reporting via report_status MCP tool ([#172](https://github.com/amplitude/wizard/issues/172)) ([24b0015](https://github.com/amplitude/wizard/commit/24b0015f384db01484e1266e96022adc71b11fa4))
* **tui:** migrate forms to Ink useFocus / useFocusManager ([#251](https://github.com/amplitude/wizard/issues/251)) ([77e8f46](https://github.com/amplitude/wizard/commit/77e8f46702fd5067efd35287853ff754fc310bae))
* **tui:** use measureElement for PickerMenu pagination ([#252](https://github.com/amplitude/wizard/issues/252)) ([c4c3ae1](https://github.com/amplitude/wizard/commit/c4c3ae1950a710728dd887e7652f84f65eac0fcc))
* UserPromptSubmit hydrates recovery note after compaction (Bet 2 slice 4) ([#268](https://github.com/amplitude/wizard/issues/268)) ([2127196](https://github.com/amplitude/wizard/commit/212719699edadf3d150a6c407503b01415fcae49))
* **wizard:** gitignore + always-clean wizard artifacts after a run ([#261](https://github.com/amplitude/wizard/issues/261)) ([177497e](https://github.com/amplitude/wizard/commit/177497e1ef72593002d2637735fca4c49ae7c95c))


### Bug Fixes

* **agent:** allow backgrounded package installs the commandments tell agents to use ([#272](https://github.com/amplitude/wizard/issues/272)) ([dd8e11f](https://github.com/amplitude/wizard/commit/dd8e11fecb2ad8b0cd76048ce1c2f693206212e1))
* **agent:** broaden parseEventPlanContent aliases for skill-shape variations ([#293](https://github.com/amplitude/wizard/issues/293)) ([c40b206](https://github.com/amplitude/wizard/commit/c40b20688c96a0101953b6c4ca8b1beddab4727b))
* **agent:** drain prior Query iterator between retry attempts ([#298](https://github.com/amplitude/wizard/issues/298)) ([09f1822](https://github.com/amplitude/wizard/commit/09f18229c043db3e3baa43fe1f1116888b793380))
* **agent:** re-scan legacy [STATUS] / [ERROR-*] text markers for skill backwards compat ([#273](https://github.com/amplitude/wizard/issues/273)) ([4a945b5](https://github.com/amplitude/wizard/commit/4a945b55a23defa13cac08d7923a7a5f2b4d6c80))
* **agent:** ride out gateway 400-terminated cascades ([#266](https://github.com/amplitude/wizard/issues/266)) ([efbe3f5](https://github.com/amplitude/wizard/commit/efbe3f5f4baf204c860e23d10417c474b28706d6))
* **cli:** declare plan-id hidden shadow option for env-var passthrough ([#309](https://github.com/amplitude/wizard/issues/309)) ([6e5cf90](https://github.com/amplitude/wizard/commit/6e5cf90b0dabf672b933eb796682f1b25b927386))
* **copy:** remove misleading "error capture" claims from wizard output ([#276](https://github.com/amplitude/wizard/issues/276)) ([9894a2a](https://github.com/amplitude/wizard/commit/9894a2a3e1618555605592acd38f9184f845e930))
* **observability:** tag stream_closed errors as their own Sentry subtype ([#302](https://github.com/amplitude/wizard/issues/302)) ([460ebd6](https://github.com/amplitude/wizard/commit/460ebd65996c3c1dc0df0af3c07deed27eb4196f))
* **tui:** constrain auth picker menus to content area ([#283](https://github.com/amplitude/wizard/issues/283)) ([0757b11](https://github.com/amplitude/wizard/commit/0757b11389cf56daeff1cd491fa1a937b9e87ce3))
* **tui:** correct off-by-one in LogViewer gutter width and chrome rows ([#294](https://github.com/amplitude/wizard/issues/294)) ([bd0dedb](https://github.com/amplitude/wizard/commit/bd0dedba6ea1621a67889f7433a96c1bd2416c8b))
* **tui:** drop parent color on rendered markdown in Q&A panel ([#277](https://github.com/amplitude/wizard/issues/277)) ([3a17dfe](https://github.com/amplitude/wizard/commit/3a17dfe8b748a2ee433846d628d954baba1baed8))
* **tui:** hang-indent wrapped task labels in ProgressList ([#248](https://github.com/amplitude/wizard/issues/248)) ([d6feab9](https://github.com/amplitude/wizard/commit/d6feab96fa018d6187ba2f5e3e3f85f5fbea3dd7))
* **tui:** improve logs tui navigation and error inspection ([#282](https://github.com/amplitude/wizard/issues/282)) ([6b4cae1](https://github.com/amplitude/wizard/commit/6b4cae157e395292d10e55a40ab40a73ddf3d315))
* **tui:** include FeatureOptIn screen in Setup stepper group ([#281](https://github.com/amplitude/wizard/issues/281)) ([270f54b](https://github.com/amplitude/wizard/commit/270f54b2867b72b009ccb128370ea1a3fc996785))
* **tui:** make Q&A panel dismissable and bound its height ([#278](https://github.com/amplitude/wizard/issues/278)) ([efb9caa](https://github.com/amplitude/wizard/commit/efb9caa428287866ea1740dfa5768dc78f82afec))
* **tui:** move AuthScreen credential persistence out of render path ([#280](https://github.com/amplitude/wizard/issues/280)) ([1ef3960](https://github.com/amplitude/wizard/commit/1ef39604f8205e43b629974bcad2039d3b62f843))
* **tui:** namespace KeyHintBar keys to prevent duplicates ([#279](https://github.com/amplitude/wizard/issues/279)) ([eb9e9e2](https://github.com/amplitude/wizard/commit/eb9e9e2e8de015b4eb0670f5da7bb1a21c120728))
* **tui:** render Tab-to-ask Q&A inline so answers stay visible ([#265](https://github.com/amplitude/wizard/issues/265)) ([c3ee894](https://github.com/amplitude/wizard/commit/c3ee8947a2b427a6c30624cbf50b8509df3d4724))
* **ux:** tame retry banner and improve upstream-error copy ([#286](https://github.com/amplitude/wizard/issues/286)) ([4cbeaa0](https://github.com/amplitude/wizard/commit/4cbeaa0fafc49ed46e5d0c76b9df5683a012ea64))
* **wizard:** preserve .amplitude-events.json + integration skills on cancel/error ([#274](https://github.com/amplitude/wizard/issues/274)) ([5ed8d8b](https://github.com/amplitude/wizard/commit/5ed8d8b0ccad03760c4152fde22c6516a77784c7))


### Performance Improvements

* default NODE_ENV based on installation source (not just unset) ([#249](https://github.com/amplitude/wizard/issues/249)) ([ec01e49](https://github.com/amplitude/wizard/commit/ec01e49354fc60235f5a8c5540adda217535707d))

## [1.6.0](https://github.com/amplitude/wizard/compare/wizard-v1.5.0...wizard-v1.6.0) (2026-04-25)


### Features

* **agent:** wire PreCompact hook + enable extended thinking ([#241](https://github.com/amplitude/wizard/issues/241)) ([d126c75](https://github.com/amplitude/wizard/commit/d126c75132deff6bcbc97d4a55090e7a54d3a664))


### Bug Fixes

* allow React minor/patch versions to dedupe with Ink peer ([#245](https://github.com/amplitude/wizard/issues/245)) ([771b79a](https://github.com/amplitude/wizard/commit/771b79aa6bdb3fb897d3048b35a528d0416443a4))

## [1.5.0](https://github.com/amplitude/wizard/compare/wizard-v1.4.3...wizard-v1.5.0) (2026-04-25)


### Features

* add direct signup via headless provisioning endpoint ([#165](https://github.com/amplitude/wizard/issues/165)) ([15cfb36](https://github.com/amplitude/wizard/commit/15cfb360be9ee87e7e3ae9f68f07418b04c0be52))
* add Guides & Surveys opt-in for browser-based frameworks ([#236](https://github.com/amplitude/wizard/issues/236)) ([62aba2e](https://github.com/amplitude/wizard/commit/62aba2e98a66a28343add16070d7388d45f883f5))
* add Session Replay opt-in for browser-based frameworks ([#206](https://github.com/amplitude/wizard/issues/206)) ([0dfd9a2](https://github.com/amplitude/wizard/commit/0dfd9a2894684e0651ac79f01fca10b9039dcfbe))
* brand frameworks with colored glyphs + emoji at 3 peaks ([#196](https://github.com/amplitude/wizard/issues/196)) ([c52da7a](https://github.com/amplitude/wizard/commit/c52da7afcb5a3577bd7cfec08ff917adf6e4d0b0))
* **cli:** add background update notifier ([#230](https://github.com/amplitude/wizard/issues/230)) ([7449b67](https://github.com/amplitude/wizard/commit/7449b679ea48220468da84aa4de3d67209fd4afd))
* detect dev server port for data-ingestion hint ([#193](https://github.com/amplitude/wizard/issues/193)) ([6f28ed3](https://github.com/amplitude/wizard/commit/6f28ed34e027dc97e72337aabe3787225397110f))
* guide users to pit of success after env-var write ([#202](https://github.com/amplitude/wizard/issues/202)) ([82e73b2](https://github.com/amplitude/wizard/commit/82e73b22e82c968bda79b16a8cd9ded0d16921cb))
* ship Sentry Logs, performance spans, and richer agent events ([#216](https://github.com/amplitude/wizard/issues/216)) ([8dcbbfa](https://github.com/amplitude/wizard/commit/8dcbbfab30b4088c33e500f756248f049a897188))
* surface LLM retry state during agent runs ([#205](https://github.com/amplitude/wizard/issues/205)) ([4c43a2c](https://github.com/amplitude/wizard/commit/4c43a2c8aa66ba963af194b02dee19dd6a8735a7))
* swap framework glyphs to brand emoji ([#200](https://github.com/amplitude/wizard/issues/200)) ([de36988](https://github.com/amplitude/wizard/commit/de36988c430ba4151d053d3de95364e9a6059c04))
* **tui:** add /debug slash command ([#232](https://github.com/amplitude/wizard/issues/232)) ([21e02cc](https://github.com/amplitude/wizard/commit/21e02ccaa02c220c8ff911a028b60c934a2bd03c))
* **tui:** graceful Ctrl+C with save-session banner and confirm-to-exit ([#226](https://github.com/amplitude/wizard/issues/226)) ([ee66f71](https://github.com/amplitude/wizard/commit/ee66f71c4b04c356987789ed12740ed990c25369))
* **tui:** per-screen KeyHintBar registration ([#240](https://github.com/amplitude/wizard/issues/240)) ([448604d](https://github.com/amplitude/wizard/commit/448604d9dea14ade0b66786eae3d0216ab1b43aa))
* **tui:** redacted diagnostic dump on TUI crash ([#238](https://github.com/amplitude/wizard/issues/238)) ([f84c7f3](https://github.com/amplitude/wizard/commit/f84c7f36f67ca1cbcaf38659eed52f0f6061d5e4))
* unlock three underused library features (prompt caching, Static scrollback, strict CLI) ([#227](https://github.com/amplitude/wizard/issues/227)) ([6bda15c](https://github.com/amplitude/wizard/commit/6bda15c9aa908f24ebe0b4ec04b00bf340afe047))


### Bug Fixes

* accept event_name field in .amplitude-events.json ([#201](https://github.com/amplitude/wizard/issues/201)) ([d44778a](https://github.com/amplitude/wizard/commit/d44778a566903c8d097f2bc2011f287fe2a623b5))
* cleanup single-use integration skills on success ([#210](https://github.com/amplitude/wizard/issues/210)) ([fa38462](https://github.com/amplitude/wizard/commit/fa38462dca9cf09cadef9e7801cf6a34fed5ce15))
* **cli:** honor ExitCode in agent mode instead of forcing exit 0 ([#222](https://github.com/amplitude/wizard/issues/222)) ([0e1462c](https://github.com/amplitude/wizard/commit/0e1462c3249cf5b8bce0df781db038f68ac80e22))
* **cli:** honor NO_COLOR, FORCE_COLOR, and non-TTY for chalk output ([#224](https://github.com/amplitude/wizard/issues/224)) ([f54812c](https://github.com/amplitude/wizard/commit/f54812c352fea73840f0127c50a29ba3d9445a0d))
* **cli:** replace shell-interpolated execSync with execFileSync for keychain ops ([#223](https://github.com/amplitude/wizard/issues/223)) ([9795956](https://github.com/amplitude/wizard/commit/9795956dd11cb9137e3c5e59a84677da10131e7d))
* **cli:** route LoggingUI errors and warnings to stderr ([#221](https://github.com/amplitude/wizard/issues/221)) ([6d90958](https://github.com/amplitude/wizard/commit/6d909587b8fea5b028ff098d10903154ef0fc63d))
* **nextjs:** remove unnecessary 15.3.0 minimum version gate ([#228](https://github.com/amplitude/wizard/issues/228)) ([d43a679](https://github.com/amplitude/wizard/commit/d43a679c61119f7f45fd493341f479c8a65b6c56))
* preserve Run screen elapsed timer across tab switches ([#195](https://github.com/amplitude/wizard/issues/195)) ([f7e890d](https://github.com/amplitude/wizard/commit/f7e890dfdbbba7539af6b8868812cdcc413302b1))
* remove shell completions that break sourcing of shell rc ([#194](https://github.com/amplitude/wizard/issues/194)) ([c48a619](https://github.com/amplitude/wizard/commit/c48a619589cd774b7d62b5d418a3acb6dd9103bf))
* tighten event plan description format ([#213](https://github.com/amplitude/wizard/issues/213)) ([6fc72a0](https://github.com/amplitude/wizard/commit/6fc72a0c98d69e50c27dd217a7db775d409eac02))
* **tui:** clear retry banner on first message of recovery attempt ([#233](https://github.com/amplitude/wizard/issues/233)) ([ff9c5ad](https://github.com/amplitude/wizard/commit/ff9c5ad03c08c8dd4de0e27e4a487dd517c5e1f6))
* **tui:** honest framework detection + checkpoint self-heal + intro polish ([#229](https://github.com/amplitude/wizard/issues/229)) ([7b6af9b](https://github.com/amplitude/wizard/commit/7b6af9b5f8ccde15496fb60536f13ea2fc0678a9))
* **tui:** promote Colors.muted to WCAG AA contrast on dark background ([#225](https://github.com/amplitude/wizard/issues/225)) ([683230f](https://github.com/amplitude/wizard/commit/683230ff2ff418b2cdca79f59428eb496643b007))

## [1.4.3](https://github.com/amplitude/wizard/compare/wizard-v1.4.2...wizard-v1.4.3) (2026-04-21)


### Miscellaneous Chores

* force release 1.4.3 to validate OIDC publish ([#190](https://github.com/amplitude/wizard/issues/190)) ([10ba241](https://github.com/amplitude/wizard/commit/10ba241fa6083dc79cc3dca836a57f3c899074ae))

## [1.4.2](https://github.com/amplitude/wizard/compare/wizard-v1.4.1...wizard-v1.4.2) (2026-04-21)


### Bug Fixes

* detect npx invocation when it resolves to a local install ([#183](https://github.com/amplitude/wizard/issues/183)) ([dae9bc9](https://github.com/amplitude/wizard/commit/dae9bc962bc5a928ec5a737d0868758382923ad2))

## [1.4.1](https://github.com/amplitude/wizard/compare/wizard-v1.4.0...wizard-v1.4.1) (2026-04-21)


### Bug Fixes

* detect npx invocation when it resolves to a local install ([#183](https://github.com/amplitude/wizard/issues/183)) ([dae9bc9](https://github.com/amplitude/wizard/commit/dae9bc962bc5a928ec5a737d0868758382923ad2))

## [1.4.0](https://github.com/amplitude/wizard/compare/wizard-v1.3.0...wizard-v1.4.0) (2026-04-18)


### Features

* install Amplitude MCP into 5 more AI coding agents ([54efb42](https://github.com/amplitude/wizard/commit/54efb42fa3c6da234caebad5c2afb4b33e23eda0))


### Bug Fixes

* read options.appName instead of stale options.projectName after yargs rename ([af8a746](https://github.com/amplitude/wizard/commit/af8a746b720ca156ea5fb8356b10dda5f11e6301))
* resolve 4 Cursor Bugbot findings on agent-mode env selection ([49822f9](https://github.com/amplitude/wizard/commit/49822f94a77f91852ce635c9484250fc3f3b6837))
* use matched env's project ID in hydration path and accept old checkpoint key ([68a098b](https://github.com/amplitude/wizard/commit/68a098b093a56a00917b4e82f369bcd32e817c7a))
* use url field for Gemini CLI MCP config and dedupe native-http helper ([fd7ab03](https://github.com/amplitude/wizard/commit/fd7ab03ad1dcd9e9fd62cc3b590f4155cded49a8))

## [1.3.0](https://github.com/amplitude/wizard/compare/wizard-v1.2.0...wizard-v1.3.0) (2026-04-18)


### Features

* --project-name flag for agent + CI modes, NDJSON create-project events ([3038466](https://github.com/amplitude/wizard/commit/303846627eb5e1abf8a62a1e6acacfe64d3a7656))
* add create-project and start-over options to auth picker, stack confirm buttons vertically ([0ff5e8c](https://github.com/amplitude/wizard/commit/0ff5e8c57580d70d03829bbf8bb479714503e98e))
* add createAmplitudeApp helper + exit code for NAME_TAKEN ([4a4a835](https://github.com/amplitude/wizard/commit/4a4a8356acb0e9629ba331088cd688dad21f76a8))
* add observability module with structured logging, Sentry, and analytics audit ([#87](https://github.com/amplitude/wizard/issues/87)) ([961536d](https://github.com/amplitude/wizard/commit/961536d9e89e3e9a11ebcd33dffc8d303ff9eff3))
* add terminal rendering libraries for richer TUI output ([#85](https://github.com/amplitude/wizard/issues/85)) ([0d24d93](https://github.com/amplitude/wizard/commit/0d24d93bcb82f03bddd1c45afce48a6e5458fb72))
* AMP-152511 split dev/prod telemetry keys and adopt space-separated property names ([9005a92](https://github.com/amplitude/wizard/commit/9005a92b05cda118330982bb55bb220f2bd434ef))
* AMP-152511 split dev/prod telemetry keys and adopt space-separated property names ([0dc3593](https://github.com/amplitude/wizard/commit/0dc35938b73ae8e9accf78741c401a34e28290fa))
* auto-install Amplitude Claude Code plugin (AMP-152163) ([882aa33](https://github.com/amplitude/wizard/commit/882aa3335a2a88cb244ee8bdff2cbb3485a51528))
* auto-install Amplitude Claude Code plugin (AMP-152163) ([83d6f50](https://github.com/amplitude/wizard/commit/83d6f505b4557219754940c8916a67640df9a615))
* expose wizard ops over MCP via `amplitude-wizard mcp serve` ([#98](https://github.com/amplitude/wizard/issues/98)) ([5e2450a](https://github.com/amplitude/wizard/commit/5e2450ac24d90236050dcaaf5b611a1364e88e5a))
* inline Create Project flow across TUI / agent / CI modes ([f7cf31a](https://github.com/amplitude/wizard/commit/f7cf31a77b806c2bd5ec488fbdf33cbca771c2fe))
* inline Create Project screen + /create-project slash command ([0a995e6](https://github.com/amplitude/wizard/commit/0a995e680a0d0d24363f0eb0907187703b4053c9))
* link docs on every MCP install success ([13669f6](https://github.com/amplitude/wizard/commit/13669f6f58dd8282f63ffc394d1da013a2227b1b))
* linkify URLs in TUI log viewer and status surfaces ([12bff72](https://github.com/amplitude/wizard/commit/12bff72151be6dfafa060b56d9a33f5d33bfd34c))
* linkify URLs in TUI log viewer and status surfaces ([86093fb](https://github.com/amplitude/wizard/commit/86093fbd29098921565306b671a2a4a6fd089b1d))
* make the wizard agent-native with verbs, JSON output, and CLI manifest ([#95](https://github.com/amplitude/wizard/issues/95)) ([bf82233](https://github.com/amplitude/wizard/commit/bf82233668637140970b01288844ca83da9a12b8))
* **mcp-screen:** auto-copy /mcp + 'o' to launch installed GUI apps ([4f0f451](https://github.com/amplitude/wizard/commit/4f0f451e928ab8c36beebd5c0cec396c008c3fa9))
* **mcp-screen:** let users toggle plugin/MCP for Claude Code with `m` ([3188fbb](https://github.com/amplitude/wizard/commit/3188fbbb1ac5e0f3944f8e2e3f3ed186f01e02bd))
* **mcp-screen:** let users uncheck tools directly in one step ([6aab644](https://github.com/amplitude/wizard/commit/6aab644263d612d6d4b6e572dc7cebf6bada44d7))
* point users to plugin docs + /reload-plugins after install ([08b7740](https://github.com/amplitude/wizard/commit/08b7740968742ab7602285c985326fc25f65b3cf))
* render markdown in Ask-a-question response ([5cb7ef6](https://github.com/amplitude/wizard/commit/5cb7ef67829dbbdfa7fd9b3d0acbba29d111349f))
* restore logo animation on RunScreen, driven by spinner tick ([#83](https://github.com/amplitude/wizard/issues/83)) ([25e0182](https://github.com/amplitude/wizard/commit/25e0182e08d8b369cb8af99819f892480021ae26))
* structured env selection and disambiguation flags for agent mode ([#100](https://github.com/amplitude/wizard/issues/100)) ([de5c2ee](https://github.com/amplitude/wizard/commit/de5c2eeb5a5151786e856f6ecea825793229cd3f))
* upgrade agent SDK and harden Vertex AI resilience ([#90](https://github.com/amplitude/wizard/issues/90)) ([3c47ade](https://github.com/amplitude/wizard/commit/3c47ade9c5ca11d329f32cebffe7ae1efaae0723))


### Bug Fixes

* accept IDs as alternative identity in Auth gate ([52804d4](https://github.com/amplitude/wizard/commit/52804d44f8c2d9036d8ccd94bdcd5e588598b84d))
* actually honor the `m` toggle in proceedWithNames ([22eecb0](https://github.com/amplitude/wizard/commit/22eecb04a1bc8b6bc16a1c546a23935edfb64229))
* address bugbot findings — scrub Thunder codename and rename slack_outcome ([8ad38d5](https://github.com/amplitude/wizard/commit/8ad38d50d99b3474a917bccb115cf8a3a6e355bd))
* address bugbot findings on auth picker PR ([d31cb82](https://github.com/amplitude/wizard/commit/d31cb8240870c0211dadedf43180782033629366))
* address Bugbot review comments on PR [#110](https://github.com/amplitude/wizard/issues/110) ([7917949](https://github.com/amplitude/wizard/commit/79179492bff9d78c407940bf1eac77bfe531832c))
* address second round of bugbot findings ([ce2d988](https://github.com/amplitude/wizard/commit/ce2d988f344110749b4137a39516dbee91800a41))
* align Amplitude Node SDK usage with best practices for CLI lifecycle ([#93](https://github.com/amplitude/wizard/issues/93)) ([201ad3b](https://github.com/amplitude/wizard/commit/201ad3bece3f49b2d126411b03c1d26a002a5b68))
* align identify property casing with main product and add groupIdentify ([#89](https://github.com/amplitude/wizard/issues/89)) ([c1dbc29](https://github.com/amplitude/wizard/commit/c1dbc2979689a2e6209b4f3de023557af321540f))
* allow nested Claude Code / Agent SDK invocation by default ([#102](https://github.com/amplitude/wizard/issues/102)) ([60ee812](https://github.com/amplitude/wizard/commit/60ee8126e60d0539fe8b63434011a077f5c26679))
* AMP-152519 drop autocapture-covered events from the instrumentation plan ([e4e9fb8](https://github.com/amplitude/wizard/commit/e4e9fb89280331252ff02b4cabd71d268af810eb))
* AMP-152519 drop autocapture-covered events from the instrumentation plan ([1d56b72](https://github.com/amplitude/wizard/commit/1d56b72acde7a11d802e9f1f77a87391fa0caef9))
* **ci:** force platform=darwin in Codex bundled-path test ([0e4c484](https://github.com/amplitude/wizard/commit/0e4c484d5420b55a5d7396ca051820694ddfa1d3))
* **ci:** readonly tuple cast in post-install-helpers tripped tsc ([949e4a7](https://github.com/amplitude/wizard/commit/949e4a7b27daf23793e6f65a5cc41af753fa3f98))
* condition the autocapture rule on whether autocapture is actually enabled ([6413bce](https://github.com/amplitude/wizard/commit/6413bce7f4f70195a8acd9bfcc10d14decde7e4d))
* detect AI tools by user-data dir, not just platform ([5d20980](https://github.com/amplitude/wizard/commit/5d20980a09072fd14fb72c8b6ecdbfbcd9177fa8))
* don't short-circuit to plugin when --local remove is requested ([ebf23f5](https://github.com/amplitude/wizard/commit/ebf23f51348cd0a4938d27424f12a507f717a7ac))
* force MCP mode under --local-mcp (plugin is prod-only) ([898ad2a](https://github.com/amplitude/wizard/commit/898ad2ac246618c8a737ad08f67511d549b1c391))
* make env name optional for Auth and resolve it by key match ([b199579](https://github.com/amplitude/wizard/commit/b19957900a8940ba3d7b563a3bea43cfd1f3411d))
* make plugin install visible before user confirms ([d432687](https://github.com/amplitude/wizard/commit/d4326876357e3e9fb2ac6a293abcf834b220670c))
* **mcp-screen:** 3 UX bugs — stalling spinner, vague title, overlay hijack ([72b81eb](https://github.com/amplitude/wizard/commit/72b81eb4ab8a0f00fae95b9b4eb1939db6487ae7))
* **mcp-screen:** declare phase/setTick before the tick useEffect uses them ([b934296](https://github.com/amplitude/wizard/commit/b9342960064bc67dc016ab5678e99a2c0f03b827))
* **mcp-screen:** stop auto-ejecting the Done screen; spinner on Detecting ([57bca8f](https://github.com/amplitude/wizard/commit/57bca8fa53b93e600d0091a7e5144cd8285ecdc3))
* **mcp-screen:** unified next-steps, wait-for-Enter, elapsed time ([f8242ad](https://github.com/amplitude/wizard/commit/f8242ad0b6d3ea018244d5a6e9d0d28ffb3d967c))
* **mcp-screen:** use ref for per-client progress to dodge React batching ([837df1e](https://github.com/amplitude/wizard/commit/837df1e8a75910adf705c20215357d0d91a9087b))
* **pr-112:** address review feedback (defaults, remove path, windows, picker) ([45f34e1](https://github.com/amplitude/wizard/commit/45f34e16dccd38aea56742741b07e9c26d1efed5))
* prevent Node.js CLI projects from being detected as JavaScript Web ([#91](https://github.com/amplitude/wizard/issues/91)) ([b6f7f3e](https://github.com/amplitude/wizard/commit/b6f7f3e803daa2b4b838acc068ee044c36e50106))
* refuse local=true in plugin client (defense in depth) ([7a578da](https://github.com/amplitude/wizard/commit/7a578da9702d24ec04d2aa4dc4e664a03301505e))
* resolve dev-mode proxy bypass and CI silent credential failure ([b59a449](https://github.com/amplitude/wizard/commit/b59a449e3dde215924d9c6fcd92f7499c5a8273f))
* set selectedProjectName in all credential paths to unblock Auth gate ([eb9225e](https://github.com/amplitude/wizard/commit/eb9225e2a0ededbbde1e382d0fbdb0d28d69ce43))
* set workspace name on create-project success so Auth advances ([f6cf1ab](https://github.com/amplitude/wizard/commit/f6cf1abb99bf476352efb89d48f446cb1e12bdbb))
* show project in header and clear all auth state on logout ([2bcf523](https://github.com/amplitude/wizard/commit/2bcf52340135c30bcfa7afcb7135f0ae33561aec))
* show project in header and clear all auth state on logout ([ce37ed0](https://github.com/amplitude/wizard/commit/ce37ed0fe56681cfe1ff36588a2163e0464432c3))
* skip Codex when its binary is bundled by a host app ([9b4dea2](https://github.com/amplitude/wizard/commit/9b4dea29c9d1b6efd753225fd579d84254f6c2d3))
* stop bare-URL pass from swallowing markdown placeholders ([04557fc](https://github.com/amplitude/wizard/commit/04557fc266a529c76bf79297cbaa3387d89e6f30))
* stricter detection for Zed (macOS) and Codex ([502676d](https://github.com/amplitude/wizard/commit/502676daf361ce94b49765c8ddfd3455e27400f1))
* use `claude plugin marketplace add` CLI + surface install errors ([4679fc4](https://github.com/amplitude/wizard/commit/4679fc45bf4290455b5254e055c183ad15139ccd))
* use OAuth access token for project-creation proxy + credentials fallback ([46e54ef](https://github.com/amplitude/wizard/commit/46e54efa0788613f40a114b13393846a2402fc26))


### Performance Improvements

* **mcp-screen:** unblock the event loop during plugin install ([c1d7d42](https://github.com/amplitude/wizard/commit/c1d7d429be2a1d7c7020edbe0b882e12c09bdfc2))
* parallelize MCP client detection + install ([1eefcf1](https://github.com/amplitude/wizard/commit/1eefcf11546545e1978d2c62aeca7053710bbbe2))

## [1.2.0](https://github.com/amplitude/wizard/compare/wizard-v1.1.0...wizard-v1.2.0) (2026-04-15)


### Features

* automate chart and dashboard creation after instrumentation ([33ee119](https://github.com/amplitude/wizard/commit/33ee1190075388286accaee0ae3ffb5895d63a9b))
* automate chart and dashboard creation after instrumentation ([2420fe2](https://github.com/amplitude/wizard/commit/2420fe2e4cd2bb37a3365a34a44ef3f1ef4aab8f))
* bulletproof framework detection ([#73](https://github.com/amplitude/wizard/issues/73)) ([4ddf05f](https://github.com/amplitude/wizard/commit/4ddf05fc5387174fc19828b09630351f1e7f2ee0))
* consolidate skills — context-hub as single source of truth ([103ebdb](https://github.com/amplitude/wizard/commit/103ebdbd131adc1702f7f054d4d51b7544ca341a))
* consolidate skills — context-hub as single source of truth for all skill categories ([0d49ce3](https://github.com/amplitude/wizard/commit/0d49ce34379f633a4f820ff2ff7c6df4d9d88e06))
* data ingestion preview using MCP ([601f589](https://github.com/amplitude/wizard/commit/601f5894bba61445b74f7ba021d883c9e19d3e62))
* MCP event preview in DataIngestionCheckScreen ([1eb642d](https://github.com/amplitude/wizard/commit/1eb642d2af043f9710b48ee5c611d713f6000f19))
* resilient MCP helper with Claude agent fallback ([61339f8](https://github.com/amplitude/wizard/commit/61339f87c06cfa92a87656efe750e43ff7b247d0))


### Bug Fixes

* always capture user ID as analytics distinct ID ([75a6ca6](https://github.com/amplitude/wizard/commit/75a6ca6f7bb5bd6e4ac5a3cdb3ff3b191b4c4f92))
* always capture user ID as analytics distinct ID ([1ec93c0](https://github.com/amplitude/wizard/commit/1ec93c04f814cee534a424e64bc54fb4086af9a7))
* identify users by email and send user properties to telemetry ([3eeab56](https://github.com/amplitude/wizard/commit/3eeab56f6fedeca4681437c54f113de120725268))
* MCP event detection — replace removed query_dataset tool and resolve stale org checkpoint ([4b5813e](https://github.com/amplitude/wizard/commit/4b5813e98b8b4dcf2d7ef0027d0a5fe8a6211866))
* missing MCP notifications/initialized handshake and wrong pendingAuthAccessToken ([0f6126a](https://github.com/amplitude/wizard/commit/0f6126a60b6aee1fad592538c5b941bf23e46cac))

## [1.1.0](https://github.com/amplitude/wizard/compare/wizard-v1.0.0...wizard-v1.1.0) (2026-04-14)


### Features

* add Amplitude Experiment feature flags for LLM and agent analytics ([#35](https://github.com/amplitude/wizard/issues/35)) ([e5f15b9](https://github.com/amplitude/wizard/commit/e5f15b907a0683633a727928940352af6660ab47))
* add Android framework integration ([fa0eb32](https://github.com/amplitude/wizard/commit/fa0eb324162d7cfd6d29a81fd98833ec73e11adf))
* add Flutter framework integration ([1ca0b7e](https://github.com/amplitude/wizard/commit/1ca0b7ea4c78064189c3a81f5e7b9f1321fb04d4))
* add Go framework integration ([ebef028](https://github.com/amplitude/wizard/commit/ebef028057cbbcc86327a17fd4dda99d404352e8))
* add Java (JRE) framework integration ([ef7d6a0](https://github.com/amplitude/wizard/commit/ef7d6a0a9fa3d2cf606db4d066b2d4c28e57d3b3))
* add project/environment picker to auth flow ([d1448cc](https://github.com/amplitude/wizard/commit/d1448ccae5503ffdee12abbe13a888d5ce26ae28))
* add React Native framework integration ([5070e48](https://github.com/amplitude/wizard/commit/5070e4875f341aa13d47d7324d0cc4663159fe01))
* add Swift/iOS framework integration ([e27f9a3](https://github.com/amplitude/wizard/commit/e27f9a391196392649ce1ea966ba0f43d54b72c0))
* add Unity framework integration ([e925a13](https://github.com/amplitude/wizard/commit/e925a13abb3ab2c78015584a9b34c3130952d756))
* add Unreal Engine framework integration ([b59d044](https://github.com/amplitude/wizard/commit/b59d04449740d45066c6f4fc12386267033b4c3c))
* **ci:** optional API key with auto-resolve; drop ISSUES_URL alias ([74df38d](https://github.com/amplitude/wizard/commit/74df38d5f77620f183a03a9ceb15cf5d4395118f))
* detect existing Amplitude installs, add report viewer, improve post-run UX ([970fc01](https://github.com/amplitude/wizard/commit/970fc01768a2cb8222af7d114417a172590057fe))
* direct Slack OAuth integration via App API ([#59](https://github.com/amplitude/wizard/issues/59)) ([626ad8a](https://github.com/amplitude/wizard/commit/626ad8a0bb959a083a45fe6f43a3d501b2b44f95))
* extend already-setup detection to all new frameworks ([441b084](https://github.com/amplitude/wizard/commit/441b084e5ac5bf027fd42c42ee898ebda07435f0))
* fi ([d93a8fb](https://github.com/amplitude/wizard/commit/d93a8fb110a392823f4c2d44c7e03e8903e774c4))
* harden release pipeline with OIDC, provenance, and CODEOWNERS ([#38](https://github.com/amplitude/wizard/issues/38)) ([b82c3a2](https://github.com/amplitude/wizard/commit/b82c3a2a86e38a45cfd800e700d9f5ae70652c59))
* redesign TUI — new visual system, agent mode, session persistence, and UX hardening ([#62](https://github.com/amplitude/wizard/issues/62)) ([9f13c71](https://github.com/amplitude/wizard/commit/9f13c718857c1dab3335ac321e1ccfac9ed2e1bb))
* show org and project name in title bar ([b29f0e8](https://github.com/amplitude/wizard/commit/b29f0e8cdaf10c7ac604662276a665f023499e2a))


### Bug Fixes

* **auth:** auto-fetch project API key after OAuth workspace selection ([799219d](https://github.com/amplitude/wizard/commit/799219dabfec6ce9bbddcc95f2f63abe5dba6171))
* authenticate GitHub API calls in post-welcome CI job ([5f3363e](https://github.com/amplitude/wizard/commit/5f3363e021a8c88e34d8a2c0e310c0cb0d0d7a2a))
* authenticate GitHub API calls in post-welcome CI job ([7d5da12](https://github.com/amplitude/wizard/commit/7d5da127b28493614e87a553c7e1ff3260b565e3))
* correct MCP install configs for Cursor and Claude Desktop ([#57](https://github.com/amplitude/wizard/issues/57)) ([2ecde5b](https://github.com/amplitude/wizard/commit/2ecde5bda410c4f3615fb47f4b4243a3146d4684))
* correct misleading MCP prompt and refresh skills on publish ([#56](https://github.com/amplitude/wizard/issues/56)) ([c5298d5](https://github.com/amplitude/wizard/commit/c5298d5b856ddfd619adee101e35aab531773f24))
* force next release to 1.0.0-beta.3 ([#40](https://github.com/amplitude/wizard/issues/40)) ([85759ac](https://github.com/amplitude/wizard/commit/85759acd1f03a097911be4d8ee23f4c7c54dc21c))
* hardcode VERSION instead of requiring package.json at runtime ([#67](https://github.com/amplitude/wizard/issues/67)) ([55aa462](https://github.com/amplitude/wizard/commit/55aa462da58f03fc16fa32d05aee72e9f5e22d5f))
* hide slash input on intro and collapse logo on small viewports ([#60](https://github.com/amplitude/wizard/issues/60)) ([8b866e8](https://github.com/amplitude/wizard/commit/8b866e8b9fad1efc12aead86575781074913f61e))
* improve RunScreen navigation and add demo mode ([#48](https://github.com/amplitude/wizard/issues/48)) ([f97bb4c](https://github.com/amplitude/wizard/commit/f97bb4c51a428c11cc0f50f25ef3de80a7a80c5e))
* include bundled skills in published package ([#49](https://github.com/amplitude/wizard/issues/49)) ([b2bdc76](https://github.com/amplitude/wizard/commit/b2bdc769d6234b1cae1eb4a0d852cbf122c55bb9))
* merge main and resolve conflicts ([2d92bde](https://github.com/amplitude/wizard/commit/2d92bde9c980d4eebaa9e6d736f58bd42779aeaa))
* move dotenv to dependencies (required at runtime) ([0d9cfc8](https://github.com/amplitude/wizard/commit/0d9cfc89699e220eef4f2d48ec3309a40c8d34f8))
* prevent env picker bypass when workspace ID is pre-populated ([b451a41](https://github.com/amplitude/wizard/commit/b451a412385611ccc8f5cba376c019e51f1b69cf))
* prevent workspace and project pickers from showing simultaneously ([#46](https://github.com/amplitude/wizard/issues/46)) ([aae906c](https://github.com/amplitude/wizard/commit/aae906cad2e49d633fb3cf769a1c69c93e1b5db3))
* remove --provenance flag for internal repo publishing ([#44](https://github.com/amplitude/wizard/issues/44)) ([c90e03b](https://github.com/amplitude/wizard/commit/c90e03b43c55ec85062bef78ff3a759057a96410))
* remove /help BDD scenario after command removal ([9979644](https://github.com/amplitude/wizard/commit/99796448a144ed8dfff85f1d042cff5778ac8242))
* remove vendor leaks and fix inaccurate user-facing strings ([#50](https://github.com/amplitude/wizard/issues/50)) ([fbea036](https://github.com/amplitude/wizard/commit/fbea036b6413f7a4410de9897573e34a64f8c0a0))
* removes new chart query param ([0cb21dd](https://github.com/amplitude/wizard/commit/0cb21dd3eacc2a2e00dcd90840b8ec505a3712a6))
* resolve broken URLs for Slack, chart, and dashboard links ([84d8057](https://github.com/amplitude/wizard/commit/84d8057e976afe7168128606b65233c0b8143480))
* resolve broken URLs for Slack, chart, and dashboard links ([679fd48](https://github.com/amplitude/wizard/commit/679fd487d998dd461c89f84af723d47f387a4fcb))
* show full outro screen on unsupported version, add API key fetch logging ([9b2330e](https://github.com/amplitude/wizard/commit/9b2330eb635892834828d04f90c45cc1b51191cc))
* **smoke-test:** use correct bin name amplitude-wizard ([a50e79b](https://github.com/amplitude/wizard/commit/a50e79ba799b78f033a500165badd413cfef6ebc))
* test release pipeline ([3084c83](https://github.com/amplitude/wizard/commit/3084c83efac24f2ee80f33ae152cf900f13852b9))
* use prerelease versioning strategy for beta releases ([#42](https://github.com/amplitude/wizard/issues/42)) ([dd862d7](https://github.com/amplitude/wizard/commit/dd862d786d68704442759c6820a388fc9a1e162f))
* use WIZARD_WORKBENCH_TOKEN instead of nonexistent app secrets ([7fbd8fb](https://github.com/amplitude/wizard/commit/7fbd8fb9157c553806bcce654e76ccd193560023))

## [1.0.0-beta.6](https://github.com/amplitude/wizard/compare/wizard-v1.0.0-beta.5...wizard-v1.0.0-beta.6) (2026-04-14)


### Features

* fi ([d93a8fb](https://github.com/amplitude/wizard/commit/d93a8fb110a392823f4c2d44c7e03e8903e774c4))


### Bug Fixes

* hardcode VERSION instead of requiring package.json at runtime ([#67](https://github.com/amplitude/wizard/issues/67)) ([55aa462](https://github.com/amplitude/wizard/commit/55aa462da58f03fc16fa32d05aee72e9f5e22d5f))

## [1.0.0-beta.5](https://github.com/amplitude/wizard/compare/wizard-v1.0.0-beta.4...wizard-v1.0.0-beta.5) (2026-04-13)


### Features

* direct Slack OAuth integration via App API ([#59](https://github.com/amplitude/wizard/issues/59)) ([626ad8a](https://github.com/amplitude/wizard/commit/626ad8a0bb959a083a45fe6f43a3d501b2b44f95))
* redesign TUI — new visual system, agent mode, session persistence, and UX hardening ([#62](https://github.com/amplitude/wizard/issues/62)) ([9f13c71](https://github.com/amplitude/wizard/commit/9f13c718857c1dab3335ac321e1ccfac9ed2e1bb))


### Bug Fixes

* correct MCP install configs for Cursor and Claude Desktop ([#57](https://github.com/amplitude/wizard/issues/57)) ([2ecde5b](https://github.com/amplitude/wizard/commit/2ecde5bda410c4f3615fb47f4b4243a3146d4684))
* correct misleading MCP prompt and refresh skills on publish ([#56](https://github.com/amplitude/wizard/issues/56)) ([c5298d5](https://github.com/amplitude/wizard/commit/c5298d5b856ddfd619adee101e35aab531773f24))
* hide slash input on intro and collapse logo on small viewports ([#60](https://github.com/amplitude/wizard/issues/60)) ([8b866e8](https://github.com/amplitude/wizard/commit/8b866e8b9fad1efc12aead86575781074913f61e))
* improve RunScreen navigation and add demo mode ([#48](https://github.com/amplitude/wizard/issues/48)) ([f97bb4c](https://github.com/amplitude/wizard/commit/f97bb4c51a428c11cc0f50f25ef3de80a7a80c5e))
* include bundled skills in published package ([#49](https://github.com/amplitude/wizard/issues/49)) ([b2bdc76](https://github.com/amplitude/wizard/commit/b2bdc769d6234b1cae1eb4a0d852cbf122c55bb9))
* prevent workspace and project pickers from showing simultaneously ([#46](https://github.com/amplitude/wizard/issues/46)) ([aae906c](https://github.com/amplitude/wizard/commit/aae906cad2e49d633fb3cf769a1c69c93e1b5db3))
* remove vendor leaks and fix inaccurate user-facing strings ([#50](https://github.com/amplitude/wizard/issues/50)) ([fbea036](https://github.com/amplitude/wizard/commit/fbea036b6413f7a4410de9897573e34a64f8c0a0))

## [1.0.0-beta.4](https://github.com/amplitude/wizard/compare/wizard-v1.0.0-beta.3...wizard-v1.0.0-beta.4) (2026-04-09)


### Bug Fixes

* remove --provenance flag for internal repo publishing ([#44](https://github.com/amplitude/wizard/issues/44)) ([c90e03b](https://github.com/amplitude/wizard/commit/c90e03b43c55ec85062bef78ff3a759057a96410))

## [1.0.0-beta.3](https://github.com/amplitude/wizard/compare/wizard-v1.0.0-beta.2...wizard-v1.0.0-beta.3) (2026-04-09)


### Features

* add Amplitude Experiment feature flags for LLM and agent analytics ([#35](https://github.com/amplitude/wizard/issues/35)) ([e5f15b9](https://github.com/amplitude/wizard/commit/e5f15b907a0683633a727928940352af6660ab47))
* add Android framework integration ([fa0eb32](https://github.com/amplitude/wizard/commit/fa0eb324162d7cfd6d29a81fd98833ec73e11adf))
* add Flutter framework integration ([1ca0b7e](https://github.com/amplitude/wizard/commit/1ca0b7ea4c78064189c3a81f5e7b9f1321fb04d4))
* add Go framework integration ([ebef028](https://github.com/amplitude/wizard/commit/ebef028057cbbcc86327a17fd4dda99d404352e8))
* add Java (JRE) framework integration ([ef7d6a0](https://github.com/amplitude/wizard/commit/ef7d6a0a9fa3d2cf606db4d066b2d4c28e57d3b3))
* add project/environment picker to auth flow ([d1448cc](https://github.com/amplitude/wizard/commit/d1448ccae5503ffdee12abbe13a888d5ce26ae28))
* add React Native framework integration ([5070e48](https://github.com/amplitude/wizard/commit/5070e4875f341aa13d47d7324d0cc4663159fe01))
* add Swift/iOS framework integration ([e27f9a3](https://github.com/amplitude/wizard/commit/e27f9a391196392649ce1ea966ba0f43d54b72c0))
* add Unity framework integration ([e925a13](https://github.com/amplitude/wizard/commit/e925a13abb3ab2c78015584a9b34c3130952d756))
* add Unreal Engine framework integration ([b59d044](https://github.com/amplitude/wizard/commit/b59d04449740d45066c6f4fc12386267033b4c3c))
* **ci:** optional API key with auto-resolve; drop ISSUES_URL alias ([74df38d](https://github.com/amplitude/wizard/commit/74df38d5f77620f183a03a9ceb15cf5d4395118f))
* detect existing Amplitude installs, add report viewer, improve post-run UX ([970fc01](https://github.com/amplitude/wizard/commit/970fc01768a2cb8222af7d114417a172590057fe))
* extend already-setup detection to all new frameworks ([441b084](https://github.com/amplitude/wizard/commit/441b084e5ac5bf027fd42c42ee898ebda07435f0))
* harden release pipeline with OIDC, provenance, and CODEOWNERS ([#38](https://github.com/amplitude/wizard/issues/38)) ([b82c3a2](https://github.com/amplitude/wizard/commit/b82c3a2a86e38a45cfd800e700d9f5ae70652c59))
* show org and project name in title bar ([b29f0e8](https://github.com/amplitude/wizard/commit/b29f0e8cdaf10c7ac604662276a665f023499e2a))


### Bug Fixes

* **auth:** auto-fetch project API key after OAuth workspace selection ([799219d](https://github.com/amplitude/wizard/commit/799219dabfec6ce9bbddcc95f2f63abe5dba6171))
* authenticate GitHub API calls in post-welcome CI job ([5f3363e](https://github.com/amplitude/wizard/commit/5f3363e021a8c88e34d8a2c0e310c0cb0d0d7a2a))
* authenticate GitHub API calls in post-welcome CI job ([7d5da12](https://github.com/amplitude/wizard/commit/7d5da127b28493614e87a553c7e1ff3260b565e3))
* force next release to 1.0.0-beta.3 ([#40](https://github.com/amplitude/wizard/issues/40)) ([85759ac](https://github.com/amplitude/wizard/commit/85759acd1f03a097911be4d8ee23f4c7c54dc21c))
* merge main and resolve conflicts ([2d92bde](https://github.com/amplitude/wizard/commit/2d92bde9c980d4eebaa9e6d736f58bd42779aeaa))
* move dotenv to dependencies (required at runtime) ([0d9cfc8](https://github.com/amplitude/wizard/commit/0d9cfc89699e220eef4f2d48ec3309a40c8d34f8))
* prevent env picker bypass when workspace ID is pre-populated ([b451a41](https://github.com/amplitude/wizard/commit/b451a412385611ccc8f5cba376c019e51f1b69cf))
* remove /help BDD scenario after command removal ([9979644](https://github.com/amplitude/wizard/commit/99796448a144ed8dfff85f1d042cff5778ac8242))
* removes new chart query param ([0cb21dd](https://github.com/amplitude/wizard/commit/0cb21dd3eacc2a2e00dcd90840b8ec505a3712a6))
* resolve broken URLs for Slack, chart, and dashboard links ([84d8057](https://github.com/amplitude/wizard/commit/84d8057e976afe7168128606b65233c0b8143480))
* resolve broken URLs for Slack, chart, and dashboard links ([679fd48](https://github.com/amplitude/wizard/commit/679fd487d998dd461c89f84af723d47f387a4fcb))
* show full outro screen on unsupported version, add API key fetch logging ([9b2330e](https://github.com/amplitude/wizard/commit/9b2330eb635892834828d04f90c45cc1b51191cc))
* **smoke-test:** use correct bin name amplitude-wizard ([a50e79b](https://github.com/amplitude/wizard/commit/a50e79ba799b78f033a500165badd413cfef6ebc))
* test release pipeline ([3084c83](https://github.com/amplitude/wizard/commit/3084c83efac24f2ee80f33ae152cf900f13852b9))
* use prerelease versioning strategy for beta releases ([#42](https://github.com/amplitude/wizard/issues/42)) ([dd862d7](https://github.com/amplitude/wizard/commit/dd862d786d68704442759c6820a388fc9a1e162f))
* use WIZARD_WORKBENCH_TOKEN instead of nonexistent app secrets ([7fbd8fb](https://github.com/amplitude/wizard/commit/7fbd8fb9157c553806bcce654e76ccd193560023))

## [1.0.0](https://github.com/Amplitude/wizard/releases/tag/v1.0.0) (2026-04-20)

Initial release of the Amplitude Wizard CLI tool. This tool provides a guided setup experience for configuring Amplitude integrations, including authentication, data source selection, and agent configuration. The wizard is designed to simplify the onboarding process and ensure that users can quickly and easily set up their Amplitude integrations with confidence.
