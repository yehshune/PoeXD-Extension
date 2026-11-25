## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `yehshune/PoeXD-Extension`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.

### Live verification on the official site

To inspect or verify extension behaviour on the real trade site, use `pnpm poe <command>` (run `pnpm poe help`) against the `pnpm dev` browser (CDP port 9222). Do not write one-off `connectOverCDP` scripts. See `.claude/skills/poe-live/SKILL.md` for the rules (close trade tabs before editing code, rate-limited commands, Cloudflare).
