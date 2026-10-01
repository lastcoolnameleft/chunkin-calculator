---
title: "Trebuchet Splash Distance Tracker"
description: "A lightweight Node.js, Express, and SQLite application for triangulating projectile splash distances in a lake from two fixed shore stations during live events."
---

## Overview

A lightweight tool used at live trebuchet-throwing events to measure projectile splash distances in a lake via triangulation from two fixed shore stations.

## Features

- **Multi-Event Support & Direct Shareable URLs**: Create and manage distinct throwing events. Each event has its own setup, surveyed trebuchets, and shot log. Share direct links like `/event/summer-fest-2025` so spotters and scorekeepers land right in the active tracker.
- **Authoritative Server Triangulation**: Live angle readings (`angA`, `angB`) are calculated on the backend via the Law of Sines and Cosines, ensuring consistent distance calculations across all devices.
- **Multi-Device Synchronization**: Polling keeps all clients in sync with shots, trebuchet surveys, and setup data in near real-time.
- **Offline / Local Fallback**: Maintains a local storage cache and displays non-intrusive inline error banners if connection drops.
- **Embedded SVG Visualization**: Live, to-scale plotting of Station A, Station B, trebuchets, and splash points.
- **Lightweight & Containerized**: Node.js, Express, and SQLite with Docker and Docker Compose support.

## Workflow & Direct URLs

1. **Create an Event**: When you first open the app, enter an event name and baseline distance (optional at creation, can be configured later).
2. **Share Direct Link**: Copy the shareable link (e.g. `http://<host>:3000/event/<event-id>`) from the top of the tracker and distribute it to spotters at Station A and Station B.
3. **Survey & Log**: Survey any fixed trebuchets, then enter angle readings as shots land. The table, self-check calculations, and SVG diagram update across all devices viewing that event.

## Field Triangulation & Baseline Sizing

For event setup instructions, accuracy calculations, and guidance on choosing an optimal baseline distance, see the comprehensive [Triangulation Field Guide](docs/triangulation-guide.md).

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

# 3. Start the application
npm start
```

The application will be running at [http://localhost:3000](http://localhost:3000).

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
- `GET /api/events` - List all events.
- `POST /api/events` - Create a new event (`{ name, baseline, unit }`).
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

- `GET /api/setup` - Retrieve current setup configuration (`baseline`, `unit`).
- `POST /api/setup` - Save or update baseline distance and units.
- `GET /api/trebuchets` - List surveyed trebuchets.
- `POST /api/trebuchets` - Add a trebuchet with distance and angle from Station A.
- `DELETE /api/trebuchets/:id` - Remove a surveyed trebuchet.
- `GET /api/shots` - List all logged shots.
- `POST /api/shots` - Submit a shot with `angA`, `angB`, optional `treb` ID, and optional `known` distance.
- `DELETE /api/shots/:id` - Delete a logged shot.
