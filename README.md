# Exitwise: fire escape planner

Draw a building, start a fire anywhere, and watch every occupant walk out. Exitwise times each
escape route, finds bottlenecks and single points of failure, and prints an assessment report.

It is a static web app: everything runs in the browser and projects are stored locally, so it can be
hosted on any static host with no server or database.

> Exitwise is a planning and drill tool built on a network model with simplified fire, smoke and
> movement rates. It does not replace a fire engineer's assessment or a check against local fire code.

## Features

**Design**
- Rooms, corridor points, stairs, exits and refuge areas on a pan-and-zoom canvas with grid snapping.
- Multiple floors; stairs link floors and are walked at a slower speed.
- Connections carry a clear width (sets people flow) and an optional fire door rating (FD30 to FD120).
- Trace over a floor plan image (PNG, JPEG, WebP, GIF) and calibrate the scale by clicking two points.
- Box select, multi-edit, duplicate, arrow-key nudge, undo/redo, keyboard shortcuts.

**Simulate**
- Fire and smoke spread along connections; fire doors hold both back for their rating; flashover delay.
- Every occupant is an agent with pre-movement time, walking speed, stair and smoke slowdowns.
- Door and corridor capacity creates realistic queues; agents re-route around congestion and fire.
- Time-aware routing: a route is safe only if each point is reached a safety margin before the fire.
- Falls back to refuge areas, then to the least-bad route; reports trapped and stranded people.
- Timeline playback with live counts, evacuation curve, exit use and bottleneck list.
- Multiple scenarios per building (fire origins, ignition times, blocked doors, random seed).
- Route tool: the escape route from any point at any moment, with distance, ETA and smoke exposure.
- Runs in a Web Worker so the editor never freezes.

**Audit**
- Score out of 100 with critical findings, warnings and notes.
- Travel distance to the nearest exit, rooms with no route, single points of failure, dead-end
  corridors, unconnected points, narrow routes, exit discharge capacity, floors with no way out.
- Main and alternative exit for every room. All limits are editable to match the local code.

**Report and files**
- Printable assessment report (print or save as PDF): scenarios, floor plans, findings, room routes,
  assumptions.
- Export and import project files (with floor plan images embedded), PNG export of the current view.
- Imports maps from the original Python planner (`{"positions": …, "edges": …}`).
- Light and dark themes; occupancy presets (office, school, venue, hospital or care home).

## Getting started

Requires Node 20 or newer.

```bash
npm install
npm run dev      # http://localhost:5173 (landing page) and /app.html (planner)
npm test         # engine tests
npm run build    # static site in dist/
```

Deploy `dist/` to any static host at the domain root (Netlify, Vercel, Cloudflare Pages, S3, nginx).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V, H | Select, pan |
| R, C, S, X, G | Place room, corridor point, stair, exit, refuge (hold Shift to connect to the selected point) |
| L | Connect two points |
| M | Calibrate scale |
| F, B, P | (Simulate) fire, block, route tools |
| K | Play or pause the simulation |
| Delete | Delete selection |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| Ctrl+A, Ctrl+D | Select all on floor, duplicate |
| Ctrl+S | Export project file |
| 0, +, - | Fit, zoom in, zoom out |

## Project structure

```
index.html            landing page (static, uses public/kit)
app.html              planner entry
src/model/            data model, validation, legacy import, edits, templates
src/engine/           graph search, fire and smoke spread, routing, agent simulation, audit (+ tests)
src/app/              undo/redo store, IndexedDB persistence, import/export, simulation worker
src/ui/               React components: canvas, panels, timeline, report, dialogs
src/brand.ts          product name in one place
samples-legacy/       maps from the original Python planner
```

## Model defaults

| Setting | Default |
| --- | --- |
| Walking speed | 1.2 m/s (50% on stairs, 60% in smoke) |
| Door flow | 1.3 people/s per metre of width |
| Pre-movement | 30 s plus up to 60 s |
| Fire spread | 6 m/min after 90 s flashover |
| Smoke spread | 30 m/min |
| Safety margin | 30 s ahead of fire |
| Travel distance limit | 45 m |
| Target evacuation time | 150 s |

All of these are per-project settings.

## What changed from the original Python version

The Tkinter app was rewritten as a web app. Bugs fixed along the way:
- Exits were hard-coded to `E1`/`E2` and the start room to `A` (missing in some maps).
- "Start fire" ignited the occupant's own room.
- Tk widgets were updated from worker threads, and reset could leave two fire threads running.
- The best exit was chosen by number of hops, not distance, and routes ignored when fire would arrive.
- Positions without connections were drawn as rooms; stored weights disagreed with the drawing.
