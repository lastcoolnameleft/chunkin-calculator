# Impact Distance Tracker — Copilot handoff

This file has two parts. Copy the first section into `.github/copilot-instructions.md`
in your repo (Copilot Chat reads this automatically on every request in the project,
so it's your persistent context). Use the second section as your first message to
Copilot Chat once the repo is set up.

---

## PART 1 — save as `.github/copilot-instructions.md`


---

## PART 2 — first message to paste into Copilot Chat

I'm moving shot logging for this app from browser-only `localStorage` to a real
backend, because multiple people on different devices need to log shots to the
same shared event in real time (currently each device only sees its own local copy).

Requirements for the server-side change:

1. Add a lightweight backend (prefer Node/Express + SQLite for a single-event,
   low-traffic use case — this runs for a few hours at one event, not a production
   service) with a REST API covering the three collections described above: setup,
   trebuchets, shots. Keep it deployable with minimal setup (no cloud account
   required to run locally).
2. Endpoints needed: get/save setup, list/add/delete trebuchets, list/add/delete
   shots. Shot creation should happen server-side from the raw angle readings
   (`angA`, `angB`, optional `treb` id, optional `known`) — move the triangulation
   math (see the math section above) into the backend so all clients get consistent,
   authoritative results rather than each client computing its own.
3. Update the frontend to call these endpoints via `fetch` instead of reading/writing
   `localStorage` directly. Keep `localStorage` only as an offline fallback/cache if
   that's low-effort, but the server is now the source of truth — if a network call
   fails, show an inline error rather than silently falling back to stale local data.
4. Shots list should support near-real-time updates across devices (polling every
   few seconds is fine for this use case — no need for websockets unless it's trivial
   to add).
5. Preserve all existing UI behavior, math, validation, and visual style exactly as
   described in the project context — this is a storage-layer change, not a redesign.
6. Give me the file/folder structure you're proposing before writing code, since I
   want to review it fits a simple `git clone && npm install && npm start` workflow.
