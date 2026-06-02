# Mac mini Relay Deployment

This is the operator path for running the Shellmates public relay on a Mac mini behind Cloudflare Tunnel.

The public host stays unified:

- `https://shellmates.parktaeyoung.com` serves the landing page.
- `https://shellmates.parktaeyoung.com/relay` points to this relay container.

## 1. Configure Cloudflare Tunnel

Create a Cloudflare Tunnel and add a public hostname:

- Hostname: `shellmates.parktaeyoung.com`
- Service: `http://shellmates-relay:8787`

Copy the tunnel token from Cloudflare.

## 2. Configure The Mac mini

```bash
cp .env.example .env
```

Edit `.env` and set:

```bash
CLOUDFLARE_TUNNEL_TOKEN=...
```

Do not commit `.env`.

## 3. Start

```bash
docker compose up -d --build
```

The relay binds only to localhost on the Mac mini:

```bash
curl http://127.0.0.1:8787/relay/health
```

The public check should also pass after Cloudflare DNS and tunnel routing are ready:

```bash
curl https://shellmates.parktaeyoung.com/relay/health
```

## 4. GitHub Actions Deploy

The repository includes a CI/CD workflow at `.github/workflows/ci-deploy.yml`.

CI runs on GitHub-hosted Linux runners:

- `npm run typecheck`
- `npm test`
- `npm run build`

Deployment runs only on a Mac mini self-hosted runner with these labels:

- `self-hosted`
- `macOS`
- `shellmates`

Register the runner from GitHub:

1. Open `Settings` -> `Actions` -> `Runners`.
2. Add a new self-hosted runner for macOS.
3. Install it on the Mac mini.
4. Add the custom label `shellmates`.
5. Keep Docker Desktop running on the Mac mini.

The workflow expects this GitHub Actions secret:

```text
CLOUDFLARE_TUNNEL_TOKEN
```

When the deploy job runs, it writes `.env` on the runner and executes:

```bash
docker compose up -d --build
curl --fail --silent --show-error http://127.0.0.1:8787/relay/health
```

## 5. Client Connection

Users who want global Shellmates matching should connect to the operator relay:

```bash
npx -y @taeyoung1005/shellmates start --server https://shellmates.parktaeyoung.com/relay
```

Teams or private groups can run their own relay and point clients at their own URL instead.

## 6. Operations

```bash
docker compose ps
docker compose logs -f shellmates-relay
docker compose logs -f cloudflared
docker compose pull cloudflared
docker compose up -d --build
```

Relay state is stored in the named Docker volume `shellmates-data`.

## Security Notes

- The relay runs with `TL_RELAY_OPEN=true`, so admission is open by design for public matching.
- Cloudflare should enforce basic WAF and rate limiting for `/relay/*`.
- The origin port is bound to `127.0.0.1:8787`, not a public interface.
- Message bodies are end-to-end encrypted; the relay stores signed profiles, encrypted envelopes, and aggregate public stats.
