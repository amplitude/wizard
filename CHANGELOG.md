# Changelog

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
