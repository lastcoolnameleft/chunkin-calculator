# Production Deployment

This app uses the same GHCR → Docker Compose → Traefik → Watchtower pattern as the sibling projects. Production hostname: **tracker.dfwtrebuchet.com**. Nothing in these instructions requires copying the local database.

## Before the first deployment

1. Point the hostname's DNS to your server. Verify Traefik has the `websecure` entrypoint, HTTP-to-HTTPS redirection, and the `myresolver` certificate resolver (or override its name).
2. On this server, **Traefik runs with host networking**; Duckiehunt and the other apps each use their own Compose default bridge network. This app follows that pattern. There is no external network named `traefik` to create or join, and no `traefik.docker.network` label is needed for this single-network app.
3. After Compose creates the app's default network, inspect its gateway:

   ```bash
   docker network inspect chunkin-calculator_default --format '{{json .IPAM.Config}}'
   ```

   Host-network Traefik normally reaches the container from that bridge's gateway address. Verify the source address before setting `TRUST_PROXY` to that IP; restart the container after changing it. Leave it empty until verified, rather than trusting an invented subnet. Until configured, unlock rate limits can be shared among users because Express sees the proxy address. Do not use `true`, `0.0.0.0/0`, or trust arbitrary forwarded headers. This app publishes no host port.
4. Make sure the server and Watchtower can pull `ghcr.io/lastcoolnameleft/chunkin-calculator`. For a private package, configure registry credentials on the server and in Watchtower as in your existing deployment.
5. Configure repository Actions secrets **WATCHTOWER_URL** and **WATCHTOWER_TOKEN**. The URL must be an HTTPS update endpoint reachable from GitHub Actions, without an existing query string. The workflow targets only this image, not all hosted applications. Keep credentials out of Compose, commits, and logs.

## Provision an empty production database

Copy `docker-compose.yml` and `.env.example` to a dedicated directory on the server. Copy `.env.example` to `.env`, then set the image and an absolute persistent data directory. For example:

```env
COMPOSE_PROJECT_NAME=chunkin-calculator
IMAGE=ghcr.io/lastcoolnameleft/chunkin-calculator:latest
TRAEFIK_HOST=tracker.dfwtrebuchet.com
TRAEFIK_CERT_RESOLVER=myresolver
DATA_DIR=/data/chunkin-calculator
# Set to the verified Traefik source IP after inspecting the app network.
TRUST_PROXY=
```

To use `.env.prod` or `.env.stg`, provide the file for both Compose interpolation and the container environment, following the sibling projects:

```bash
ENV_FILE=.env.prod docker compose --env-file .env.prod up -d
```

Use different `COMPOSE_PROJECT_NAME`, `DATA_DIR`, and `TRAEFIK_HOST` values for staging and production. The network name is derived from the Compose project name.

The container runs as Node's non-root user, UID/GID **1000:1000**. On the server, create the chosen directory with those permissions:

```bash
sudo install -d -o 1000 -g 1000 -m 0750 /data/chunkin-calculator
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 chunkin-calculator
```

Do not copy `data/tracker.db` from development. On first startup the app creates the database, tables, and migrations in the empty mounted directory. An empty event list is expected. Run one app instance with local persistent disk; do not share SQLite WAL storage across multiple hosts or independent replicas.

## Release checks and automatic updates

The workflow `.github/workflows/deploy.yml` runs on main-branch pushes and pull requests:

- Unit/API/database tests and automated Chromium browser tests.
- Compose syntax validation.
- A Linux Node 22 image build and smoke test for non-root execution, an empty database, and container health.

Only successful main-branch builds publish `latest` and `sha-<full-commit-SHA>` tags. After publishing, the workflow invokes Watchtower, then retries public smoke checks. Watchtower must already be configured to process update requests and include this running container. Its label opts the app into label-filtered updates. GitHub Actions does not provision the host or create the first container.

Initial publication may report a deployment failure until the first container, DNS, secrets, and Traefik routing are configured. Once the image exists, complete the server setup, then rerun the deploy job.

For local release validation:

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
docker build -t chunkin-release-check .
```

Do not deploy the BrowserSync/nodemon runner. Use the production image's `npm start`.

## Post-deploy checks

From a machine with curl and Node.js:

```bash
./scripts/check-deploy.sh https://tracker.dfwtrebuchet.com
```

The script uses only GET requests, validates health and the event-list JSON shape, and checks the frontend, stylesheet, guide, diagram, math CSS, and direct event routes. It creates no events or shots. Set `EXPECTED_REVISION` to a full commit SHA to require that release; CI does this automatically so an older healthy container cannot falsely pass deployment verification. `/healthz` includes the revision embedded in the image. The script does not replace functional browser testing, registry authentication checks, or persistence checks.

On a phone over HTTPS, create a password-protected test event, add a surveyed trebuchet, and log a shot with optional weight and finger-angle details. Open its spectator link in another browser. Confirm live updates, map/schematic agreement, helper popovers, CSV, GPS permission, and remembered editing access after refresh. Password-free events intentionally allow anyone to edit; event creation is public.

Recreate the container and confirm the test event and editing access persist. Perform this before the real event, not during live scoring. Verify container health:

```bash
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q chunkin-calculator)"
```

Health checks report readiness, but Docker's restart policy does not automatically restart a merely unhealthy process. Add external HTTPS monitoring for `/healthz`, and investigate 503s or repeated restarts. Log rotation currently follows the Docker daemon configuration; the optional Compose logging settings can bound it per container. Satellite imagery and Leaflet currently require external internet access.

## Backups and recovery

The data directory holds the SQLite database and its WAL files, including saved editing sessions. Protect backups like credentials. Back up before updates, and keep an off-server copy. Do not copy only `tracker.db` while the app is writing: WAL may contain newer data.

For a simple consistent backup, briefly stop the service and copy the entire directory. Run from the production Compose directory, using the actual configured data path:

```bash
docker compose stop chunkin-calculator
sudo tar -C /data/chunkin-calculator -czf "/data/chunkin-backup-$(date +%Y%m%d-%H%M%S).tar.gz" .
docker compose start chunkin-calculator
```

If backup fails, restart the service immediately and investigate. For uninterrupted backups, use SQLite's online backup API instead of live filesystem copying.

Test restoring into a **new empty directory**, not over a running database. Stop the app, extract the backup into that directory, set its ownership to 1000:1000, point `DATA_DIR` to it, and recreate the container. Verify event/shot counts and health. Do not combine an older database with newer leftover WAL files.

## Rollback and event-day operations

Record the deployed image SHA and back up before upgrading. To roll back, change `IMAGE` in `.env` to a known-good `sha-<full-commit-SHA>` tag, then:

```bash
docker compose pull
docker compose up -d
```

Image rollback does not reverse schema migrations. If an old image cannot use the current schema, restore its matching backup into a separate directory and repoint `DATA_DIR`; restoring a backup loses writes since that backup. Pause automatic updates during an event using your Watchtower controls, or pin an immutable SHA tag. Keep one stable release throughout live scoring.
