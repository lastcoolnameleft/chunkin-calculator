---
title: "Trebuchet Impact Distance Tracker"
description: "A lightweight Node.js, Express, and SQLite application for triangulating projectile impact distances from two fixed observation stations during live events."
---

## Overview

A lightweight tool used at live trebuchet-throwing events to measure projectile impact distances via triangulation from two fixed observation stations.

## Features

- **Separate Submission & Spectator Views**: Edit at `/event/<event-id>` and share `/event/<event-id>/spectator` for read-only setup, trebuchet distances and angles, shot results, CSV export, and schematic/satellite visualizers.
- **Optional Event Passwords**: Protect editing with one shared password per event, without usernames. All event writes, including legacy API writes, require an unlocked session when a password is set.
- **Event Measurement Modes**: Choose **Compass bearings** or **GPS locations** when creating an event. Each mode has its own setup and shot-entry fields; existing angle-based events remain unchanged.
- **Task Tabs**: **Setup** holds station settings, trebuchets, sharing, and editing access. **Log a Shot** keeps entry focused, **Shot History** holds the log, CSV export, and GPS checks, and **Visualization** holds live results and maps. Unfinished events start on Setup; ready editors start on Log a Shot. Spectators start on Visualization and have no shot-entry tab. Switching tabs preserves drafts and live updates.
- **Authoritative Server Triangulation**: Compass readings are converted to triangle angles before using the existing Law of Sines and Cosines calculation. Raw readings and reference bearings are saved with each shot.
- **Angle Field Help**: Each angle field has a `?` button opening a floating popover without shifting the form. It explains which sight lines to measure between: A toward B then impact, B toward A then impact, or A toward B then the surveyed trebuchet. Dismiss with Escape or a click outside.
- **Multi-Device Synchronization**: Polling keeps all clients in sync with shots, trebuchet surveys, and setup data in near real-time.
- **Offline / Local Fallback**: Maintains a local storage cache and displays non-intrusive inline error banners if connection drops.
- **Embedded SVG Visualization**: Live, to-scale plotting of Station A, Station B, trebuchets, and impact points.
- **Satellite Map Markers**: Labeled station, trebuchet, and impact icons with measurement popups. Saving station GPS coordinates refreshes existing plotted points.
- **GPS Measurements and Checks**: GPS events measure launch-to-landing distance directly from saved coordinates without stations. Compass events can optionally attach GPS checks without replacing the original score. Reported device accuracy is recorded in meters; manually entered coordinates have unknown accuracy.
- **Illustrative Station Overlay**: In triangulation events, map positions are scaled to fit optional station GPS anchors; the overlay may not match real-world locations or distances. Entered baseline, surveys, and readings remain authoritative and are never changed to match this overlay.
- **Lightweight & Containerized**: Node.js, Express, and SQLite with Docker and Docker Compose support.

## Workflow & Direct URLs

### Choose an Event Measurement Mode

**Compass bearings**: measure the A–B baseline once, then save the forward bearing from A toward B and from B toward A. Each station must use the same compass for its reference and impact readings, away from magnetic interference. Survey each trebuchet using its distance and bearing from A. For each shot, select the firing trebuchet and enter the two impact bearings on the black 0–360 degree scale. The server handles north wraparound, signed survey angles, and impacts on either side of the baseline. Diverging or non-intersecting readings are rejected; shallow geometry and inconsistent reference bearings produce warnings. The baseline consistency check does not validate compass accuracy.

**GPS locations**: choose feet or meters and capture or enter each trebuchet's launch coordinates. Select the firing trebuchet, visit the marked landing location during a safe recovery period, and capture or enter its coordinates. No stations, baseline, or compass readings are required. Capture previews the device's current position and does not automatically log a shot. Distances are Earth-surface distances between coordinates, not altitude-adjusted slope distances or measurements from satellite pixels. HTTPS and location permission are required for capture; manual entry remains available.

**Optional GPS backup**: enable **Allow GPS checks** in compass setup. Launch GPS can be recorded with the trebuchet survey. Later, select **Add GPS check** on a shot, confirm its launch coordinates, and record landing GPS. Checks are appended to that shot and shown alongside the unchanged compass distance. If launch GPS was not saved with the shot, enter or capture the confirmed launch position explicitly. Both endpoints' reported accuracy and capture times are retained; missing accuracy is shown as unknown, not zero. Device accuracy estimates are not guaranteed error bounds.

Event modes cannot be switched in place. New GPS/compass events lock units after a trebuchet or shot is added, and shot records retain their original readings, unit, launch snapshot, and calculated result. Existing events keep their legacy angle workflow; **Legacy angles** is available under **Advanced** when creating an event. For API compatibility, omitting `measurementMode` still creates a legacy angle event. New clients should send `"measurementMode": "bearings"` or `"measurementMode": "gps"` and use event-scoped endpoints.

