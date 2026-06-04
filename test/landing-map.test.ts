import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

test("worker landing positions country pins from the rendered SVG map", () => {
  const html = readFileSync(join(ROOT, "worker/public/index.html"), "utf8");

  assert.match(html, /class="world-map"/);
  assert.match(html, /function countryPointFromMap/);
  assert.match(html, /querySelector\?\.\("\.mainland"\)/);
  assert.match(html, /getBBox\(\)/);
  assert.match(html, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(html, /const countryPoints =/);
});

test("worker landing map has zoom controls that transform map and pins together", () => {
  const html = readFileSync(join(ROOT, "worker/public/index.html"), "utf8");

  assert.match(html, /class="map-controls"/);
  assert.match(html, /data-map-zoom="in"/);
  assert.match(html, /data-map-zoom="out"/);
  assert.match(html, /data-map-zoom="reset"/);
  assert.match(html, /const mapZoomState =/);
  assert.match(html, /function applyMapZoom/);
  assert.match(html, /function zoomMap/);
  assert.match(html, /function panMap/);
  assert.match(html, /mapLayer\.style\.transform = transform/);
  assert.match(html, /pinLayer\.style\.transform = transform/);
});

test("landing hero does not show protocol proof cards", () => {
  const files = [
    "worker/public/index.html",
    "landing.template.html"
  ];

  files.forEach((file) => {
    const html = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(html, /class="proof-row"/, file);
    assert.doesNotMatch(html, /class="proof"/, file);
    assert.doesNotMatch(html, />Ed25519</, file);
    assert.doesNotMatch(html, />X25519</, file);
    assert.doesNotMatch(html, />MCP Firewall</, file);
  });
});

test("landing copy distinguishes live presence from cumulative public stats", () => {
  const files = [
    "worker/public/index.html",
    "landing.template.html"
  ];

  files.forEach((file) => {
    const html = readFileSync(join(ROOT, file), "utf8");
    assert.match(html, /Profiles Ever Seen/, file);
    assert.match(html, /Recently Seen/, file);
    assert.match(html, /Public Directory Cards/, file);
    assert.match(html, /Closing the session changes Online Now after the heartbeat expires/i, file);
    assert.match(html, /To disappear from the public directory, run reset before deleting local files/i, file);
  });
});
