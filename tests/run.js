#!/usr/bin/env node
"use strict";
/* Headless tests for novacore (the sim inside novadodge.html).
   The game is one HTML file by design, so this harness extracts the
   <script id="novacore"> block, runs it in a vm sandbox with a seeded rng,
   and asserts the sim behaves. The renderer script is compile-checked too. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const htmlPath = path.join(__dirname, "..", "novadodge.html");
const html = fs.readFileSync(htmlPath, "utf8");

function extract(id) {
  const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(m, `script block #${id} not found`);
  return m[1];
}

const coreSrc = extract("novacore");

// 1. the renderer script must at least parse (it needs a DOM to run)
const renderMatch = html.match(/<script>\n"use strict";\n\/\* renderer[\s\S]*?<\/script>/);
assert.ok(renderMatch, "renderer script block not found");
new vm.Script(renderMatch[0].replace(/^<script>/, "").replace(/<\/script>$/, ""),
  { filename: "renderer.js" });
console.log("ok  - renderer script parses");

// seeded rng so the sim is deterministic under test
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(coreSrc, sandbox, { filename: "novacore.js" });
const C = sandbox.Novacore;
assert.ok(C && typeof C.update === "function", "Novacore.update exported");
console.log("ok  - novacore loads and exports its API");

// 2. fresh game state is sane
{
  const g = C.newGame(mulberry32(1));
  assert.strictEqual(g.phase, "playing");
  assert.strictEqual(g.lives, 3);
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.mult, 1);
  assert.strictEqual(g.asteroids.length, 0, "no asteroids at start");
  console.log("ok  - newGame returns sane initial state");
}

// 3. asteroid falling on the ship registers a hit, not a graze
{
  const g = C.newGame(mulberry32(2));
  g.spawnTimer = 9999; // keep the spawner out of this
  const s = g.ship;
  g.asteroids.push({ x: s.x, y: s.y - 40, vx: 0, vy: 400, r: 15,
                     grazed: false, spin: 0, spinV: 0 });
  let ev = C.update(g, 0.2, null);
  assert.ok(ev.some(e => e.t === "hit"), "expected a hit event");
  assert.strictEqual(g.lives, 2);
  assert.strictEqual(g.mult, 1);
  assert.ok(g.ship.invuln > 0, "invulnerability granted after hit");
  console.log("ok  - direct collision costs a life and grants invuln");
}

// 4. invulnerability blocks the very next hit
{
  const g = C.newGame(mulberry32(3));
  g.spawnTimer = 9999;
  const s = g.ship;
  g.asteroids.push({ x: s.x, y: s.y, vx: 0, vy: 0, r: 15,
                     grazed: false, spin: 0, spinV: 0 });
  C.update(g, 0.016, null); // first hit -> invuln on
  assert.strictEqual(g.lives, 2);
  g.asteroids.push({ x: s.x, y: s.y, vx: 0, vy: 0, r: 15,
                     grazed: false, spin: 0, spinV: 0 });
  const ev = C.update(g, 0.016, null);
  assert.ok(!ev.some(e => e.t === "hit"), "no hit while invulnerable");
  assert.strictEqual(g.lives, 2);
  console.log("ok  - invulnerability window blocks follow-up hits");
}

// 5. a close shave (inside graze ring, outside hull) chains the multiplier
{
  const g = C.newGame(mulberry32(4));
  g.spawnTimer = 9999;
  const s = g.ship;
  const gap = C.SHIP_R + 15 + C.GRAZE_RING - 5; // inside ring, outside hull
  g.asteroids.push({ x: s.x + gap, y: s.y, vx: 0, vy: 0, r: 15,
                     grazed: false, spin: 0, spinV: 0 });
  const scoreBefore = g.score;
  const ev = C.update(g, 0.016, null);
  const graze = ev.find(e => e.t === "graze");
  assert.ok(graze, "expected a graze event");
  assert.strictEqual(g.mult, 2);
  assert.ok(g.score > scoreBefore, "graze adds score");
  assert.strictEqual(g.lives, 3, "graze must not cost a life");
  console.log("ok  - near-miss grazes chain the multiplier without damage");
}

// 6. each asteroid grazes at most once
{
  const g = C.newGame(mulberry32(5));
  g.spawnTimer = 9999;
  const s = g.ship;
  const gap = C.SHIP_R + 15 + C.GRAZE_RING - 5;
  g.asteroids.push({ x: s.x + gap, y: s.y, vx: 0, vy: 0, r: 15,
                     grazed: false, spin: 0, spinV: 0 });
  C.update(g, 0.016, null);
  const ev = C.update(g, 0.016, null);
  assert.ok(!ev.some(e => e.t === "graze"), "second graze from same rock");
  assert.strictEqual(g.mult, 2);
  console.log("ok  - an asteroid can only be grazed once");
}

// 7. third hit ends the run
{
  const g = C.newGame(mulberry32(6));
  g.spawnTimer = 9999;
  const s = g.ship;
  g.lives = 1;
  g.asteroids.push({ x: s.x, y: s.y, vx: 0, vy: 0, r: 15,
                     grazed: false, spin: 0, spinV: 0 });
  const ev = C.update(g, 0.016, null);
  assert.strictEqual(g.phase, "gameover");
  assert.ok(ev.some(e => e.t === "gameover"), "gameover event emitted");
  console.log("ok  - losing the last life ends the run with an event");
}

// 8. difficulty ramps: spawn interval shrinks over time, floored
{
  const early = C.spawnInterval(0);
  const late = C.spawnInterval(300);
  assert.ok(late < early, "interval shrinks");
  assert.ok(C.spawnInterval(100000) >= 0.28, "interval has a floor");
  console.log("ok  - spawn interval ramps down with a floor");
}

// 9. the ship actually steers toward the pointer target
{
  const g = C.newGame(mulberry32(7));
  g.spawnTimer = 9999;
  const x0 = g.ship.x;
  C.update(g, 0.5, { tx: x0 + 200, ty: g.ship.y });
  assert.ok(g.ship.x > x0, "ship moved toward target");
  console.log("ok  - ship steers toward the input target");
}

// 10. the ship cannot leave the world
{
  const g = C.newGame(mulberry32(8));
  g.spawnTimer = 9999;
  C.update(g, 5, { tx: -1000, ty: -1000 });
  assert.ok(g.ship.x >= C.SHIP_R && g.ship.y >= C.SHIP_R);
  C.update(g, 5, { tx: 9999, ty: 9999 });
  assert.ok(g.ship.x <= C.WORLD_W - C.SHIP_R && g.ship.y <= C.WORLD_H - C.SHIP_R);
  console.log("ok  - ship is clamped inside the world bounds");
}

// 11. staying alive trickles score even with zero input and zero rocks
{
  const g = C.newGame(mulberry32(9));
  g.spawnTimer = 9999;
  C.update(g, 2, null);
  assert.ok(g.score > 0, "trickle score accrues");
  assert.strictEqual(g.phase, "playing");
  console.log("ok  - survival trickles score with no input");
}

// 12. long soak: 60 simulated seconds, no crash, spawner fills the field
{
  const g = C.newGame(mulberry32(10));
  for (let i = 0; i < 600; i++) {
    C.update(g, 0.1, { tx: C.WORLD_W / 2, ty: C.WORLD_H * 0.72 });
    if (g.phase === "gameover") break;
  }
  assert.ok(g.asteroids.length > 0, "spawner produced asteroids");
  assert.ok(g.asteroids.length <= C.MAX_ASTEROIDS, "asteroid cap respected");
  console.log("ok  - 60s soak: spawner fills the field, cap respected, no crash");
}

console.log("\nall novadodge tests passed");
