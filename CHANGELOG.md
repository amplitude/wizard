# Changelog

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
