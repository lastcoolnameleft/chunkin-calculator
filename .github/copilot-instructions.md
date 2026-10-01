# Project context: Trebuchet Splash Distance Tracker

## What this is
A tool used at a live trebuchet-throwing event to measure how far a projectile
travels when it lands in a lake (so it can't be walked out to and measured directly).
Two fixed shore observation stations (Station A and Station B) sight the splash;
their angle readings triangulate its position. The same technique is used once,
ahead of time, to survey the fixed position of each trebuchet relative to Station A.
The distance for any shot is then the straight-line distance between that
trebuchet's known position and the splash's calculated position.

## The math (must be preserved exactly)
- `d` = baseline distance between Station A and Station B (measured once, in feet or meters).
- At the moment of splash: Station A reads angle `angA` (degrees, between line AB and the splash), Station B reads angle `angB` (degrees, between line BA and the splash).
- Angle at splash: `angP = 180 - angA - angB`. If `angP <= 0` (or either input angle is `<= 0`), the readings are invalid — the two rays don't converge into a triangle. Reject and prompt for re-entry.
- Law of sines: `AP = d * sin(angB) / sin(angP)` (distance Station A → splash), `BP = d * sin(angA) / sin(angP)` (distance Station B → splash).
- Self-check via law of cosines (should come back close to `d`): `baselineCheck = sqrt(AP^2 + BP^2 - 2*AP*BP*cos(angP))`. Shown to the user as a sanity check on the reading quality.
- Splash coordinates, with Station A as the origin and the line to Station B as the x-axis: `px = AP * cos(angA)`, `py = AP * sin(angA)`.
- Each trebuchet is separately surveyed once: `dist` (distance from Station A) and `angle` (degrees from the A→B baseline, same convention as the splash angle). Trebuchet coordinates: `tx = dist * cos(angle)`, `ty = dist * sin(angle)`.
- Final distance for a shot = straight-line distance between the firing trebuchet's coordinates and the splash coordinates: `sqrt((px - tx)^2 + (py - ty)^2)`. If no trebuchet is selected for a shot, distance defaults to `AP` (i.e., treat Station A itself as the origin/launch point).

## Current data model (client-side today, to become server-side)
- **Setup** (one per event): `{ baseline: number, unit: "ft" | "m" }`
- **Trebuchets** (list): `{ name: string, dist: number, angle: number }`
- **Shots** (list, append-only log): `{ label: string, treb: string (trebuchet name or "Station A"), tx: number, ty: number, angA: number, angB: number, dist: number, check: number, px: number, py: number, known: number | null }`
  - `known` is an optional user-entered "actual distance" used only for calibration/accuracy testing (shows an error % against the calculated distance). Not required for normal operation.

## Current implementation
Single self-contained HTML file (`splash-distance.html`) — vanilla JS, no build step,
no framework. All three collections above are persisted to `localStorage` under keys
`td_setup`, `td_shots`, `td_trebs`, scoped to one browser on one device. UI has three
setup cards (baseline, trebuchets, shot entry), a shot log table with CSV export
(via a copyable textarea, not a file download), and an inline SVG diagram plotting
stations, trebuchets, and splash points to scale for a visual sanity check.

## Design/UX conventions to preserve
- No math required from the two live spotters — they only ever report one angle
  reading each per shot. All triangulation happens in code.
- Every add/delete action re-renders the table and diagram immediately.
- Invalid angle combinations (triangle doesn't close) show an inline warning, not
  a browser alert, and don't add a row.
- Light/dark theme via CSS custom properties, responsive to `prefers-color-scheme`.
- Keep the visual style: warm paper/ink palette, Georgia/serif body text, Trebuchet MS
  for headings and labels — this is intentional, not a placeholder theme.
