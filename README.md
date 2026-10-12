# Zode

**An open-source, login-free community build of [ZCode](https://github.com/zai-org/ZCode).**

English · [简体中文](README.zh-CN.md)

Zode is a community-maintained desktop build of the ZCode AI coding workspace, designed for
**local-first personal use**. It descends from [ZCodium](https://github.com/ZCodium-project/ZCodium)
— the independent security-audit fork of ZCode — keeps ZCodium's audit work (telemetry removed,
vendor services disconnected by default), and goes one step further: the official account/login
layer is removed entirely. A purely local, personal tool has no use for an account system —
that is this project's design intent, not a missing feature.

> Zode is an independent project and is **not affiliated with, sponsored or endorsed by**
> Z.ai / Zhipu or the ZCodium project.

## What's different from official ZCode

|                          | Official ZCode                          | Zode                                                                                                         |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Login / account          | required for parts of the product       | **removed by design** — a local personal tool needs no account; no login, no OAuth                           |
| Vendor platform          | connected                               | **off by default**; each service is an explicit opt-in switch in _Settings → Official services_ (restart required) |
| Telemetry                | vendor pipeline                         | removed (inherited from the ZCodium audit — see their README for specifics)                                   |
| Paid-plan entry points   | shown                                   | hidden                                                                                                        |
| Auto-update              | official channel                        | updater disabled entirely; the built-in version dialog reads public GitHub tags instead                       |
| Extra conveniences       | —                                       | session manager (grouped, paginated, deletable), delete tasks from sidebar menus, memory-file viewer/editor with markdown preview, version & updates dialog |
| Product identity         | ZCode                                   | Zode (`dev.zode.app`)                                                                                         |

The full desktop / browser / terminal product surface is inherited from upstream; Zode only
changes the items above.

## Build from source

Tested on macOS (Apple Silicon). Windows and Linux are untested.

Requirements: [mise](https://mise.jdx.dev/) pins the toolchain (Node 24 + pnpm 10 — see
`mise.toml`).

```bash
pnpm install

# Development (hot reload)
pnpm dev:desktop:test

# Standalone app
ZCODE_ENV=production pnpm --filter @zcode/desktop bundle
# → packages/desktop/dist/mac-arm64/Zode.app
ditto "packages/desktop/dist/mac-arm64/Zode.app" "/Applications/Zode.app"
```

There are no prebuilt releases yet; build from source.

## Data and privacy

- **One shared data directory**: Zode reads and writes `~/.zcode` — the same directory the
  official ZCode client uses. Sessions, memories, settings and credentials are shared, so
  switching between the two apps (or uninstalling the official one) keeps your data intact.
- **No login, no vendor account**: account and OAuth flows are removed by design — Zode is a
  local, personal tool; there is no Zode-specific backend to phone home to.
- **Official endpoints are blocked by default** at the network layer. Everything that talks to
  vendor services (plugin marketplace, official MCP, feedback, coding-plan metering, …) sits
  behind an explicit switch under _Settings → Official services_, disabled unless you enable it.
- **Updates are off**: the app never replaces itself; the version dialog only reads public GitHub
  tags and compares them with your build.

## Status

- Based on the ZCodium v3.14.7 audit source (ZCode 3.14.x line); Zode is maintained as its own
  line on top of that base.
- The project grew out of a personal build and is now maintained in the open. There is no vendor
  backing, so response times to issues vary.

## Credits and license

- [zai-org/ZCode](https://github.com/zai-org/ZCode) — the upstream product, open-sourced by
  Zhipu / Z.ai (Apache-2.0).
- [ZCodium-project/ZCodium](https://github.com/ZCodium-project/ZCodium) — the security-audit
  fork this project is based on (MIT).

Zode's own code is MIT-licensed — see [LICENSE](LICENSE). Portions derived from the projects
above remain under their original licenses: ZCode code under [LICENSE-APACHE](LICENSE-APACHE),
ZCodium code under the MIT license. See [NOTICE.md](NOTICE.md) for the full attribution chain.
