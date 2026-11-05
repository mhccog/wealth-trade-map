# The Wealth Trade Map

Real UK businesses that sell what wealthy people buy — on a map and a globe, with town and category filters, everything editable, and a way to connect businesses.

**Live:** https://mhccog.github.io/wealth-trade-map/

- `data.json` — the shipped list (189 businesses, 98 towns, 10 categories, 0 connections). `data.original.json` is the untouched copy used by *Reset to original*.
- Edits save automatically (debounced) to a small Cloudflare Worker (`worker/`, KV storage) so they appear on every device. The Worker only accepts the `mhccog.github.io` origin and a passphrase entered once per device. No tokens live in this repo or the page.
- `localStorage` keeps an offline copy; anything edited offline syncs when the connection returns.
- Redeploy the Worker: `scripts/deploy-sync.sh` (passphrase stays on the box in `/home/box/.secrets/wealth_trade_map_key`).

Business details were checked against each business's own website (or a directory listing where the site blocks bots) on 5 Nov 2026. Ring ahead before visiting.
