# Shellmates Landing Worker

Serves the landing page at the apex of the **same hostname** the relay tunnel uses:

| Path        | Served by                                   |
| ----------- | ------------------------------------------- |
| `/`         | this Worker (`public/index.html`)           |
| `/relay/*`  | Cloudflare Tunnel → Mac mini relay container |

## Why a root-only route

`wrangler.jsonc` binds the Worker to `shellmates.parktaeyoung.com/` (no `/*`).
A root-only route **cannot** match `/relay/*`, so the live relay is structurally
protected: the worst failure mode is "apex page missing", never "relay broken".

## Live data

`public/index.html` fetches `GET /relay/public-stats` (relative, so same-origin →
**no CORS**) every 15s and renders users / conversations / cards / country pins.
Because it is the same hostname, that request flows through the Tunnel to the relay
with no extra config.

## Source Location

This Worker source lives in `master` under `worker/`.

## Deploy

From the repository root:

```bash
npm run worker:deploy
```

Or from this directory:

```bash
wrangler deploy --x-autoconfig=false
```

Wrangler must be authenticated first. For an interactive local setup:

```bash
cd worker
wrangler login          # opens browser; pick the parktaeyoung.com account
wrangler deploy --x-autoconfig=false
```

Then verify the path split:

```bash
curl -s https://shellmates.parktaeyoung.com/relay/health        # {"ok":true,...}  (tunnel still wins)
curl -s https://shellmates.parktaeyoung.com/ | head -c 200       # landing HTML
```

Open `https://shellmates.parktaeyoung.com/` in a browser and confirm the stats
panel populates and refreshes (~15s).

## Notes

- The decorative world-map background (`__WORLD_MAP_BASE64__` in the source
  template) is replaced here with a pure-CSS dot grid — no external asset, and the
  live pins/country list do not depend on it.
- The Worker is still deployed directly with Wrangler. A push to `master` may
  re-trigger the relay deploy job, but it does not deploy this Worker unless
  someone runs the Worker deploy command.
