# novadodge

A tiny arcade dodger in a single HTML file. Pilot a ship through a nova's debris field — don't touch the rocks, skim them.

No build step, no dependencies, no server. Double-click `novadodge.html` and it runs. Works with mouse, touch, or keyboard, desktop or phone.

## Play it

Open `novadodge.html` in any browser. That's the whole install.

**Controls**

- Mouse / touch drag — the ship follows your pointer
- Arrow keys or WASD — same thing, keyboard flavor
- P — pause. Click or Space — start / restart. The game also pauses itself if you switch tabs mid-run.

**Scoring**

- Surviving trickles points, but that's pocket change.
- The real game is the near-miss: skim an asteroid (pass close without touching it) and you get `10 x multiplier` points. Every consecutive skim raises the multiplier. Take a hit and it resets to x1.
- 3 lives. A hit also gives you 2 seconds of mercy invulnerability so one bad moment doesn't chain into a death spiral.
- The longer you survive, the faster and denser the debris gets. Your best score is saved in the browser.

## Why I made this

I wanted a game I could send someone as a single file — no "clone this, npm install, it needs a local server" dance. One file, double-click, playing in two seconds. The near-miss multiplier is the whole design: it turns dodging from something you do to *not lose* into something you do to *win*, which is what makes risky flying fun instead of just stressful.

## How it's built

Everything lives in `novadodge.html`:

- `novacore` — the simulation (ship steering, spawning, collision, grazing, scoring). Deliberately DOM-free: it takes an injected RNG and plain input objects, so it runs identically in a browser or in Node.
- the renderer — canvas drawing, parallax starfield, the pulsing nova, particles, a tiny WebAudio synth for the blips, menus and HUD.

Physics substeps at 120 Hz internally so fast asteroids can't tunnel through the ship on slow frames — that was a real bug I caught while writing the tests.

Fixed logical resolution (480x800) scaled to the window, so collision math never depends on screen size.

## Tests

The core sim is tested headlessly — `tests/run.js` extracts the `novacore` block from the HTML and drives it in Node with a seeded RNG:

```
node tests/run.js
```

Covers: collisions costing a life, invulnerability windows, graze chaining (and one graze per rock), game-over on the last life, difficulty ramp, ship steering and bounds, score trickle, and a 60-second soak run. The renderer script is compile-checked too (it needs a real DOM to actually run, so that's as far as headless goes).

## Limitations, honestly

- Collision is circle-vs-circle, so the ship's sprite is a bit more forgiving (or less) than it looks at the corners.
- No gamepad support. No online leaderboard — best score is localStorage only.
- Sound is a few raw oscillator blips; there's no mute button yet (your OS volume is the mute button).
- Balance was tuned by feel on my machine; on a 30 Hz display the game is the same speed but the motion is choppier.

## Project structure

```
novadodge/
  novadodge.html   # the whole game: novacore sim + canvas renderer
  tests/run.js     # headless tests for the sim (node, zero deps)
  README.md
  LICENSE
  .gitignore
```

## License

MIT — see LICENSE. Made by [Krrish](https://github.com/codewithkrrish).
