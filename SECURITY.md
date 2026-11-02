# Security

Araitchi is a **local-first** app: it stores your OpenRouter (and optional provider) keys on disk and talks to models on your behalf. Treat the machine that runs it as the trust boundary.

## Threat model

| Control | Intent |
| --- | --- |
| **Localhost only** | `dev` / `start` bind `127.0.0.1`, not `0.0.0.0`, so other devices on the LAN cannot hit API routes that use your keys. |
| **Origin guard** | Mutating and sensitive routes (`/api/projects*`, `/api/fs*`, chat, council, etc.) reject non-local `Origin` headers (exact app port). |
| **Encrypted secrets** | API keys in `app.db` are AES-256-GCM. The master key is `<dataDir>/master.key` (mode `0600` where supported). Secret values are never returned to the browser — only set / not set. |
| **Untrusted tool content** | Paper/web/doc/repo/MCP results are truncated and wrapped as untrusted tool data. Models are instructed to treat them as data, not instructions. |
| **Read-only repo tools** | Repo tools are read-only, path-guarded, and refuse common secret files (e.g. `.env`). Experiment `results.json` paths are confined to relative `experiments/<id>/*.json`. |
| **Approvals** | Write/spend tools and MCP tools (unless the server is marked read-only) require an explicit UI approval key before running. |
| **Folder browser** | `/api/fs/list` defaults to your home directory (`ARAITCHI_FS_ROOT` override for tests). Paste-a-path can open absolute directories only after confirmation. |
| **No remote code execution by the app** | The validation loop never executes experiment code; it only reads results you (or Cursor) wrote. |

### What we do **not** claim

- Protection if an attacker already has local access to your user account or can read `master.key` + `app.db`.
- Safety of **stdio MCP servers** you add — those run commands on this computer; only add servers you trust.
- That OpenRouter, paper providers, or web-search regions are private beyond their own policies — prompts and tool calls leave your machine when you use those services.

### Data locations

See the README “Where data is stored” table. **Never share or commit `master.key`.** Anyone with that file and `app.db` can decrypt your keys. Reset by deleting the app data directory.

## Reporting a vulnerability

- Prefer [GitHub Security Advisories](https://github.com/heyronith/araitchi/security/advisories/new) for sensitive reports.
- If advisories are unavailable, open a [private-minded GitHub issue](https://github.com/heyronith/araitchi/issues/new) titled `Security: …` and avoid pasting secrets, keys, or exploit chains in public comments.

Please include: Araitchi version (`package.json` / release tag), OS, steps to reproduce, and impact. We aim to acknowledge reports promptly.

## Licence compatibility

Runtime dependency licence policy and known exceptions: [docs/LICENCE_EXCEPTIONS.md](docs/LICENCE_EXCEPTIONS.md).
