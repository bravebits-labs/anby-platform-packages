---
"@anby/cli": minor
---

feat(cli): add `anby login` / `anby logout` commands and interactive `anby init` with auto-registration

- Added Google OAuth login flow via `anby login` (opens browser, receives token via local callback server)
- Added `anby logout` to clear stored credentials from `~/.anby/auth.json`
- Refactored `anby init` to be fully interactive: prompts for app name and port, auto-generates reverse-domain app ID from logged-in user's email
- Init now scaffolds `app/lib/auth.server.ts` and patches `app/entry.server.tsx` with SDK bootstrap
- Init auto-registers the app with the registry and writes `ANBY_APP_TOKEN` to `.env.local`
