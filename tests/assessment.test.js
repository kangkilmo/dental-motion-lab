import test from 'node:test';
import assert from 'node:assert/strict';
import { Assessment, DEFAULTS, VERSION, preset, pathInfo, pointAt, validateProtocol } from '../src/engine.js';
import { detectMarker, MarkerTracker } from '../src/tracker.js';

const protocol = () => ({ version: VERSION, name: 'test arc', path: preset('arc'), config: { ...DEFAULTS } });
function session({ fps = 30, speed = .17, offset = 0, still = false, quality = 1, hide = () => false, ambiguous = false } = {}) {
  const p = protocol(), a = new Assessment(p, 'demo'), info = pathInfo(p.path);
  for (let i = 0; i <= fps * 30; i++) {
    const t = i / fps, f = t * speed / info.total % 2;
    const pos = pointAt(info, still ? .5 : f <= 1 ? f : 2 - f);
    a.add(t, hide(t) ? null : { x: pos.x, y: pos.y + offset, quality, ambiguous });
  }
  return a;
}

test('a sustained accurate trajectory produces an eligible score', () => {
  const r = session().snapshot();
  assert.ok(r.score >= 90); assert.ok(r.metrics.coverage > 95); assert.ok(r.ratio > .98);
});
test('holding the marker still never earns an overall score', () => {
  const r = session({ still: true }).snapshot();
  assert.equal(r.score, null); assert.equal(r.movingTime, 0); assert.equal(r.metrics.path, null);
});
test('ambiguous and weak detections are excluded', () => {
  for (const options of [{ ambiguous: true }, { quality: .69 }]) {
    const r = session(options).snapshot(); assert.equal(r.score, null); assert.equal(r.validTime, 0);
  }
});
test('long tracking loss prevents a misleading complete score', () => {
  const r = session({ hide: t => t % 5 > 1.5 }).snapshot();
  assert.equal(r.score, null); assert.ok(r.ratio < .35);
});
test('fast and displaced movements receive meaningful penalties', () => {
  const baseline = session().snapshot(); const fast = session({ speed: .68 }).snapshot(); const drift = session({ offset: .055 }).snapshot();
  assert.ok(fast.metrics.speed < baseline.metrics.speed - 60); assert.ok(drift.metrics.path < baseline.metrics.path - 30);
});
test('time-weighted metrics remain similar at 20, 30 and 60 fps', () => {
  const results = [20, 30, 60].map(fps => session({ fps }).snapshot());
  for (const r of results) assert.ok(Math.abs(r.score - results[0].score) <= 2);
});
test('sample gaps do not count as continuous observation', () => {
  const a = new Assessment(protocol(), 'camera');
  a.add(0, { x: .3, y: .3, quality: 1 }); a.add(20, { x: .6, y: .3, quality: 1 });
  assert.equal(a.snapshot().validTime, 0); assert.equal(a.snapshot().score, null);
});
test('live and final scores use exactly the same rubric', () => {
  const a = session(); assert.deepEqual(a.finish().metrics, a.snapshot().metrics); assert.equal(a.finish().score, a.snapshot().score);
});
test('invalid protocol coordinates, excessive size and invalid speed bands fail validation', () => {
  const bad = [ { ...protocol(), path: [{ x: Infinity, y: .2 }, { x: .3, y: .4 }] }, { ...protocol(), path: Array.from({ length: 501 }, () => ({ x: .3, y: .3 })) }, { ...protocol(), config: { ...DEFAULTS, speedMin: .2, speedMax: .1 } }, { ...protocol(), path: [{ x: .3, y: .3 }, { x: .301, y: .3 }] } ];
  for (const p of bad) assert.throws(() => validateProtocol(p));
});

function bitmap(discs) {
  const width = 160, height = 110, data = new Uint8ClampedArray(width * height * 4);
  for (const [cx, cy, r, color = [245, 66, 164]] of discs) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (Math.hypot(x - cx, y - cy) <= r) data.set([...color, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
test('color segmentation locates a marker and rejects duplicate blobs', () => {
  const found = detectMarker(bitmap([[80, 55, 5]])); assert.ok(found.quality >= .7); assert.ok(Math.abs(found.x - .5) < .01);
  const ambiguous = detectMarker(bitmap([[80, 55, 5], [25, 40, 5]])); assert.equal(ambiguous.ambiguous, true); assert.ok(ambiguous.quality < .7);
  assert.equal(detectMarker(bitmap([])).quality, 0);
});
test('hue wrap accepts red across the 0/360 boundary', () => {
  const result = detectMarker(bitmap([[80, 55, 5, [255, 0, 0]]]), 359, 10); assert.ok(result.quality >= .7);
});
test('a discontinuous marker jump is held out of scoring', () => {
  const tracker = new MarkerTracker(); tracker.update(bitmap([[30, 40, 5]]), 328, 24);
  const result = tracker.update(bitmap([[120, 40, 5]]), 328, 24); assert.ok(result.quality < .7);
});
