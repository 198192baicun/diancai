# Docker and WeChat Mini Program tutorial

[中文](DOCKER.zh-CN.md) | [English](DOCKER.en.md) · [Back to README](../README.en.md)

## 1. Scope

This tutorial runs the existing **development HTTP/SQLite implementation** for evaluation and integration. Use synthetic household data. The server container targets `linux/amd64`; the client still requires WeChat DevTools. Docker does not build or publish the Mini Program, and there is no web client.

Use `deploy/compose.dev.yaml` for this tutorial. `deploy/compose.yaml` is a production design template that still needs the production implementation and target-host acceptance. The development container installs no backup scheduler and provides no restore or media-cleanup commands. The TypeScript/Fastify production target, target Linux host and WeChat release acceptance remain separate requirements.

Use a trusted household LAN only. Selecting a member is not authentication: anyone who can reach the API may impersonate a member. Do not expose it through public port forwarding, reverse proxies or tunnels.

## 2. Prepare the environment and source

Install Docker Engine and Compose v2 on a Linux amd64 host; follow the [official Docker installation guide](https://docs.docker.com/engine/install/). Docker Desktop running Linux containers can be used for local development, but does not replace acceptance on the target Linux host.

Download and extract the repository ZIP from GitHub, or clone the address shown by its Code button. Open the repository root containing `Dockerfile`, `README.md` and `package.json`.

```bash
docker version
docker compose version
```

The Docker server should report `linux/amd64`. The first build needs access to Docker Hub. Running the server container does not require host Node, Python or npm dependencies.

## 3. Build and start

```bash
docker compose -f deploy/compose.dev.yaml config --quiet
docker compose -f deploy/compose.dev.yaml up -d --build --wait
docker compose -f deploy/compose.dev.yaml ps
curl --fail http://127.0.0.1:3000/health/ready
```

The health endpoint should return `{"status":"ready"}`. The development implementation creates an empty database on first start. Readiness does not mean the household is initialized; `GET /api/system` reports `initialized`. There is no web interface at `/`.

The default binding is host `127.0.0.1:3000`, accessible only from the same machine. The locally built image is `diancai-dev:local`, not an image published to Docker Hub or GHCR. `Dockerfile` pins the base version and actual amd64 digest; the build checks Node 24, Linux amd64 and SQLite >= 3.51.3.

The service runs as UID/GID `10001:10001` with a read-only root filesystem. A local Docker named volume stores SQLite, media and uploads under `/data/current`. Its default name is `diancai-dev_data`. Changing the Compose project name selects a different volume and can look like a new household.

## 4. Connect WeChat DevTools

Run `npm ci` in the host repository root (requires Node.js 24), then open the entire root in WeChat DevTools, **not just `miniprogram/`**. The shared configuration uses `touristappid`. Configure your own AppID when you need your WeChat project capabilities, and retain the placeholder when committing shared configuration.

On the same machine, connect to `http://127.0.0.1:3000`:

1. Connect to the household service, then create a test household and members.
2. Add a dish in an available category, enter recipe steps and optionally attach images.
3. Return to ordering, add dishes and confirm the batch; duplicates remain independent items.
4. Select a member, claim and complete cooking, then explore reviews and history.

Member selection only records the business actor. If a submission result is unknown, preserve the original intent and reconcile/retry with its original key instead of ordering again.

## 5. Connect a phone over the household LAN

Copy the example: on Linux/macOS use `cp deploy/dev.env.example deploy/dev.env`; in PowerShell use `Copy-Item deploy/dev.env.example deploy/dev.env`. Edit `deploy/dev.env`:

```dotenv
# Example only: replace with the Linux host's actual trusted LAN IPv4 address.
DIANCAI_BIND_IP=192.168.1.100
DIANCAI_PORT=3000
DIANCAI_DEV_IMAGE=diancai-dev:local
```

Start using that configuration. Changing a running service's binding recreates the container and briefly interrupts it:

```bash
docker compose --env-file deploy/dev.env -f deploy/compose.dev.yaml up -d --build --wait
docker compose --env-file deploy/dev.env -f deploy/compose.dev.yaml ps
```

Keep the phone and server on the same permitted household network. Enter `http://ACTUAL_LAN_IP:3000` in the Mini Program, replacing the placeholder. On a phone, `127.0.0.1` refers to the phone itself. Binding a LAN IP does not restrict source networks by itself: verify the actual Docker/firewall backend and test that disallowed networks cannot connect. UFW rules alone do not prove isolation.

Disabling domain checks in WeChat development settings only supports development. Validate iOS/Android LAN permissions, requests, uploads/downloads, weak networks, disabled debug mode and the actual release mode separately. See the [acceptance specification, in Chinese](05_开发与验收.md). Do not commit `deploy/dev.env`.

## 6. Inspect and stop the test service

With the default configuration:

```bash
docker compose -f deploy/compose.dev.yaml logs --tail=100 app
docker compose -f deploy/compose.dev.yaml stop
docker compose -f deploy/compose.dev.yaml start
docker compose -f deploy/compose.dev.yaml down
```

When using a custom environment file, add `--env-file deploy/dev.env` before `-f` in every command. `stop` and `down` interrupt the service. `down` removes this project's containers and network but retains its named volume by default. Do not add `--volumes`, which deletes volume data.

Recreating a container retains the volume, but application startup applies pending database migrations. Do not point a new development version at a real household database. Production upgrades require maintenance authorization and verified complete backup/restore procedures. Ordinary container recreation keeps the data epoch; an actual restore must produce a new epoch.

The required backup policy remains an exclusive offline backup at 04:00 Beijing time every day, the latest 10 successful local archives, and at least one weekly copy on a different physical medium. **The container does not perform these operations.** Protect both the database and referenced original media; copying only `app.db` is not a complete backup. See the [operations specification, in Chinese](04_部署与数据运维.md).

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| Cannot connect to Docker daemon | Start Docker and check Linux-container mode |
| Cannot pull the base image | Check Docker Hub access and proxy settings; do not substitute an untrusted image |
| Port already allocated | Change `DIANCAI_PORT` and update the Mini Program service address |
| Phone cannot connect | Check LAN binding, actual IP, network, firewall and WeChat requirements |
| Container unhealthy | Inspect service logs; health status alone does not trigger `restart: unless-stopped` |
| Database is not writable | Check volume and UID/GID; do not bypass with root, privileged mode or `chmod 777` |
| Household appears empty after recreation | Check project name, volume and environment before initializing again |
| SQLite version check fails | Record the actual version and inspect the base image; do not bypass the version gate |

## 8. Developer verification

After building, run `python tests/docker_smoke.py` (Python 3 required). It uses a random project name, a temporary named volume, a random loopback port and synthetic data. It checks initialization, original media bytes, and database/media persistence after container recreation, then removes only its own test project and volume. Results are written to `tests/results/docker-smoke.json`; it never mounts real household data.

Docker references: [Compose documentation](https://docs.docker.com/compose/) and [build contexts](https://docs.docker.com/build/concepts/context/). Checked on 2026-09-12.
