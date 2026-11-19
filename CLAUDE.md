# cc-usage-bars
PUBLIC repo. Claude Code plan usage as colored bars: status line (no API calls), an optional Home Assistant card fed by a webhook, and optional GNOME Shell top-panel bars.

## Commands
- Status line: `statusline/` (install steps in README, section 1). Home Assistant: `homeassistant/` (webhook `claude_usage`, README section 2). GNOME: `gnome-extension/` (log out/in once on Wayland, README section 3).
- Tests and build: to be defined (none).

## Pitfalls
- The repo is public: no personal data in code, docs, screenshots or commits (no IPs, hostnames, names, tokens, sensor ids from a private setup).
- It has NO OAuth collector on purpose; do not add one. The private collector lives in a separate private repo.
- Keep the status line free of network calls except the opt-in balance feature.

## Never commit or expose
`credentials.json`, `login_pendente.json`, `deepseek_key`, any API key or token.

## Home Assistant
Not needed to work on this repo; do not query a live instance.
