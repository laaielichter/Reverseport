# Changelog

## [1.20.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.19.0...reverseport-1.20.0) (2026-11-09)


### ⚠ BREAKING CHANGES

* **engine:** `reverseport setup` now registers the absolute Node.js runtime and the entry script it runs from instead of `npx -y reverseport@<version> mcp`, following upstream. Existing npx registrations are still recognised; doctor reports them as stale and the next setup rewrites them with a backup.
* **setup:** clients now see the server as "reverseport", so tool names change from mcp__rea__* to mcp__reverseport__*. Rerun `reverseport setup` (or `reverseport update`) to move an existing "rea" registration; permission rules naming mcp__rea__* need updating.
* **engine:** update the deep-analysis engine to REA 6.8.0 ([#59](https://github.com/laaielichter/Reverseport/issues/59))

### Features

* **bench:** add rea-lab's large challenge set to the self-check ([#14](https://github.com/laaielichter/Reverseport/issues/14)) ([73ffed0](https://github.com/laaielichter/Reverseport/commit/73ffed005986ffdebc27a6a4281a4ca01af5e358))
* **browser:** capture one element with a selector (HTML, CSS, cropped image) ([#29](https://github.com/laaielichter/Reverseport/issues/29)) ([dc39066](https://github.com/laaielichter/Reverseport/commit/dc390661eac3c8a3ad13b177323a3d9b223e3e9c))
* **cli:** reverseport skills get prints the guide for this version ([#26](https://github.com/laaielichter/Reverseport/issues/26)) ([dc8095c](https://github.com/laaielichter/Reverseport/commit/dc8095c149398cdd17b8d5bb532e37a588948b7f))
* **engine:** update the deep-analysis engine to REA 6.8.0 ([#59](https://github.com/laaielichter/Reverseport/issues/59)) ([05ed968](https://github.com/laaielichter/Reverseport/commit/05ed96844f1f9a6be318a98cbd4fdf135db84035))
* **engine:** update the deep-analysis engine to REA main 72d5e72e6 ([#127](https://github.com/laaielichter/Reverseport/issues/127)) ([9b28664](https://github.com/laaielichter/Reverseport/commit/9b2866499b79573118782fe6382b3387368dca3e))
* **mcp:** speak MCP 2026-07-28 next to the classic handshake, with tasks for long calls ([#60](https://github.com/laaielichter/Reverseport/issues/60)) ([fc4c7bd](https://github.com/laaielichter/Reverseport/commit/fc4c7bdd892dc45ae0538939f43977d10848d9de))
* **plugin:** list Stashpad and agentdisk in the ReversePort marketplace ([#17](https://github.com/laaielichter/Reverseport/issues/17)) ([469ff3a](https://github.com/laaielichter/Reverseport/commit/469ff3a834f015409846e93221ef683481ca9137))
* **plugin:** publish a slim claude-directory branch for the Claude plugin directory ([#87](https://github.com/laaielichter/Reverseport/issues/87)) ([6f21c3e](https://github.com/laaielichter/Reverseport/commit/6f21c3ef965da988c59abce17fef0a0900c6ca22))
* **plugin:** settings instead of environment variables, and an icon ([#63](https://github.com/laaielichter/Reverseport/issues/63)) ([afb4ccd](https://github.com/laaielichter/Reverseport/commit/afb4ccdb9f1597727493f0d815e4a2e87a387cf8))
* **port:** 20 real-world porting problems — API check, Godot 3→4, saves, shaders, physics, traces, game containers, Godot/IL2CPP/RPG Maker ([#35](https://github.com/laaielichter/Reverseport/issues/35)) ([a6320f8](https://github.com/laaielichter/Reverseport/commit/a6320f8961018584c01e9777651130940c0fc500))
* **port:** accept plain ids for list arguments on the command line ([#12](https://github.com/laaielichter/Reverseport/issues/12)) ([55c826e](https://github.com/laaielichter/Reverseport/commit/55c826e71de7e3117214ff50b8745c75dab74ed7))
* **port:** fewer calls and fewer tokens for agents ([#62](https://github.com/laaielichter/Reverseport/issues/62)) ([1653bec](https://github.com/laaielichter/Reverseport/commit/1653becc6fc3277065d42ad21595941fd50fd512))
* **port:** import maps, pnpm globs, more archives and game libs; safer output budget ([#72](https://github.com/laaielichter/Reverseport/issues/72)) ([9986677](https://github.com/laaielichter/Reverseport/commit/998667705678c40178c33668fa1cad6dd5eda646))
* **port:** optional agentdisk link: workspace disk use in port doctor ([#37](https://github.com/laaielichter/Reverseport/issues/37)) ([528edb0](https://github.com/laaielichter/Reverseport/commit/528edb08d784941a18ec96486022fef7a6814f24))
* **port:** output budget for big results and more forgiving input ([#25](https://github.com/laaielichter/Reverseport/issues/25)) ([a2838d6](https://github.com/laaielichter/Reverseport/commit/a2838d64dfbd753705b7e4ef19d5525d79fcdc64))
* **port:** proof cases, guard hooks and an optional Stashpad link ([#1](https://github.com/laaielichter/Reverseport/issues/1)) ([83d1307](https://github.com/laaielichter/Reverseport/commit/83d13075cebd23f568674b50b90b40fc2bc80acc))
* **port:** re_compare shows .NET type and method changes and the next step ([#64](https://github.com/laaielichter/Reverseport/issues/64)) ([24f2c40](https://github.com/laaielichter/Reverseport/commit/24f2c409f97afdaf339185e13e2ebbc425150b21))
* **port:** resolve Rust use paths, skip build output, keep tests out of the architecture picture ([#27](https://github.com/laaielichter/Reverseport/issues/27)) ([d315e5a](https://github.com/laaielichter/Reverseport/commit/d315e5a7a5b82d0f865ce6e16d2eac99a18d18c5))
* **port:** understand JS/TS monorepos in scan and graph ([#22](https://github.com/laaielichter/Reverseport/issues/22)) ([afcfafb](https://github.com/laaielichter/Reverseport/commit/afcfafb8de49e6662f2f66e07339758798b2daa0))
* **port:** unpack Unity asset bundles and .assets files in re_archive ([#89](https://github.com/laaielichter/Reverseport/issues/89)) ([de173ec](https://github.com/laaielichter/Reverseport/commit/de173ec0ca77c5aa52ef5342291893df166bea7a))
* ready for the MCP directories (Glama, Cline, Anthropic, Docker) ([#69](https://github.com/laaielichter/Reverseport/issues/69)) ([e40fb4e](https://github.com/laaielichter/Reverseport/commit/e40fb4ed095d1e0d75d70fc7699fbe3fbe0b6763))
* recognize Quake PAK archives ([#49](https://github.com/laaielichter/Reverseport/issues/49)) ([26a1054](https://github.com/laaielichter/Reverseport/commit/26a1054fa8215f28af47ae50afc042f10af3120d))
* **setup:** register the MCP server as "reverseport" everywhere ([#91](https://github.com/laaielichter/Reverseport/issues/91)) ([fb429b7](https://github.com/laaielichter/Reverseport/commit/fb429b76db5424e3044c99a5362f0236699f7352))
* **site:** read a real Godot pack field by field, and show proof cases ([#2](https://github.com/laaielichter/Reverseport/issues/2)) ([ed319b7](https://github.com/laaielichter/Reverseport/commit/ed319b711b325ec5f63a62aae3dac04c1d645060))


### Bug Fixes

* **ci:** format the sister tools table and expect plugin.json in release files ([#19](https://github.com/laaielichter/Reverseport/issues/19)) ([20fa708](https://github.com/laaielichter/Reverseport/commit/20fa7082fb0a8c84bcc9e9aa33c135904941ee41))
* **ci:** keep main green across releases ([#21](https://github.com/laaielichter/Reverseport/issues/21)) ([79ec55e](https://github.com/laaielichter/Reverseport/commit/79ec55e52d4058e52e8dc10c8d60947d66c28e1b))
* **ci:** let the repository skill check accept tracked plugin skills ([#9](https://github.com/laaielichter/Reverseport/issues/9)) ([b01784b](https://github.com/laaielichter/Reverseport/commit/b01784b08508a3ff00b35754eccd8d6a97f7b0c4))
* **cli:** keep zod 4.6 defaulted inputs omittable in schemas ([#58](https://github.com/laaielichter/Reverseport/issues/58)) ([374e044](https://github.com/laaielichter/Reverseport/commit/374e044af7d67a31a839a2e7c7e88d651811d696))
* close the two CodeQL alerts and give Chrome more time in CI ([#40](https://github.com/laaielichter/Reverseport/issues/40)) ([a96232f](https://github.com/laaielichter/Reverseport/commit/a96232f0fc5e3a7ba8c55429919e3914d8e0acc4))
* **deps:** bump zod and fast-uri for security advisories ([#53](https://github.com/laaielichter/Reverseport/issues/53)) ([5baa240](https://github.com/laaielichter/Reverseport/commit/5baa24071fe0c427aaeda33b03be496fe3d3a358))
* **deps:** move glob, minimatch, qs and vite to patched versions ([#98](https://github.com/laaielichter/Reverseport/issues/98)) ([a561f5f](https://github.com/laaielichter/Reverseport/commit/a561f5f1a312a3d620220449251b1a4744464e8a))
* **docs:** regenerate the error schema for zod 4.6 ([#57](https://github.com/laaielichter/Reverseport/issues/57)) ([46401b6](https://github.com/laaielichter/Reverseport/commit/46401b67aafc0c508a9c855cc5553ac27d4ae175))
* drop .gitattributes so the Claude plugin directory accepts the repo ([#85](https://github.com/laaielichter/Reverseport/issues/85)) ([b77f3c0](https://github.com/laaielichter/Reverseport/commit/b77f3c0c46ac279bc482adaf67750d0277670991))
* include proof commands in help ([#10](https://github.com/laaielichter/Reverseport/issues/10)) ([fb6564a](https://github.com/laaielichter/Reverseport/commit/fb6564af767d0f8dc201b6fab0e04430e07db06e))
* include proof commands in help ([#8](https://github.com/laaielichter/Reverseport/issues/8)) ([ee9cedd](https://github.com/laaielichter/Reverseport/commit/ee9ceddb8163dcbf3e6626929c99347a722bf620))
* **install:** apply an LF copy of a CRLF dependency patch on Windows ([#93](https://github.com/laaielichter/Reverseport/issues/93)) ([16a2bfb](https://github.com/laaielichter/Reverseport/commit/16a2bfbfde718f672ab25d7bd18e1b578460e326))
* **plugin:** clear the directory's policy holds ([#100](https://github.com/laaielichter/Reverseport/issues/100)) ([005776e](https://github.com/laaielichter/Reverseport/commit/005776ec51b28238e305dd5e6c0a3634e0644e7b))
* **plugin:** display name and listing links for the Claude plugin directory ([#97](https://github.com/laaielichter/Reverseport/issues/97)) ([ced7ba0](https://github.com/laaielichter/Reverseport/commit/ced7ba0651270d11b3b63cf67248ba3fc5555b82))
* **port:** accept workspace names that start with two dots ([#112](https://github.com/laaielichter/Reverseport/issues/112)) ([eb55777](https://github.com/laaielichter/Reverseport/commit/eb55777b7762bd487adc152b4d20b1b78d2233ed))
* **port:** act on agent rating round 4 ([#65](https://github.com/laaielichter/Reverseport/issues/65)) ([f2804de](https://github.com/laaielichter/Reverseport/commit/f2804de49982f5ca2d79dee9e27baf63c09dd8c7))
* **port:** close the CodeQL findings in ReversePort's own code ([#70](https://github.com/laaielichter/Reverseport/issues/70)) ([4c89a00](https://github.com/laaielichter/Reverseport/commit/4c89a00a01dd22aad30547bb12246f89a7a90b3a))
* **scan:** give Android modules a root; detect electron-vite ([#24](https://github.com/laaielichter/Reverseport/issues/24)) ([42626cb](https://github.com/laaielichter/Reverseport/commit/42626cbeb72ce4a5af510bbc8050b5956c83bc06))
* **scripts:** close the CodeQL findings in the test and release scripts ([#67](https://github.com/laaielichter/Reverseport/issues/67)) ([2967bf4](https://github.com/laaielichter/Reverseport/commit/2967bf48ba012eb196bddf31e3b388dd219650df))
* **setup:** describe the Harness server name check as "reverseport" ([#92](https://github.com/laaielichter/Reverseport/issues/92)) ([8136e8d](https://github.com/laaielichter/Reverseport/commit/8136e8dfb719940e110aacbcf6627f742f967149))
* treat npx registrations as current and advertise remaining CLI payload schemas ([#130](https://github.com/laaielichter/Reverseport/issues/130)) ([87d7855](https://github.com/laaielichter/Reverseport/commit/87d785524408ba8f2a71f6062db62bd7243f2726))
* **verify:** follow Claude Code's deferred catalog and persisted results ([#95](https://github.com/laaielichter/Reverseport/issues/95)) ([75a8ce7](https://github.com/laaielichter/Reverseport/commit/75a8ce7a64d291b5b4d3767a550c8c3de33dd3de))
* **verify:** keep TEMP and TMP in isolated Windows verifier environments ([#96](https://github.com/laaielichter/Reverseport/issues/96)) ([fb7b238](https://github.com/laaielichter/Reverseport/commit/fb7b23888ee5be7e610e4551028e6ad23d4043a3))
* **verify:** keep Windows host variables in isolated client verifiers ([#94](https://github.com/laaielichter/Reverseport/issues/94)) ([de1c0c8](https://github.com/laaielichter/Reverseport/commit/de1c0c8e5d6029b326033311a40d3f2d7aa75528))


### Documentation

* add Dutch agent connection guide ([#47](https://github.com/laaielichter/Reverseport/issues/47)) ([f4319b1](https://github.com/laaielichter/Reverseport/commit/f4319b1c9d10cb887b2dbd58fc8cc167e9f0ea4b))
* **agents:** contributors commit under their own name; review bot PRs like any other ([f6240e0](https://github.com/laaielichter/Reverseport/commit/f6240e0196a05caff1d61ea690b77a131976bc34))
* fix letters and leftovers in the Dutch agent guide ([#56](https://github.com/laaielichter/Reverseport/issues/56)) ([5667554](https://github.com/laaielichter/Reverseport/commit/5667554332c516cda170d17654d481e5ce0a06eb))
* **readme:** link the project showcase discussion ([#126](https://github.com/laaielichter/Reverseport/issues/126)) ([ffdd10b](https://github.com/laaielichter/Reverseport/commit/ffdd10bc88f4ee5ec13b662e4866b862b4b6fc10))
* **readme:** move detailed references into linked guides ([ebecfbc](https://github.com/laaielichter/Reverseport/commit/ebecfbc8e27d42c460222942d44c7dfa8d65050c))
* **readme:** update What's new through 1.16 ([#119](https://github.com/laaielichter/Reverseport/issues/119)) ([0a74813](https://github.com/laaielichter/Reverseport/commit/0a748132cb196a266937319844a4849ed77df46c))
* refresh README, site and listing metadata for 1.12 ([#83](https://github.com/laaielichter/Reverseport/issues/83)) ([aaf81c6](https://github.com/laaielichter/Reverseport/commit/aaf81c650e10ad1e5a25dc904d6a1f56c485ebbc))
* show the skills and recent features on the README and the site ([#39](https://github.com/laaielichter/Reverseport/issues/39)) ([37fcbc1](https://github.com/laaielichter/Reverseport/commit/37fcbc1296e34448f6913d40c724acdf8164e487))
* **site:** add a website, a real demo and a sharper README ([aa7384e](https://github.com/laaielichter/Reverseport/commit/aa7384e520056a641b6d2d4e9d5a9ab74c5cb6a9))
* **site:** use the live Pages address ([e861d79](https://github.com/laaielichter/Reverseport/commit/e861d7976606006151109f9ab686e4430b7797d8))
* translate the proof cases guide to Dutch ([#13](https://github.com/laaielichter/Reverseport/issues/13)) ([5c649b3](https://github.com/laaielichter/Reverseport/commit/5c649b34d65706048e016356247cb0b740d7ba65))


### Tests

* **javascript:** compare the #/ import key only with a Node that accepts it ([#34](https://github.com/laaielichter/Reverseport/issues/34)) ([81ea3c5](https://github.com/laaielichter/Reverseport/commit/81ea3c5ac3f3e691ff693453d889c540c7ed14fd))
* **plugin:** measure what the plugin adds with claude plugin eval ([#66](https://github.com/laaielichter/Reverseport/issues/66)) ([f3e12dd](https://github.com/laaielichter/Reverseport/commit/f3e12dd602cbf36c57a8d23e9ef7e691cfafc621))
* **reference:** do not depend on the filesystem's directory order ([#38](https://github.com/laaielichter/Reverseport/issues/38)) ([41bfcbc](https://github.com/laaielichter/Reverseport/commit/41bfcbce21fd15ec26ddcf583ff30edf3781e943))

## [1.19.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.18.0...reverseport-1.19.0) (2026-11-08)


### Bug Fixes

* treat npx registrations as current and advertise remaining CLI payload schemas ([#130](https://github.com/laaielichter/Reverseport/issues/130)) ([87d7855](https://github.com/laaielichter/Reverseport/commit/87d785524408ba8f2a71f6062db62bd7243f2726))

## [1.18.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.17.0...reverseport-1.18.0) (2026-11-08)


### ⚠ BREAKING CHANGES

* **engine:** `reverseport setup` now registers the absolute Node.js runtime and the entry script it runs from instead of `npx -y reverseport@<version> mcp`, following upstream. Existing npx registrations are still recognised; doctor reports them as stale and the next setup rewrites them with a backup.

### Features

* **engine:** update the deep-analysis engine to REA main 72d5e72e6 ([#127](https://github.com/laaielichter/Reverseport/issues/127)) ([9b28664](https://github.com/laaielichter/Reverseport/commit/9b2866499b79573118782fe6382b3387368dca3e))

## [1.17.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.16.0...reverseport-1.17.0) (2026-11-06)


### Documentation

* **readme:** link the project showcase discussion ([#126](https://github.com/laaielichter/Reverseport/issues/126)) ([ffdd10b](https://github.com/laaielichter/Reverseport/commit/ffdd10bc88f4ee5ec13b662e4866b862b4b6fc10))
* **readme:** move detailed references into linked guides ([ebecfbc](https://github.com/laaielichter/Reverseport/commit/ebecfbc8e27d42c460222942d44c7dfa8d65050c))
* **readme:** update What's new through 1.16 ([#119](https://github.com/laaielichter/Reverseport/issues/119)) ([0a74813](https://github.com/laaielichter/Reverseport/commit/0a748132cb196a266937319844a4849ed77df46c))

## [1.16.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.15.0...reverseport-1.16.0) (2026-11-04)


### Bug Fixes

* **port:** accept workspace names that start with two dots ([#112](https://github.com/laaielichter/Reverseport/issues/112)) ([eb55777](https://github.com/laaielichter/Reverseport/commit/eb55777b7762bd487adc152b4d20b1b78d2233ed))


### Documentation

* **agents:** contributors commit under their own name; review bot PRs like any other ([f6240e0](https://github.com/laaielichter/Reverseport/commit/f6240e0196a05caff1d61ea690b77a131976bc34))

## [1.15.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.14.0...reverseport-1.15.0) (2026-11-03)


### ⚠ BREAKING CHANGES

* **setup:** clients now see the server as "reverseport", so tool names change from mcp__rea__* to mcp__reverseport__*. Rerun `reverseport setup` (or `reverseport update`) to move an existing "rea" registration; permission rules naming mcp__rea__* need updating.

### Features

* **port:** unpack Unity asset bundles and .assets files in re_archive ([#89](https://github.com/laaielichter/Reverseport/issues/89)) ([de173ec](https://github.com/laaielichter/Reverseport/commit/de173ec0ca77c5aa52ef5342291893df166bea7a))
* **setup:** register the MCP server as "reverseport" everywhere ([#91](https://github.com/laaielichter/Reverseport/issues/91)) ([fb429b7](https://github.com/laaielichter/Reverseport/commit/fb429b76db5424e3044c99a5362f0236699f7352))


### Bug Fixes

* **deps:** move glob, minimatch, qs and vite to patched versions ([#98](https://github.com/laaielichter/Reverseport/issues/98)) ([a561f5f](https://github.com/laaielichter/Reverseport/commit/a561f5f1a312a3d620220449251b1a4744464e8a))
* **install:** apply an LF copy of a CRLF dependency patch on Windows ([#93](https://github.com/laaielichter/Reverseport/issues/93)) ([16a2bfb](https://github.com/laaielichter/Reverseport/commit/16a2bfbfde718f672ab25d7bd18e1b578460e326))
* **plugin:** clear the directory's policy holds ([#100](https://github.com/laaielichter/Reverseport/issues/100)) ([005776e](https://github.com/laaielichter/Reverseport/commit/005776ec51b28238e305dd5e6c0a3634e0644e7b))
* **plugin:** display name and listing links for the Claude plugin directory ([#97](https://github.com/laaielichter/Reverseport/issues/97)) ([ced7ba0](https://github.com/laaielichter/Reverseport/commit/ced7ba0651270d11b3b63cf67248ba3fc5555b82))
* **setup:** describe the Harness server name check as "reverseport" ([#92](https://github.com/laaielichter/Reverseport/issues/92)) ([8136e8d](https://github.com/laaielichter/Reverseport/commit/8136e8dfb719940e110aacbcf6627f742f967149))
* **verify:** follow Claude Code's deferred catalog and persisted results ([#95](https://github.com/laaielichter/Reverseport/issues/95)) ([75a8ce7](https://github.com/laaielichter/Reverseport/commit/75a8ce7a64d291b5b4d3767a550c8c3de33dd3de))
* **verify:** keep TEMP and TMP in isolated Windows verifier environments ([#96](https://github.com/laaielichter/Reverseport/issues/96)) ([fb7b238](https://github.com/laaielichter/Reverseport/commit/fb7b23888ee5be7e610e4551028e6ad23d4043a3))
* **verify:** keep Windows host variables in isolated client verifiers ([#94](https://github.com/laaielichter/Reverseport/issues/94)) ([de1c0c8](https://github.com/laaielichter/Reverseport/commit/de1c0c8e5d6029b326033311a40d3f2d7aa75528))

## [1.14.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.13.0...reverseport-1.14.0) (2026-11-02)


### Features

* **plugin:** publish a slim claude-directory branch for the Claude plugin directory ([#87](https://github.com/laaielichter/Reverseport/issues/87)) ([af7cdd2](https://github.com/laaielichter/Reverseport/commit/af7cdd2b85ec65d053073bbbd403e98900ee3b0f))


### Bug Fixes

* drop .gitattributes so the Claude plugin directory accepts the repo ([#85](https://github.com/laaielichter/Reverseport/issues/85)) ([8151439](https://github.com/laaielichter/Reverseport/commit/815143990db2fa4c26b5b3513a588c7e80074c85))

## [1.13.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.12.0...reverseport-1.13.0) (2026-11-02)


### Documentation

* refresh README, site and listing metadata for 1.12 ([#83](https://github.com/laaielichter/Reverseport/issues/83)) ([5486b08](https://github.com/laaielichter/Reverseport/commit/5486b08e340928c80c2c22f34d695a85ffa14695))

## [1.12.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.11.0...reverseport-1.12.0) (2026-11-02)


### Features

* **port:** import maps, pnpm globs, more archives and game libs; safer output budget ([#72](https://github.com/laaielichter/Reverseport/issues/72)) ([179d3dd](https://github.com/laaielichter/Reverseport/commit/179d3ddaab1ef9833369ff3681a059edf6e617ea))

## [1.11.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.10.0...reverseport-1.11.0) (2026-11-02)


### ⚠ BREAKING CHANGES

* **engine:** update the deep-analysis engine to REA 6.8.0 ([#59](https://github.com/laaielichter/Reverseport/issues/59))

### Features

* **engine:** update the deep-analysis engine to REA 6.8.0 ([#59](https://github.com/laaielichter/Reverseport/issues/59)) ([47e0347](https://github.com/laaielichter/Reverseport/commit/47e03470da75637667114f5002a137e5ca2c33eb))
* **mcp:** speak MCP 2026-07-28 next to the classic handshake, with tasks for long calls ([#60](https://github.com/laaielichter/Reverseport/issues/60)) ([57752bd](https://github.com/laaielichter/Reverseport/commit/57752bdab79eea17771eca80a45360cfeb13ff98))
* **plugin:** settings instead of environment variables, and an icon ([#63](https://github.com/laaielichter/Reverseport/issues/63)) ([d79a145](https://github.com/laaielichter/Reverseport/commit/d79a145e6cd84171487101ef714a876a3bd4e78a))
* **port:** fewer calls and fewer tokens for agents ([#62](https://github.com/laaielichter/Reverseport/issues/62)) ([ecfa7e9](https://github.com/laaielichter/Reverseport/commit/ecfa7e92c857a509358ee6093e8f0bddacca9874))
* **port:** re_compare shows .NET type and method changes and the next step ([#64](https://github.com/laaielichter/Reverseport/issues/64)) ([68e03e4](https://github.com/laaielichter/Reverseport/commit/68e03e4ca7925e8a1a25c245eeb03d9a182fdaa8))
* ready for the MCP directories (Glama, Cline, Anthropic, Docker) ([#69](https://github.com/laaielichter/Reverseport/issues/69)) ([bcb8622](https://github.com/laaielichter/Reverseport/commit/bcb8622b84898f5a31c8f52f650f197690fc6867))


### Bug Fixes

* **port:** act on agent rating round 4 ([#65](https://github.com/laaielichter/Reverseport/issues/65)) ([37abc00](https://github.com/laaielichter/Reverseport/commit/37abc0062cb18755acbf6c6569227a1e14d1aeec))
* **port:** close the CodeQL findings in ReversePort's own code ([#70](https://github.com/laaielichter/Reverseport/issues/70)) ([2068d8f](https://github.com/laaielichter/Reverseport/commit/2068d8f7b23d2c70ec13a8bccb5eb2d7fe3a75e7))
* **scripts:** close the CodeQL findings in the test and release scripts ([#67](https://github.com/laaielichter/Reverseport/issues/67)) ([b3fd36d](https://github.com/laaielichter/Reverseport/commit/b3fd36dc1884a3c50a965633fa5e1f4eb0f45e12))


### Tests

* **plugin:** measure what the plugin adds with claude plugin eval ([#66](https://github.com/laaielichter/Reverseport/issues/66)) ([b4d4906](https://github.com/laaielichter/Reverseport/commit/b4d4906766fc2114e0d19e43380b1e053b20aa33))

## [1.10.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.9.0...reverseport-1.10.0) (2026-11-01)


### Features

* recognize Quake PAK archives ([#49](https://github.com/laaielichter/Reverseport/issues/49)) ([642e319](https://github.com/laaielichter/Reverseport/commit/642e319987af04ceb449ea8306ffd3a61b252b62))


### Bug Fixes

* **cli:** keep zod 4.6 defaulted inputs omittable in schemas ([#58](https://github.com/laaielichter/Reverseport/issues/58)) ([f3fb878](https://github.com/laaielichter/Reverseport/commit/f3fb8788f6f200d525dc13157c8af183fed816bc))
* **docs:** regenerate the error schema for zod 4.6 ([#57](https://github.com/laaielichter/Reverseport/issues/57)) ([34ea2c2](https://github.com/laaielichter/Reverseport/commit/34ea2c236216fc3cde8e0358265aba68e055b3e0))


### Documentation

* add Dutch agent connection guide ([#47](https://github.com/laaielichter/Reverseport/issues/47)) ([499f340](https://github.com/laaielichter/Reverseport/commit/499f3407741d185de3343327bcb117799ebbde7b))
* fix letters and leftovers in the Dutch agent guide ([#56](https://github.com/laaielichter/Reverseport/issues/56)) ([e9e06d4](https://github.com/laaielichter/Reverseport/commit/e9e06d48a87dee3318bd763639a6f6fefdb167a6))

## [1.9.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.8.0...reverseport-1.9.0) (2026-10-27)


### Bug Fixes

* **deps:** bump zod and fast-uri for security advisories ([#53](https://github.com/laaielichter/Reverseport/issues/53)) ([b79f141](https://github.com/laaielichter/Reverseport/commit/b79f14180bb0e9b17403be5e5ec81cb9287cad2e))

## [1.8.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.7.0...reverseport-1.8.0) (2026-10-20)


### Features

* **bench:** add rea-lab's large challenge set to the self-check ([#14](https://github.com/laaielichter/Reverseport/issues/14)) ([edf46cc](https://github.com/laaielichter/Reverseport/commit/edf46cc4ea22c392efef2183368e8d29b3d8a853))
* **browser:** capture one element with a selector (HTML, CSS, cropped image) ([#29](https://github.com/laaielichter/Reverseport/issues/29)) ([2209d63](https://github.com/laaielichter/Reverseport/commit/2209d6352ef6aca47922294aab39e16107bd6faf))
* **cli:** reverseport skills get prints the guide for this version ([#26](https://github.com/laaielichter/Reverseport/issues/26)) ([2e6f315](https://github.com/laaielichter/Reverseport/commit/2e6f315f46a6c00903b1d3e5cd3e2d34e47716e0))
* **plugin:** list Stashpad and agentdisk in the ReversePort marketplace ([#17](https://github.com/laaielichter/Reverseport/issues/17)) ([140bbb2](https://github.com/laaielichter/Reverseport/commit/140bbb2035ce3ff241803c695011d5004721b865))
* **port:** 20 real-world porting problems — API check, Godot 3→4, saves, shaders, physics, traces, game containers, Godot/IL2CPP/RPG Maker ([#35](https://github.com/laaielichter/Reverseport/issues/35)) ([b43d414](https://github.com/laaielichter/Reverseport/commit/b43d4143a08dee50636f90f8d048215cc29d31b2))
* **port:** accept plain ids for list arguments on the command line ([#12](https://github.com/laaielichter/Reverseport/issues/12)) ([9f5953b](https://github.com/laaielichter/Reverseport/commit/9f5953bb24774bbabc6a1ffb0e0ca457c0d676f2))
* **port:** optional agentdisk link: workspace disk use in port doctor ([#37](https://github.com/laaielichter/Reverseport/issues/37)) ([50dacc1](https://github.com/laaielichter/Reverseport/commit/50dacc11378c28c72a76792334a0e83377bc7e66))
* **port:** output budget for big results and more forgiving input ([#25](https://github.com/laaielichter/Reverseport/issues/25)) ([c2456dd](https://github.com/laaielichter/Reverseport/commit/c2456dd7bd66c06c9b4574d813a45a0afef29879))
* **port:** proof cases, guard hooks and an optional Stashpad link ([#1](https://github.com/laaielichter/Reverseport/issues/1)) ([f204e40](https://github.com/laaielichter/Reverseport/commit/f204e407ea742eae478c74c13d6733ac47713101))
* **port:** resolve Rust use paths, skip build output, keep tests out of the architecture picture ([#27](https://github.com/laaielichter/Reverseport/issues/27)) ([5413c05](https://github.com/laaielichter/Reverseport/commit/5413c05b3026146ef744290bdcd0aecad5b66573))
* **port:** understand JS/TS monorepos in scan and graph ([#22](https://github.com/laaielichter/Reverseport/issues/22)) ([9c9018f](https://github.com/laaielichter/Reverseport/commit/9c9018f959cb7a8938e1f7c11482964670d8ddeb))
* **site:** read a real Godot pack field by field, and show proof cases ([#2](https://github.com/laaielichter/Reverseport/issues/2)) ([ba80c6f](https://github.com/laaielichter/Reverseport/commit/ba80c6f598140741cf93fad3bdb4a4961d83eb5a))


### Bug Fixes

* **ci:** format the sister tools table and expect plugin.json in release files ([#19](https://github.com/laaielichter/Reverseport/issues/19)) ([51a8332](https://github.com/laaielichter/Reverseport/commit/51a83321d3bf8f79a82616c8730ee353cb957d4f))
* **ci:** keep main green across releases ([#21](https://github.com/laaielichter/Reverseport/issues/21)) ([71d0e33](https://github.com/laaielichter/Reverseport/commit/71d0e33b62fa3d4081c8de9e5290d33deec37c6c))
* **ci:** let the repository skill check accept tracked plugin skills ([#9](https://github.com/laaielichter/Reverseport/issues/9)) ([bfd3d2c](https://github.com/laaielichter/Reverseport/commit/bfd3d2c54fdabaeea93c465fa93aa5dcbfac8c42))
* close the two CodeQL alerts and give Chrome more time in CI ([#40](https://github.com/laaielichter/Reverseport/issues/40)) ([db78afc](https://github.com/laaielichter/Reverseport/commit/db78afcf3f0a95d14123a6436b1ba92da87fbc34))
* include proof commands in help ([#10](https://github.com/laaielichter/Reverseport/issues/10)) ([1f60f3e](https://github.com/laaielichter/Reverseport/commit/1f60f3e803ad70c87c682e5fccec6fcf2addecdf))
* include proof commands in help ([#8](https://github.com/laaielichter/Reverseport/issues/8)) ([a5d5498](https://github.com/laaielichter/Reverseport/commit/a5d54985fcdd015b6fbe9cacf37c0fff47158fd2))
* **scan:** give Android modules a root; detect electron-vite ([#24](https://github.com/laaielichter/Reverseport/issues/24)) ([68c5374](https://github.com/laaielichter/Reverseport/commit/68c53742066ddf9bd80cd31d8ee6ea56434b5bc1))


### Documentation

* show the skills and recent features on the README and the site ([#39](https://github.com/laaielichter/Reverseport/issues/39)) ([351d1fd](https://github.com/laaielichter/Reverseport/commit/351d1fddd8394aadd43245c72b113a48e2fb3c68))
* **site:** add a website, a real demo and a sharper README ([d411e40](https://github.com/laaielichter/Reverseport/commit/d411e40dfb43c52a0d2d4e1fe19a170477bfda80))
* **site:** use the live Pages address ([c3e6740](https://github.com/laaielichter/Reverseport/commit/c3e6740549ad0c0580218f319b5156debb23e0bf))
* translate the proof cases guide to Dutch ([#13](https://github.com/laaielichter/Reverseport/issues/13)) ([1b36b05](https://github.com/laaielichter/Reverseport/commit/1b36b057a0b914caa69b2b05f29c43a3f911976f))


### Tests

* **javascript:** compare the #/ import key only with a Node that accepts it ([#34](https://github.com/laaielichter/Reverseport/issues/34)) ([4631d9b](https://github.com/laaielichter/Reverseport/commit/4631d9b1687a2db810376ae54e9d9a087e99bd69))
* **reference:** do not depend on the filesystem's directory order ([#38](https://github.com/laaielichter/Reverseport/issues/38)) ([ffedf61](https://github.com/laaielichter/Reverseport/commit/ffedf617d162c80157b454fb89a769c8c93d8edb))

## [1.7.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.6.0...reverseport-1.7.0) (2026-10-19)


### Features

* **port:** 20 real-world porting problems — API check, Godot 3→4, saves, shaders, physics, traces, game containers, Godot/IL2CPP/RPG Maker ([#35](https://github.com/laaielichter/Reverseport/issues/35)) ([b43d414](https://github.com/laaielichter/Reverseport/commit/b43d4143a08dee50636f90f8d048215cc29d31b2))
* **port:** optional agentdisk link: workspace disk use in port doctor ([#37](https://github.com/laaielichter/Reverseport/issues/37)) ([50dacc1](https://github.com/laaielichter/Reverseport/commit/50dacc11378c28c72a76792334a0e83377bc7e66))


### Bug Fixes

* close the two CodeQL alerts and give Chrome more time in CI ([#40](https://github.com/laaielichter/Reverseport/issues/40)) ([db78afc](https://github.com/laaielichter/Reverseport/commit/db78afcf3f0a95d14123a6436b1ba92da87fbc34))


### Documentation

* show the skills and recent features on the README and the site ([#39](https://github.com/laaielichter/Reverseport/issues/39)) ([351d1fd](https://github.com/laaielichter/Reverseport/commit/351d1fddd8394aadd43245c72b113a48e2fb3c68))


### Tests

* **reference:** do not depend on the filesystem's directory order ([#38](https://github.com/laaielichter/Reverseport/issues/38)) ([ffedf61](https://github.com/laaielichter/Reverseport/commit/ffedf617d162c80157b454fb89a769c8c93d8edb))

## [1.6.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.5.0...reverseport-1.6.0) (2026-10-19)


### Features

* **browser:** capture one element with a selector (HTML, CSS, cropped image) ([#29](https://github.com/laaielichter/Reverseport/issues/29)) ([2209d63](https://github.com/laaielichter/Reverseport/commit/2209d6352ef6aca47922294aab39e16107bd6faf))


### Tests

* **javascript:** compare the #/ import key only with a Node that accepts it ([#34](https://github.com/laaielichter/Reverseport/issues/34)) ([4631d9b](https://github.com/laaielichter/Reverseport/commit/4631d9b1687a2db810376ae54e9d9a087e99bd69))

## [1.5.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.4.0...reverseport-1.5.0) (2026-10-19)


### Features

* **cli:** reverseport skills get prints the guide for this version ([#26](https://github.com/laaielichter/Reverseport/issues/26)) ([2e6f315](https://github.com/laaielichter/Reverseport/commit/2e6f315f46a6c00903b1d3e5cd3e2d34e47716e0))
* **port:** resolve Rust use paths, skip build output, keep tests out of the architecture picture ([#27](https://github.com/laaielichter/Reverseport/issues/27)) ([5413c05](https://github.com/laaielichter/Reverseport/commit/5413c05b3026146ef744290bdcd0aecad5b66573))

## [1.4.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.3.0...reverseport-1.4.0) (2026-10-19)


### Features

* **port:** output budget for big results and more forgiving input ([#25](https://github.com/laaielichter/Reverseport/issues/25)) ([c2456dd](https://github.com/laaielichter/Reverseport/commit/c2456dd7bd66c06c9b4574d813a45a0afef29879))
* **port:** understand JS/TS monorepos in scan and graph ([#22](https://github.com/laaielichter/Reverseport/issues/22)) ([9c9018f](https://github.com/laaielichter/Reverseport/commit/9c9018f959cb7a8938e1f7c11482964670d8ddeb))


### Bug Fixes

* **scan:** give Android modules a root; detect electron-vite ([#24](https://github.com/laaielichter/Reverseport/issues/24)) ([68c5374](https://github.com/laaielichter/Reverseport/commit/68c53742066ddf9bd80cd31d8ee6ea56434b5bc1))

## [1.3.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.2.0...reverseport-1.3.0) (2026-10-19)


### Bug Fixes

* **ci:** format the sister tools table and expect plugin.json in release files ([#19](https://github.com/laaielichter/Reverseport/issues/19)) ([51a8332](https://github.com/laaielichter/Reverseport/commit/51a83321d3bf8f79a82616c8730ee353cb957d4f))
* **ci:** keep main green across releases ([#21](https://github.com/laaielichter/Reverseport/issues/21)) ([71d0e33](https://github.com/laaielichter/Reverseport/commit/71d0e33b62fa3d4081c8de9e5290d33deec37c6c))

## [1.2.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.1.0...reverseport-1.2.0) (2026-10-19)


### Features

* **plugin:** list Stashpad and agentdisk in the ReversePort marketplace ([#17](https://github.com/laaielichter/Reverseport/issues/17)) ([140bbb2](https://github.com/laaielichter/Reverseport/commit/140bbb2035ce3ff241803c695011d5004721b865))

## [1.1.0](https://github.com/laaielichter/Reverseport/compare/reverseport-1.0.0...reverseport-1.1.0) (2026-10-19)


### Features

* **bench:** add rea-lab's large challenge set to the self-check ([#14](https://github.com/laaielichter/Reverseport/issues/14)) ([edf46cc](https://github.com/laaielichter/Reverseport/commit/edf46cc4ea22c392efef2183368e8d29b3d8a853))
* **port:** proof cases, guard hooks and an optional Stashpad link ([#1](https://github.com/laaielichter/Reverseport/issues/1)) ([f204e40](https://github.com/laaielichter/Reverseport/commit/f204e407ea742eae478c74c13d6733ac47713101))
* **site:** read a real Godot pack field by field, and show proof cases ([#2](https://github.com/laaielichter/Reverseport/issues/2)) ([ba80c6f](https://github.com/laaielichter/Reverseport/commit/ba80c6f598140741cf93fad3bdb4a4961d83eb5a))


### Bug Fixes

* **ci:** let the repository skill check accept tracked plugin skills ([#9](https://github.com/laaielichter/Reverseport/issues/9)) ([bfd3d2c](https://github.com/laaielichter/Reverseport/commit/bfd3d2c54fdabaeea93c465fa93aa5dcbfac8c42))
* include proof commands in help ([#10](https://github.com/laaielichter/Reverseport/issues/10)) ([1f60f3e](https://github.com/laaielichter/Reverseport/commit/1f60f3e803ad70c87c682e5fccec6fcf2addecdf))
* include proof commands in help ([#8](https://github.com/laaielichter/Reverseport/issues/8)) ([a5d5498](https://github.com/laaielichter/Reverseport/commit/a5d54985fcdd015b6fbe9cacf37c0fff47158fd2))


### Documentation

* **site:** add a website, a real demo and a sharper README ([d411e40](https://github.com/laaielichter/Reverseport/commit/d411e40dfb43c52a0d2d4e1fe19a170477bfda80))
* **site:** use the live Pages address ([c3e6740](https://github.com/laaielichter/Reverseport/commit/c3e6740549ad0c0580218f319b5156debb23e0bf))

## [1.0.0](https://github.com/laaielichter/reverseport/releases/tag/1.0.0) (2026-10-12)

### Highlights

- **One tool for reverse engineering and porting.** ReversePort now includes a full deep-analysis engine (based on
  REA, MIT): native, managed (.NET), Android, JavaScript/Electron, WebAssembly, firmware, EVM and browser targets
  through Ghidra, Hopper, IDA, JADX, Apktool, adb and more, with evidence for every result.
- **One CLI:** `reverseport`. ReversePort's own commands (`scan`, `lookup`, `binary`, `archive`, `diff`, `report`,
  `blueprint`, `plan`, `verify`, …) run with nothing but Node; the engine commands (`analyze`, `decompile`, `xrefs`,
  `trace`, `inspect-*`, …) run through the same command. `reverseport port help` and `reverseport engine --help`
  list everything.
- **One MCP server:** `reverseport mcp` serves the 21 ReversePort tools and relays every engine tool, prompt and
  resource — progress, cancellation and server requests included. Without a built engine it still starts with
  ReversePort's tools and says how to add the rest.
- **One setup:** `npx reverseport setup` registers the server and installs the skill in Claude Code, Codex, Cursor,
  Gemini CLI, GitHub Copilot, OpenCode and more, with backups. The skill now covers recon without files, clean-room
  rebuilds and porting next to deep analysis.
- MIT licensed and open source.

- **Built for agents, every agent.** A short default tool list with `engine_tools`/`engine_call` for the rest;
  `compact`/`standard`/`full` profiles (`set_tool_profile`); one error shape with a next step on every door; a
  `next` call wherever there is an obvious next step; engine restart after a crash; read-only hints for evidence reads; tool definitions
  for OpenAI (strict), Responses, Anthropic and Gemini; MCP over HTTP; `reverseport connect <client>`;
  `share_feedback` for agents.

### Changes

- ReversePort's engine moved to `port/`; `compare` for builds is now `diff` (`compare-builds`); `install` is replaced
  by `setup`.
- Requires Node.js 22.19 or newer.

## 0.2.0 (2026-10-12)

- `re_lookup`: recon without files from public sources (Steam, PCGamingWiki, Wikidata, App Store, GitHub, the page).
- `re_blueprint`: precise clean-room rebuild specs with parity tables and project skeletons.

## 0.1.0 (2026-10-12)

- First release: 19 tools for recon, binaries, packs, builds and porting between Godot, Unity, Unreal, three.js and
  languages.