New API inputs:
- Compass setup: `POST /api/events/:id/setup` with `baseline`, `unit`, `referenceA`, `referenceB`, and optional boolean `gpsBackup`.
- Trebuchet: `POST /api/events/:id/trebuchets` with `name` and either `gps` for GPS events, or `dist` and `bearing` for compass events (optional launch `gps`).
- Shot: `POST /api/events/:id/shots` with `trebId` and either `landingGps`, or `bearingA` and `bearingB`.
- GPS check: `POST /api/events/:id/shots/:shotId/gps-checks` with `landingGps` and optional confirmed `launchGps`; otherwise the shot's saved launch GPS is used.

Each GPS object contains `latitude`, `longitude`, optional `accuracy` in meters, and optional ISO `capturedAt`. CSV exports include measurement methods, original bearings/reference readings, GPS coordinates and metadata, and appended checks. Existing SQLite data is migrated in place without recalculating historical shots; back up the database before upgrading production.

### Design Previews

**Live Scoreboard** is the default, including for browsers that used the earlier design previews. **Compare designs** and **Switch Event** are at the bottom of the page, out of the live workflow. You can still compare **Field Dashboard**, **Survey Notebook**, and the **Original layout**. Subsequent choices are remembered in that browser; switching does not reload the page or discard entered angles. All previews share the same event data and editing permissions.

The new layouts put large shot-entry controls first for mobile submitters and the visualizer first for spectators, with wider dashboard layouts on desktop. Live results show the latest and longest throws. Select a shot in the log or the results selector to highlight its trajectory; optionally enable its measurement triangle in either visualizer. Trebuchets and their shots use matching colors, with older map impacts subdued. These presentation changes do not change the distance calculation.

Shot logging also accepts optional **ballistic (projectile) weight**, **counterweight**, and **finger (release pin) angle** in degrees. Weight units are lb for feet-based events and kg for meter-based events, saved with each shot so changing event units does not relabel historical weights. These values are recorded in both views and CSV export; they do not affect triangulation. Both event-scoped and legacy shot APIs accept `ballisticWeight`, `counterweight`, and `fingerAngle`; omitted or blank values are stored as null.

1. **Create an Event**: Enter an event name, optional baseline, and optional editing password. Leaving the password blank allows anyone with the editor URL to modify the event.
2. **Share Spectator Link**: Copy the spectator URL at the top of the tracker. Spectators see the baseline, surveyed trebuchets, shot log, and both visualizers, without editing controls. Data refreshes every three seconds; a connection status warns when updates stop.
3. **Survey & Log**: Give submitters `/event/<event-id>` and, if set, the shared password. They unlock editing to survey trebuchets and log shots.
4. **Manage Access**: Expand **Editing access** in the unlocked editor to set, replace, or remove the password. Changing it invalidates existing editing sessions. Existing events remain openly editable until a password is set.

Passwords are stored as salted scrypt hashes, never returned by the API or included in share URLs. Unlock tokens are event-specific and remembered in the browser's local storage; only token hashes are stored in SQLite. Once unlocked, that browser stays trusted across page reloads, new tabs, and server restarts, with no automatic expiration. **Lock editor** revokes its token and forgets it in the browser; changing or removing the password revokes all of that event's tokens. Clearing browser storage requires unlocking again. Lock editing on shared devices when finished. Repeated failed unlock attempts are rate-limited. Serve the app over **HTTPS** outside local development to protect passwords and tokens in transit. Spectator pages are always read-only, even in a trusted browser, but password-free events deliberately permit writes through their editor/API.

## Field Triangulation & Baseline Sizing

For event setup instructions, accuracy calculations, and guidance on choosing an optimal baseline distance, see the comprehensive [Triangulation Field Guide](docs/triangulation-guide.md).

The website's **How this works** link opens `/how-it-works/`, which renders that same Markdown guide with formatted equations and its diagram. Edit `docs/triangulation-guide.md` to update both the documentation and website; no duplicate content or GitHub redirect is involved. GPS events use the satellite map without stations. Compass events without station GPS use the schematic, so optional map coordinates are not mistaken for required setup. Legacy events retain the satellite-map default. Spectators start on the Visualization tab.

### Quick Sizing Rules of Thumb

- **The Golden Ratio**: Set baseline distance $d$ to **25% to 40% (1/4 to 1/3)** of your expected maximum throw distance.
  - *500 ft max shots*: 150 to 200 ft baseline.
  - *1,000 ft max shots*: 250 to 350 ft baseline.
  - *2,000 ft max shots*: 500 to 650 ft baseline.
- **Error Behavior**: Triangulation distance error is proportional to $\frac{R^2}{d} \cdot \Delta \theta$. Doubling your baseline cuts distance error in half; doubling throw distance quadruples sensitivity to angle errors.
- **Diminishing Returns**: Expanding the baseline beyond 40–50% of max throw causes diminishing mathematical improvements while making short throws difficult to measure (obtuse convergence angles) and complicating line-of-sight.

## Getting Started

### Local Node.js

Use Node.js 22 (the production image and CI use Node.js 22).

