export const VERSION = '1.0';
export const HEIGHT = 660 / 960;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const DEFAULTS = Object.freeze({ tolerance: .045, speedMin: .08, speedMax: .28, duration: 30 });

export function preset(name) {
  return Array.from({ length: 81 }, (_, i) => {
    const t = i / 80;
    if (name === 'vertical') return { x: .5, y: .16 + .36 * t };
    if (name === 'wave') return { x: .2 + .6 * t, y: .34 + .07 * Math.sin(t * Math.PI * 4) };
    return { x: .5 - .25 * Math.cos(t * Math.PI), y: .42 - .19 * Math.sin(t * Math.PI) };
  });
}

export function pathInfo(path) {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + distance(path[i - 1], path[i]));
  return { path, lengths, total: lengths.at(-1) };
}

export function pointAt(info, progress) {
  const d = clamp(progress) * info.total;
  let i = info.lengths.findIndex(v => v >= d);
  if (i <= 0) return { ...info.path[0] };
  const a = info.path[i - 1], b = info.path[i];
  const f = (d - info.lengths[i - 1]) / (info.lengths[i] - info.lengths[i - 1] || 1);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export function nearest(info, p) {
  let best = { distance: Infinity, progress: 0 };
  for (let i = 1; i < info.path.length; i++) {
    const a = info.path[i - 1], b = info.path[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const f = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1));
    const q = { x: a.x + f * dx, y: a.y + f * dy };
    const d = distance(q, p);
    if (d < best.distance) best = { distance: d, progress: (info.lengths[i - 1] + f * Math.hypot(dx, dy)) / info.total, point: q };
  }
  return best;
}

export function validateProtocol(raw) {
  if (!raw || raw.version !== VERSION || typeof raw.name !== 'string') throw new Error('지원되는 기준 경로 파일이 아닙니다.');
  if (!Array.isArray(raw.path) || raw.path.length < 2 || raw.path.length > 500) throw new Error('경로에는 2~500개 점이 필요합니다.');
  const path = raw.path.map(p => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < .02 || p.x > .98 || p.y < .02 || p.y > HEIGHT - .02) throw new Error('경로가 연습 화면 범위를 벗어났습니다.');
    return { x: p.x, y: p.y };
  });
  const total = pathInfo(path).total;
  if (total < .1 || total > 8) throw new Error('경로 길이가 너무 짧거나 복잡합니다.');
  const config = { ...DEFAULTS, ...raw.config };
  for (const [key, lo, hi] of [['tolerance', .015, .1], ['speedMin', .03, .3], ['speedMax', .08, .6], ['duration', 15, 120]]) {
    if (!Number.isFinite(config[key]) || config[key] < lo || config[key] > hi) throw new Error('연습 설정 범위를 확인해 주세요.');
  }
  if (config.speedMax <= config.speedMin) throw new Error('최대 속도는 최소 속도보다 커야 합니다.');
  return { version: VERSION, name: raw.name.slice(0, 60), path, config: Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, config[k]])) };
}

export function protocolKey(protocol) {
  // Exact path, rubric and engine version must match before sessions are compared.
  return JSON.stringify([VERSION, protocol.path, protocol.config]);
}

export class Assessment {
  constructor(protocol, source) {
    this.protocol = validateProtocol(protocol);
    this.info = pathInfo(protocol.path);
    this.source = source;
    this.samples = [];
    this.history = [];
    this.bins = new Set();
    this.heat = Array.from({ length: 32 }, () => ({ time: 0, error: 0 }));
    this.validTime = 0; this.movingTime = 0; this.elapsed = 0;
    this.sums = { path: 0, speed: 0, steady: 0 };
    this.prev = null; this.velocity = null;
  }

