---
title: "Trebuchet Splash Distance Tracker"
description: "A lightweight Node.js, Express, and SQLite application for triangulating projectile splash distances in a lake from two fixed shore stations during live events."
---

## Overview

A lightweight tool used at live trebuchet-throwing events to measure projectile splash distances in a lake via triangulation from two fixed shore stations.

## Features

- **Separate Submission & Spectator Views**: Edit at `/event/<event-id>` and share `/event/<event-id>/spectator` for read-only setup, trebuchet distances and angles, shot results, CSV export, and schematic/satellite visualizers.
- **Optional Event Passwords**: Protect editing with one shared password per event, without usernames. All event writes, including legacy API writes, require an unlocked session when a password is set.
- **Authoritative Server Triangulation**: Live angle readings (`angA`, `angB`) are calculated on the backend via the Law of Sines and Cosines, ensuring consistent distance calculations across all devices.
- **Angle Field Help**: Each angle field has a `?` button explaining where to stand and which sight lines to measure between: A toward B then splash, B toward A then splash, or A toward B then the surveyed trebuchet.
- **Multi-Device Synchronization**: Polling keeps all clients in sync with shots, trebuchet surveys, and setup data in near real-time.
- **Offline / Local Fallback**: Maintains a local storage cache and displays non-intrusive inline error banners if connection drops.
- **Embedded SVG Visualization**: Live, to-scale plotting of Station A, Station B, trebuchets, and splash points.
- **Satellite Map Markers**: Labeled station, trebuchet, and splash icons with measurement popups. Saving station GPS coordinates refreshes existing plotted points.
- **Lightweight & Containerized**: Node.js, Express, and SQLite with Docker and Docker Compose support.

## Workflow & Direct URLs

1. **Create an Event**: Enter an event name, optional baseline, and optional editing password. Leaving the password blank allows anyone with the editor URL to modify the event.
2. **Share Spectator Link**: Copy the spectator URL at the top of the tracker. Spectators see the baseline, surveyed trebuchets, shot log, and both visualizers, without editing controls. Data refreshes every three seconds; a connection status warns when updates stop.
3. **Survey & Log**: Give submitters `/event/<event-id>` and, if set, the shared password. They unlock editing to survey trebuchets and log shots.
4. **Manage Access**: Expand **Editing access** in the unlocked editor to set, replace, or remove the password. Changing it invalidates existing editing sessions. Existing events remain openly editable until a password is set.

Passwords are stored as salted scrypt hashes, never returned by the API or included in share URLs. Unlock tokens are event-specific and kept in browser-tab memory; reloads and server restarts require unlocking again. Sessions expire after 12 hours, and repeated failed unlock attempts are rate-limited. Serve the app over **HTTPS** outside local development to protect passwords and tokens in transit. Spectator pages are always read-only, but password-free events deliberately permit writes through their editor/API.

## Field Triangulation & Baseline Sizing

For event setup instructions, accuracy calculations, and guidance on choosing an optimal baseline distance, see the comprehensive [Triangulation Field Guide](docs/triangulation-guide.md).

The website's **How this works** link opens `/how-it-works/`, which renders that same Markdown guide with formatted equations and its diagram. Edit `docs/triangulation-guide.md` to update both the documentation and website; no duplicate content or GitHub redirect is involved. Satellite Map is the default visualizer in both event views, and the visualizer appears first in the spectator view.

### Quick Sizing Rules of Thumb

- **The Golden Ratio**: Set baseline distance $d$ to **25% to 40% (1/4 to 1/3)** of your expected maximum throw distance.
  - *500 ft max shots*: 150 to 200 ft baseline.
  - *1,000 ft max shots*: 250 to 350 ft baseline.
  - *2,000 ft max shots*: 500 to 650 ft baseline.
- **Error Behavior**: Triangulation distance error is proportional to $\frac{R^2}{d} \cdot \Delta \theta$. Doubling your baseline cuts distance error in half; doubling throw distance quadruples sensitivity to angle errors.
- **Diminishing Returns**: Expanding the baseline beyond 40–50% of max throw causes diminishing mathematical improvements while making short throws difficult to measure (obtuse convergence angles) and complicating shoreline line-of-sight.

## Getting Started

### Local Node.js

Requires Node.js 20+.

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

The runner loads `.env` when present. `PORT` sets the browser-facing port (default `3000`); `BACKEND_PORT` sets the backend port (default `PORT + 1`). Both ports must be available. Development uses the usual SQLite database, and backend restarts require unlocking password-protected events again. Use `npm start` without live reload for normal hosting.

### Docker Compose

Run with Docker Compose with persistent data volume mounted to `./data`:

```bash
docker compose up --build
```

The application will be available at [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env` to configure:

- `PORT`: HTTP port for the web server (default: `3000`).
- `DB_PATH`: SQLite database file path (default: `./data/tracker.db`).

## API Endpoints

### Events & Scoped Tracking

- `GET /event/:eventId` - Direct HTML route loading the tracker for a specific event.
- `GET /event/:eventId/spectator` - Read-only, live spectator view.
- `GET /api/events` - List all events.
- `POST /api/events` - Create a new event (`{ name, baseline, unit, password? }`).
- `GET /api/events/:eventId/access` - Retrieve password protection and current editing access.
- `POST /api/events/:eventId/session` - Unlock editing (`{ password }`); returns a 12-hour bearer token.
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