```bash
# 1. Install dependencies
npm install

# 2. Run unit and integration tests
npm test

# Run automated browser tests (isolated in-memory database)
npx playwright install chromium
npm run test:browser

# 3. Start the application
npm start
```

The application will be running at [http://localhost:3000](http://localhost:3000).

### Local Development with Live Reload

```bash
./scripts/run-local.sh
# or: npm run dev
```

Open `http://localhost:3000` (including editor or spectator event URLs). Changes in `public/` or the shared triangulation guide and diagram automatically refresh connected browser tabs; changes in `src/` restart the backend and refresh tabs once it is ready. No build step or manual refresh is needed. Press Ctrl+C to stop both processes.

The runner loads `.env` when present. `PORT` sets the browser-facing port (default `3000`); `BACKEND_PORT` sets the backend port (default `PORT + 1`). Both ports must be available. Development uses the usual SQLite database, so remembered editing access survives backend restarts. Use `npm start` without live reload for normal hosting.

To use the production database copy in `data/prod-snapshot/tracker.db`, run `./scripts/run-local.sh --prod-snapshot` (or `npm run dev -- --prod-snapshot`). The flag overrides `DB_PATH` for this run and refuses to start if the snapshot is missing. Local changes affect only the copied database; this option does not connect to production.

### Docker Compose

Compose uses its own default bridge network, matching the other apps on your production server. Traefik runs in host network mode and routes to the container without a publicly exposed host port. See [Production Deployment](docs/production-deployment.md) for first-time setup, GitHub secrets, empty database provisioning, backup/restore, and rollback.

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
```

The production hostname is [https://tracker.dfwtrebuchet.com](https://tracker.dfwtrebuchet.com).

## Environment Variables

Copy `.env.example` to `.env` to configure:

- `PORT`: HTTP port for the web server (default: `3000`).
- `DB_PATH`: SQLite database file path (default: `./data/tracker.db`).
- `TRUST_PROXY`: Comma-separated trusted proxy IP addresses/CIDRs. Unset means no proxy trust. With host-network Traefik, verify its source address (normally the app's bridge gateway) before trusting it.
- Production Compose variables: `IMAGE`, `DATA_DIR`, `COMPOSE_PROJECT_NAME`, `ENV_FILE`, `TRAEFIK_HOST`, and `TRAEFIK_CERT_RESOLVER`; see `.env.example`. Compose loads `.env` automatically; `npm start` uses exported environment variables.

## API Endpoints

- `GET /healthz` - Database-aware readiness check (`200` when ready, `503` when unavailable); does not create or modify events.

### Events & Scoped Tracking

- `GET /event/:eventId` - Direct HTML route loading the tracker for a specific event.
- `GET /event/:eventId/spectator` - Read-only, live spectator view.
- `GET /api/events` - List all events.
- `POST /api/events` - Create a new event (`{ name, baseline, unit, password? }`).
- `GET /api/events/:eventId/access` - Retrieve password protection and current editing access.
- `POST /api/events/:eventId/session` - Unlock editing (`{ password }`); returns a persistent bearer token.
- `DELETE /api/events/:eventId/session` - Revoke the bearer token supplied in the request.
- `PUT /api/events/:eventId/password` - Set or change the password (`{ password }`); an empty string removes protection. Requires editing access.
- `GET /api/events/:eventId` - Fetch event metadata.
- `DELETE /api/events/:eventId` - Delete event and cascade-delete its trebuchets and shots.
- `GET /api/events/:eventId/setup` - Retrieve event baseline configuration.
- `POST /api/events/:eventId/setup` - Update event baseline and units.
- `GET /api/events/:eventId/trebuchets` - List surveyed trebuchets for an event.
- `POST /api/events/:eventId/trebuchets` - Add a trebuchet to an event.
- `DELETE /api/events/:eventId/trebuchets/:id` - Delete a trebuchet from an event.
- `GET /api/events/:eventId/shots` - List all logged shots for an event.
- `POST /api/events/:eventId/shots` - Submit a shot for an event (`angA`, `angB`, optional `trebId`, optional `known`).
- `DELETE /api/events/:eventId/shots/:id` - Delete a shot from an event.
- `DELETE /api/events/:eventId/shots` - Clear all shots for an event.

### Legacy Single-Event Endpoints (Default Event Fallback)

For protected events, send `Authorization: Bearer <token>` on every modifying request. Read endpoints remain public. Legacy writes use the first/default event's editing authorization as well.

- `GET /api/setup` - Retrieve current setup configuration (`baseline`, `unit`).
- `POST /api/setup` - Save or update baseline distance and units.
- `GET /api/trebuchets` - List surveyed trebuchets.
- `POST /api/trebuchets` - Add a trebuchet with distance and angle from Station A.
- `DELETE /api/trebuchets/:id` - Remove a surveyed trebuchet.
- `GET /api/shots` - List all logged shots.
- `POST /api/shots` - Submit a shot with `angA`, `angB`, optional `treb` ID, and optional `known` distance.
- `DELETE /api/shots/:id` - Delete a logged shot.
