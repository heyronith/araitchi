# Licence exceptions (runtime)

Araitchi itself is **MIT**.

**Policy:** production (`--prod`) dependencies should be **MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC** (and close permissive variants such as 0BSD, BlueOak-1.0.0, CC0 / Unlicense duals). Re-check before each release:

```bash
pnpm licenses list --prod
pnpm audit --prod
```

## Known exceptions (spot-check, v0.1.0 tree)

| Package | Licence | Notes |
| --- | --- | --- |
| `@img/sharp-libvips-darwin-arm64` (and platform siblings via Sharp / Next image pipeline) | **LGPL-3.0-or-later** | Native libvips build pulled in transitively; dynamic-link style use as shipped with Sharp. Not imported directly by Araitchi app code. |
| `caniuse-lite` | **CC-BY-4.0** | Data/tables used by tooling in the Next/browserslist graph; attribution licence, not copyleft on your code. |
| `json-schema` | **AFL-2.1 OR BSD-3-Clause** | Dual-licensed; BSD-3-Clause leg is policy-compatible. |

Dual MIT/CC0 packages (e.g. `type-fest`) are fine under the MIT leg.

If `pnpm licenses list --prod` shows a new non-permissive licence at release time, either replace the dependency, document it in this table with rationale, or block the release until resolved.

## `pnpm audit --prod` (v0.1.0)

No high/critical issues. Open findings (transitive via `shadcn` CLI tooling, not request-path runtime):

| Severity | Package | Notes |
| --- | --- | --- |
| moderate | `minimatch` (<11.0.1 via `shadcn` → `ts-morph`) | Glob DoS advisory; upgrade when `shadcn` bumps. |
| low | `deepmerge` (via `shadcn`) | Prototype pollution on merge; no patch yet upstream. |

## Release checklist template

```
Date:
Araitchi version:
pnpm licenses list --prod → reviewed (Y/N)
New exceptions (package / licence / rationale):
pnpm audit --prod → high/critical: none | listed below:
```