  add(t, observation) {
    if (!Number.isFinite(t) || t < 0 || (this.samples.length && t <= this.samples.at(-1).t)) return;
    this.elapsed = t;
    const valid = observation && Number.isFinite(observation.x) && Number.isFinite(observation.y)
      && observation.x >= 0 && observation.x <= 1 && observation.y >= 0 && observation.y <= HEIGHT
      && observation.quality >= .7 && !observation.ambiguous;
    const sample = { t, valid: !!valid, quality: clamp(observation?.quality || 0), x: valid ? observation.x : null, y: valid ? observation.y : null, speed: null, error: null, moving: false };
    const dt = this.prev ? t - this.prev.t : 0;
    if (!valid || !this.prev?.valid || dt > .2) {
      this.history = valid ? [{ t, x: sample.x, y: sample.y }] : [];
      this.velocity = null;
    } else if (dt > 0) {
      this.validTime += dt;
      this.history.push({ t, x: sample.x, y: sample.y });
      while (this.history.length > 2 && t - this.history[1].t > .14) this.history.shift();
      const first = this.history[0], window = t - first.t;
      if (window >= .08) {
        const vx = (sample.x - first.x) / window, vy = (sample.y - first.y) / window;
        const speed = Math.hypot(vx, vy);
        const near = nearest(this.info, sample);
        sample.speed = speed; sample.error = near.distance;
        sample.moving = speed >= .025 && speed < 2;
        if (sample.moving) {
          this.movingTime += dt;
          const { tolerance, speedMin, speedMax } = this.protocol.config;
          const ps = clamp(1 - near.distance / (tolerance * 2));
          const ss = speed < speedMin ? clamp(speed / speedMin) : speed <= speedMax ? 1 : clamp(1 - (speed - speedMax) / speedMax);
          const acceleration = this.velocity ? Math.hypot(vx - this.velocity.x, vy - this.velocity.y) / dt : 0;
          const steady = clamp(1 - Math.max(0, acceleration - .6) / 3);
          this.sums.path += ps * dt; this.sums.speed += ss * dt; this.sums.steady += steady * dt;
          const bin = Math.min(31, Math.floor(near.progress * 32));
          this.heat[bin].time += dt; this.heat[bin].error += near.distance * dt;
          if (near.distance <= tolerance) this.bins.add(bin);
        }
        this.velocity = { x: vx, y: vy };
      }
    }
    this.prev = sample;
    this.samples.push(sample);
    return sample;
  }

  snapshot() {
    const ratio = this.elapsed > 0 ? clamp(this.validTime / this.elapsed) : 0;
    const metrics = {
      path: this.movingTime ? this.sums.path / this.movingTime * 100 : null,
      speed: this.movingTime ? this.sums.speed / this.movingTime * 100 : null,
      steady: this.movingTime ? this.sums.steady / this.movingTime * 100 : null,
      coverage: this.bins.size / 32 * 100,
    };
    const reasons = [];
    if (this.elapsed < 12) reasons.push('12초 이상 연습');
    if (this.movingTime < 8) reasons.push('유효한 움직임 8초 이상');
    if (ratio < .65) reasons.push('추적 가능 시간 65% 이상');
    if (metrics.coverage < 30) reasons.push('기준 경로 30% 이상 통과');
    const score = reasons.length ? null : Math.round(metrics.path * .4 + metrics.speed * .25 + metrics.coverage * .2 + metrics.steady * .15);
    return { elapsed: this.elapsed, validTime: this.validTime, movingTime: this.movingTime, ratio, metrics, reasons, score };
  }

  finish() {
    return { version: VERSION, id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, createdAt: new Date().toISOString(), source: this.source, protocol: this.protocol, key: protocolKey(this.protocol), ...this.snapshot(), samples: this.samples, heat: this.heat };
  }
}

export function advice(sample, config) {
  if (!sample?.valid) return { title: '마커를 다시 확인하세요', detail: '색 테이프가 가려지지 않도록 화면 안에 놓아주세요.', tone: 'warn' };
  if (sample.speed === null) return { title: '움직임을 읽고 있어요', detail: '기준 경로를 따라 천천히 시작하세요.', tone: 'neutral' };
  if (sample.speed < .025) return { title: '천천히 움직여 보세요', detail: '정지한 시간은 동작 점수에 포함하지 않습니다.', tone: 'neutral' };
  if (sample.error > config.tolerance) return { title: '기준 경로 가까이 이동하세요', detail: '속도를 줄이고 점선과 펜 끝을 맞춰보세요.', tone: 'warn' };
  if (sample.speed > config.speedMax) return { title: '속도를 조금 낮춰보세요', detail: '정확하고 일정한 움직임을 먼저 연습하세요.', tone: 'warn' };
  if (sample.speed < config.speedMin) return { title: '일정하게 이어가세요', detail: '기준점의 흐름을 참고해 끊기지 않게 움직여 보세요.', tone: 'neutral' };
  return { title: '좋아요, 이 흐름을 유지하세요', detail: '기준 경로와 속도가 설정 범위에 들어왔습니다.', tone: 'good' };
}
