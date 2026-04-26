# Changelog

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
* **agent:** re-scan legacy [STATUS] / [ERROR-*] text markers for skill backwards compat ([#273](https://github.com/amplitude/wizard/issues/273)) ([4a945b5](https://github.com/amplitude/wizard/commit/4a945b55a23defa13cac08d7923a7a5f2b4d6c80))
* **agent:** ride out gateway 400-terminated cascades ([#266](https://github.com/amplitude/wizard/issues/266)) ([efbe3f5](https://github.com/amplitude/wizard/commit/efbe3f5f4baf204c860e23d10417c474b28706d6))
* **copy:** remove misleading "error capture" claims from wizard output ([#276](https://github.com/amplitude/wizard/issues/276)) ([9894a2a](https://github.com/amplitude/wizard/commit/9894a2a3e1618555605592acd38f9184f845e930))
* **tui:** hang-indent wrapped task labels in ProgressList ([#248](https://github.com/amplitude/wizard/issues/248)) ([d6feab9](https://github.com/amplitude/wizard/commit/d6feab96fa018d6187ba2f5e3e3f85f5fbea3dd7))
* **tui:** improve logs tui navigation and error inspection ([#282](https://github.com/amplitude/wizard/issues/282)) ([6b4cae1](https://github.com/amplitude/wizard/commit/6b4cae157e395292d10e55a40ab40a73ddf3d315))
* **tui:** include FeatureOptIn screen in Setup stepper group ([#281](https://github.com/amplitude/wizard/issues/281)) ([270f54b](https://github.com/amplitude/wizard/commit/270f54b2867b72b009ccb128370ea1a3fc996785))
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
