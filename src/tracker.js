import { clamp } from './engine.js';

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function detectMarker(image, hue = 328, tolerance = 24) {
  const { width: w, height: h, data } = image;
  const mask = new Uint8Array(w * h), queue = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const c = rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const dh = Math.abs(c.h - hue);
    if (Math.min(dh, 360 - dh) <= tolerance && c.s > .42 && c.v > .22) mask[i] = 1;
  }
  const blobs = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head = 0, tail = 1, sx = 0, sy = 0;
    queue[0] = start; mask[start] = 0;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w);
      sx += x; sy += y;
      for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (n >= 0 && mask[n]) { mask[n] = 0; queue[tail++] = n; }
      }
    }
    if (tail >= 8 && tail < w * h * .045) blobs.push({ x: sx / tail / w, y: sy / tail / w, area: tail });
  }
  blobs.sort((a, b) => b.area - a.area);
  if (!blobs.length) return { quality: 0, ambiguous: false };
  const best = blobs[0], ambiguous = blobs.length > 1 && blobs[1].area > best.area * .4;
  return { ...best, ambiguous, quality: ambiguous ? .35 : clamp(best.area / 28) };
}

export class MarkerTracker {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.rejects = 0; }
  update(image, hue, tolerance, dt = 1 / 30) {
    const p = detectMarker(image, hue, tolerance);
    if (p.quality < .7 || p.ambiguous) { this.previous = null; return p; }
    if (this.previous && Math.hypot(p.x - this.previous.x, p.y - this.previous.y) > .1 + .9 * dt) {
      this.rejects++;
      if (this.rejects < 4) return { ...p, quality: .3 };
      this.previous = null;
    }
    this.rejects = 0;
    const alpha = 1 - Math.exp(-dt / .045);
    const filtered = this.previous ? { ...p, x: this.previous.x + alpha * (p.x - this.previous.x), y: this.previous.y + alpha * (p.y - this.previous.y) } : p;
    this.previous = filtered;
    return filtered;
  }
}
