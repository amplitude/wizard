# Changelog

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
* direct Slack OAuth integration via Thunder GraphQL ([#59](https://github.com/amplitude/wizard/issues/59)) ([626ad8a](https://github.com/amplitude/wizard/commit/626ad8a0bb959a083a45fe6f43a3d501b2b44f95))
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

* direct Slack OAuth integration via Thunder GraphQL ([#59](https://github.com/amplitude/wizard/issues/59)) ([626ad8a](https://github.com/amplitude/wizard/commit/626ad8a0bb959a083a45fe6f43a3d501b2b44f95))
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
