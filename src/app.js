import { VERSION, HEIGHT, DEFAULTS, preset, pathInfo, pointAt, validateProtocol, Assessment, advice, clamp, distance } from './engine.js';
import { MarkerTracker, rgbToHsv } from './tracker.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d'), replay = $('replay'), replayCtx = replay.getContext('2d');
const sensor = document.createElement('canvas'); sensor.width = 320; sensor.height = 220;
const sensorCtx = sensor.getContext('2d', { willReadFrequently: true });
const video = $('camera-video'), tracker = new MarkerTracker();
const STORAGE = 'dental-motion-lab.sessions.v1';
const names = { arc: '곡선 스트로크', vertical: '직선 스트로크', wave: '방향 전환', custom: '나만의 기준 경로' };
const sourceNames = { demo: '데모', pointer: '마우스 연습', camera: '카메라' };
let source = 'demo', drill = 'arc', customPath = null, running = false, assessment = null, startTime = 0, lastFrame = 0;
let observation = null, pointer = null, cameraStream = null, calibrating = false, drawing = false, drawn = [], pointerDown = false;
let view = 'practice', selected = null, history = [], trail = [], replayPlaying = false, replayStart = 0;
let lastCoach = '', lastCoachAt = 0, pendingCoach = '', pendingSince = 0, toastTimer;
let importedConfig = null;

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
function clock(t) { return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
function number(v) { return v === null || !Number.isFinite(v) ? '—' : String(Math.round(v)); }
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function currentProtocol() {
  return { version: VERSION, name: names[drill], path: drill === 'custom' ? customPath : preset(drill), config: { ...DEFAULTS, ...importedConfig, duration: +$('duration').value, tolerance: +$('difficulty').value } };
}
function setView(next) {
  if (running && next !== 'practice') { toast('연습을 종료한 뒤 다른 화면으로 이동할 수 있습니다.'); return; }
  view = next; replayPlaying = false; $('play-replay').textContent = '재생 ▷';
  for (const e of document.querySelectorAll('.view')) e.hidden = e.id !== `view-${next}`;
  for (const e of document.querySelectorAll('[data-view]')) { e.classList.toggle('active', e.dataset.view === next); e.setAttribute('aria-current', e.dataset.view === next ? 'page' : 'false'); }
  if (next === 'progress') renderHistory();
  if (next === 'review' && selected) drawReplay(+$('replay-range').value / 1000 * selected.elapsed);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
document.querySelectorAll('[data-view]').forEach(e => e.addEventListener('click', () => setView(e.dataset.view)));
document.querySelectorAll('[data-go]').forEach(e => e.addEventListener('click', () => setView(e.dataset.go)));
document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); setView('practice'); });
$('tour-button').onclick = () => setView('method');

function stopCamera() { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; video.srcObject = null; $('camera-button').textContent = '카메라 연결'; $('calibrate-button').disabled = true; }
function setSource(next) {
  if (running || drawing) return;
  if (next !== 'camera') stopCamera();
  source = next; tracker.reset(); trail = []; observation = null; pointer = null; calibrating = false;
  document.querySelectorAll('[data-source]').forEach(e => e.classList.toggle('active', e.dataset.source === source));
  $('demo-controls').hidden = source !== 'demo'; $('camera-controls').hidden = source !== 'camera';
  $('source-badge').textContent = source === 'demo' ? '가상 마커 · 실제 색 추적' : source === 'pointer' ? '포인터로 움직임 연습' : '영상은 이 기기에서 처리';
  $('start-button').disabled = source === 'camera' && !cameraStream;
  setCoach({ title: source === 'camera' ? '펜과 카메라를 준비하세요' : source === 'pointer' ? '점선을 따라 포인터를 움직여보세요' : '먼저 데모로 흐름을 살펴보세요', detail: source === 'camera' ? '카메라를 연결한 뒤 마커의 색상을 선택하세요.' : source === 'pointer' ? '시작 후 마우스·터치 또는 방향키로 연습할 수 있습니다.' : '30초 동안 기준 경로를 따라가는 동작을 자동으로 보여드립니다.', tone: 'neutral' }, true);
  updateMetrics(null);
}
document.querySelectorAll('[data-source]').forEach(e => e.onclick = () => setSource(e.dataset.source));
$('camera-button').onclick = async () => {
  if (cameraStream) { stopCamera(); $('start-button').disabled = true; return; }
  $('camera-button').disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('지원되지 않는 환경입니다. HTTPS 주소 또는 localhost에서 열어주세요.');
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 660 }, facingMode: 'environment' }, audio: false });
    video.srcObject = cameraStream; await video.play();
    for (const track of cameraStream.getVideoTracks()) track.onended = () => { if (running) finish(); stopCamera(); $('start-button').disabled = true; toast('카메라 연결이 종료되었습니다.'); };
    $('camera-button').textContent = '카메라 연결 해제'; $('calibrate-button').disabled = false; $('start-button').disabled = false;
    toast('카메라가 연결되었습니다. 마커 색을 선택하고 추적 상태를 확인하세요.');
  } catch (e) {
    stopCamera();
    toast(e.name === 'NotAllowedError' ? '카메라 권한이 허용되지 않았습니다. 주소창의 사이트 권한에서 카메라를 허용해 주세요.' : e.name === 'NotFoundError' ? '사용할 수 있는 카메라를 찾지 못했습니다.' : `카메라를 연결하지 못했습니다. ${e.message}`);
  } finally { $('camera-button').disabled = false; }
};
$('calibrate-button').onclick = () => { calibrating = !calibrating; $('calibrate-button').textContent = calibrating ? '화면의 색 테이프를 클릭하세요' : '화면에서 마커 색 선택'; };
$('hue').oninput = () => { $('hue-value').textContent = `${$('hue').value}°`; tracker.reset(); };
$('tolerance').oninput = () => tracker.reset();

$('drill').onchange = () => { drill = $('drill').value; importedConfig = null; tracker.reset(); trail = []; $('stage-label').textContent = { arc: '01 / CURVED STROKE', vertical: '02 / LINEAR STROKE', wave: '03 / DIRECTION CHANGE', custom: '04 / YOUR REFERENCE' }[drill]; $('drill-description').textContent = { arc: '부드러운 곡선을 따라 일정한 속도로 왕복하세요.', vertical: '같은 선을 따라 위아래로 일정하게 움직이세요.', wave: '굽은 지점에서 속도를 조절하며 이어가세요.', custom: '직접 만든 기준 경로를 따라 연습하세요.' }[drill]; };
$('duration').onchange = () => $('timer-total').textContent = `/ ${clock(+$('duration').value)}`;

function lockSettings(locked) {
  document.querySelectorAll('[data-source],#drill,#duration,#difficulty,#scenario,#draw-path,#import-path,#camera-button,#calibrate-button,#hue,#tolerance').forEach(e => e.disabled = locked);
  if (!locked) $('calibrate-button').disabled = !cameraStream;
}
function start() {
  if (running || drawing || (source === 'camera' && !cameraStream)) return;
  assessment = new Assessment(currentProtocol(), source); running = true; startTime = performance.now(); trail = []; tracker.reset();
  $('start-button').hidden = true; $('stop-button').hidden = false; lockSettings(true); calibrating = false;
  $('timer').textContent = '00:00'; $('calibrate-button').textContent = '화면에서 마커 색 선택';
  if (source === 'pointer') { pointer = null; stage.focus(); }
}
function finish() {
  if (!running) return;
  running = false; lockSettings(false); $('start-button').hidden = false; $('stop-button').hidden = true;
  selected = assessment.finish(); history.unshift(selected); history = history.slice(0, 40); saveHistory(); showReport(selected); setView('review');
}
$('start-button').onclick = start; $('stop-button').onclick = finish;

function setCoach(next, force = false) {
  const now = performance.now();
  if (next.title !== pendingCoach) { pendingCoach = next.title; pendingSince = now; }
  if (!force && (next.title === lastCoach || now - pendingSince < 650 || now - lastCoachAt < 1500)) return;
  lastCoach = next.title; lastCoachAt = now;
  $('coach-title').textContent = next.title; $('coach-detail').textContent = next.detail; $('coach').classList.toggle('warn', next.tone === 'warn');
}
function updateMetrics(result) {
  for (const key of ['path', 'speed', 'steady', 'coverage']) {
    const v = result?.metrics[key] ?? null;
    $('metric-' + key).replaceChildren(document.createTextNode(number(v)), el('small', key === 'coverage' ? '%' : '/100'));
    $('bar-' + key).style.width = `${v ?? 0}%`;
  }
  $('tracked').textContent = result ? `${Math.round(result.ratio * 100)}%` : '—';
  $('moving').textContent = `${(result?.movingTime || 0).toFixed(1)}초`; $('live-score').textContent = number(result?.score ?? null);
  $('eligibility').textContent = !result ? '종합 점수는 충분한 움직임을 관찰한 뒤 표시합니다.' : result.reasons.length ? `관찰 중 · ${result.reasons.join(' / ')}` : '충분한 움직임이 관찰되었습니다. 같은 흐름으로 이어가세요.';
}

function position(event) { const r = stage.getBoundingClientRect(); return { x: clamp((event.clientX - r.left) / r.width, .02, .98), y: clamp((event.clientY - r.top) / r.width, .02, HEIGHT - .02) }; }
stage.onpointerdown = event => {
  const p = position(event);
  if (calibrating && cameraStream) {
    const pixel = sensorCtx.getImageData(Math.round(p.x * 320), Math.round(p.y * 320), 1, 1).data;
    const hsv = rgbToHsv(...pixel);
    if (hsv.s < .42 || hsv.v < .22) { toast('더 밝고 선명한 색 테이프를 선택해 주세요.'); return; }
    $('hue').value = Math.round(hsv.h); $('hue').oninput(); calibrating = false; $('calibrate-button').textContent = '화면에서 마커 색 선택'; toast('마커 색상이 설정되었습니다.'); return;
  }
  stage.setPointerCapture(event.pointerId); pointerDown = true;
  if (drawing) drawn = [p]; else if (source === 'pointer') pointer = { ...p, quality: 1 };
};
stage.onpointermove = event => {
  const p = position(event);
  if (drawing && pointerDown) { if (drawn.length < 500 && distance(drawn.at(-1), p) > .003) drawn.push(p); }
  else if (source === 'pointer' && !drawing) pointer = { ...p, quality: 1 };
};
stage.onpointerup = () => pointerDown = false;
stage.onpointercancel = () => { pointerDown = false; pointer = null; };
stage.onpointerleave = () => { if (!pointerDown) pointer = null; };
stage.onkeydown = event => {
  if (source !== 'pointer' || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault(); pointer ||= { ...currentProtocol().path[0], quality: 1 };
  if (event.key === 'ArrowUp') pointer.y -= .005; if (event.key === 'ArrowDown') pointer.y += .005;
  if (event.key === 'ArrowLeft') pointer.x -= .005; if (event.key === 'ArrowRight') pointer.x += .005;
  pointer.x = clamp(pointer.x, .02, .98); pointer.y = clamp(pointer.y, .02, HEIGHT - .02);
};
$('draw-path').onclick = () => {
  if (!drawing) {
    drawing = true; drawn = []; $('draw-path').textContent = '경로 적용 ✓'; $('record-overlay').hidden = false; $('start-button').disabled = true;
    document.querySelectorAll('[data-source],#drill,#import-path').forEach(e => e.disabled = true);
  } else {
    try {
      const raw = validateProtocol({ ...currentProtocol(), name: names.custom, path: drawn });
      customPath = Array.from({ length: 100 }, (_, i) => pointAt(pathInfo(raw.path), i / 99));
      $('drill').querySelector('[value=custom]').disabled = false; $('drill').value = 'custom'; $('drill').onchange();
      toast('새 기준 경로가 준비되었습니다.');
    } catch (e) { toast(`${e.message} 기본 경로를 유지합니다.`); }
    drawing = false; drawn = []; $('draw-path').textContent = '＋ 직접 기준 경로 그리기'; $('record-overlay').hidden = true;
    document.querySelectorAll('[data-source],#drill,#import-path').forEach(e => e.disabled = false); $('start-button').disabled = source === 'camera' && !cameraStream;
  }
};

function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = el('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-path').onclick = () => download('motion-lab-reference.json', JSON.stringify(currentProtocol(), null, 2));
$('import-path').onclick = () => $('path-file').click();
$('path-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 150000) throw new Error('150KB 이하의 경로 파일을 선택해 주세요.');
    const p = validateProtocol(JSON.parse(await file.text())); customPath = p.path; names.custom = p.name; importedConfig = p.config;
    $('drill').querySelector('[value=custom]').disabled = false; $('drill').querySelector('[value=custom]').textContent = p.name;
    $('drill').value = 'custom'; drill = 'custom';
    for (const [id, v] of [['duration', p.config.duration], ['difficulty', p.config.tolerance]]) {
      if (![...$(id).options].some(o => +o.value === v)) $(id).add(new Option(id === 'duration' ? `${v}초` : `사용자 설정 ${v}`, String(v)));
      $(id).value = String(v);
    }
    $('duration').onchange(); $('stage-label').textContent = '04 / YOUR REFERENCE'; $('drill-description').textContent = '불러온 기준 경로와 평가 설정을 사용합니다.'; tracker.reset(); trail = []; toast('기준 경로와 연습 설정을 불러왔습니다.');
  } catch (e) { toast(`불러오지 못했습니다. ${e.message}`); }
  event.target.value = '';
};

function saveHistory() {
  let trimmed = false;
  for (;;) {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(history));
      if (trimmed) toast('저장 공간이 부족해 오래된 세션부터 정리하고 최근 기록을 저장했습니다.');
      return;
    } catch (e) {
      if (e.name === 'QuotaExceededError' && history.length > 1) { history.pop(); trimmed = true; continue; }
      toast('브라우저에 기록을 저장하지 못했습니다. 결과를 JSON으로 내려받아 보관해 주세요.');
      return;
    }
  }
}
try { const saved = JSON.parse(localStorage.getItem(STORAGE) || '[]'); history = Array.isArray(saved) ? saved.filter(x => { try { validateProtocol(x.protocol); return x.version === VERSION && Array.isArray(x.samples) && x.samples.length <= 10000 && Number.isFinite(x.elapsed) && x.elapsed > 0 && Array.isArray(x.heat) && x.heat.length === 32; } catch { return false; } }).slice(0, 40) : []; } catch { history = []; }

function showReport(report) {
  selected = report; replayPlaying = false; $('review-empty').hidden = true; $('review-content').hidden = false;
  $('review-source').textContent = `${sourceNames[report.source]} · ${report.protocol.name}`;
  $('report-score').textContent = number(report.score); $('report-title').textContent = report.score === null ? '아직 관찰이 부족해요' : report.score >= 80 ? '좋은 흐름을 만들었어요' : '다음 연습의 힌트를 찾았어요';
  $('report-description').textContent = report.score === null ? `종합 점수 조건: ${report.reasons.join(' · ')}` : `${sourceNames[report.source]} 세션 · ${report.elapsed.toFixed(1)}초 관찰 · 유효 동작 ${report.movingTime.toFixed(1)}초`;
  $('report-metrics').replaceChildren();
  for (const [key, label] of [['path', '경로 정확도'], ['speed', '속도 적합도'], ['steady', '움직임 안정도'], ['coverage', '경로 커버리지']]) {
    const row = el('div', undefined, 'report-metric'); row.append(el('span', label), el('strong', `${number(report.metrics[key])}${key === 'coverage' ? '%' : ' / 100'}`)); $('report-metrics').append(row);
  }
  const weak = ['path', 'speed', 'steady', 'coverage'].sort((a, b) => (report.metrics[a] ?? 0) - (report.metrics[b] ?? 0))[0];
  $('report-next').textContent = report.score === null ? '다음에는 마커가 잘 보이는 상태에서 기준 경로 전체를 천천히 왕복해 보세요.' : { path: '다음 연습: 경로를 벗어나는 구간에서 속도를 낮춰보세요.', speed: '다음 연습: 움직이는 가이드의 속도를 참고해 보세요.', steady: '다음 연습: 방향을 바꿀 때 급하게 꺾지 않고 이어가세요.', coverage: '다음 연습: 아직 지나가지 않은 경로 끝부분까지 움직여보세요.' }[weak];
  $('heatmap').replaceChildren(...report.heat.map((b, i) => { const e = el('div'); const ratio = b.time ? b.error / b.time / report.protocol.config.tolerance : null; e.style.background = ratio === null ? '#e4e8df' : `hsl(${110 - clamp(ratio / 1.6) * 80} 32% ${72 - clamp(ratio / 1.6) * 15}%)`; e.title = `${i + 1}구간: ${ratio === null ? '관찰 없음' : `평균 오차 ${(b.error / b.time * 100).toFixed(1)}% (화면 너비 기준)`}`; return e; }));
  $('replay-range').value = '1000'; drawReplay(report.elapsed);
}
$('export-json').onclick = () => { if (selected) download(`motion-lab-${selected.createdAt.slice(0, 10)}.json`, JSON.stringify(selected)); };
$('export-csv').onclick = () => {
  if (!selected) return;
  const header = 'time_seconds,x_frame_width,y_frame_width,valid,signal_quality,speed_frame_width_per_second,path_error_frame_width,moving';
  const rows = selected.samples.map(s => [s.t, s.x, s.y, s.valid ? 1 : 0, s.quality, s.speed, s.error, s.moving ? 1 : 0].map(v => typeof v === 'number' ? v.toFixed(5) : '').join(','));
  download('motion-lab-coordinates.csv', [header, ...rows].join('\r\n'), 'text/csv;charset=utf-8');
};
$('print-report').onclick = () => window.print();
$('replay-range').oninput = () => { replayPlaying = false; $('play-replay').textContent = '재생 ▷'; drawReplay(+$('replay-range').value / 1000 * selected.elapsed); };
$('play-replay').onclick = () => {
  if (!selected) return; replayPlaying = !replayPlaying;
  if (replayPlaying) { if (+$('replay-range').value >= 1000) $('replay-range').value = 0; replayStart = performance.now() - +$('replay-range').value / 1000 * selected.elapsed * 1000; }
  $('play-replay').textContent = replayPlaying ? '일시정지 Ⅱ' : '재생 ▷';
};
function renderHistory() {
  const list = history.filter(r => r.source === $('history-source').value); $('history-empty').hidden = !!list.length;
  $('history-table').replaceChildren(...list.map(r => {
    const tr = el('tr'); const scoreCell = el('td'); scoreCell.append(el('strong', number(r.score)));
    const action = el('td'), button = el('button', '리뷰 ↗', 'text-button'); button.onclick = () => { showReport(r); setView('review'); }; action.append(button);
    tr.append(el('td', new Date(r.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), el('td', r.protocol.name), scoreCell, el('td', `${Math.round(r.ratio * 100)}%`), el('td', `${r.movingTime.toFixed(1)}초`), action); return tr;
  }));
  const latest = list.find(r => r.score !== null), previous = latest && list.slice(list.indexOf(latest) + 1).find(r => r.key === latest.key && r.score !== null);
  $('history-insight').textContent = previous ? `같은 연습 설정의 이전 세션 대비 ${latest.score - previous.score >= 0 ? '+' : ''}${latest.score - previous.score}점. 카메라 위치와 촬영 조건도 같을 때 의미 있는 비교가 됩니다.` : list.length ? '같은 경로와 연습 설정으로 두 번 완료하면 점수 변화를 확인할 수 있습니다.' : '오늘의 첫 연습을 시작해 보세요.';
}
$('history-source').onchange = renderHistory;
$('clear-history').onclick = () => {
  const kind = $('history-source').value;
  if (!history.some(r => r.source === kind)) { toast('삭제할 기록이 없습니다.'); return; }
  if (window.confirm(`${sourceNames[kind]} 기록을 이 브라우저에서 모두 삭제할까요?`)) { history = history.filter(r => r.source !== kind); saveHistory(); renderHistory(); toast('선택한 유형의 기록을 삭제했습니다.'); }
};

function pathStroke(c, points, color, width, dash = []) {
  if (points.length < 2) return;
  c.beginPath(); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash(dash);
  let begun = false;
  for (const p of points) { if (!p || p.x === null || p.valid === false) { begun = false; continue; } if (!begun) { c.moveTo(p.x * 960, p.y * 960); begun = true; } else c.lineTo(p.x * 960, p.y * 960); }
  c.stroke(); c.setLineDash([]);
}
function background(c) {
  const g = c.createLinearGradient(0, 0, 960, 660); g.addColorStop(0, '#163531'); g.addColorStop(1, '#102b29'); c.fillStyle = g; c.fillRect(0, 0, 960, 660);
  c.fillStyle = '#7ba28d23';
  for (let x = 24; x < 960; x += 32) for (let y = 20; y < 660; y += 32) { c.beginPath(); c.arc(x, y, 1, 0, Math.PI * 2); c.fill(); }
  c.save(); c.translate(480, 336); c.scale(1.35, 1.35);
  c.beginPath(); c.moveTo(-88, -129); c.bezierCurveTo(-25, -166, -12, -125, 0, -128); c.bezierCurveTo(30, -157, 95, -159, 116, -103); c.bezierCurveTo(153, -30, 81, 56, 63, 145); c.bezierCurveTo(44, 201, 13, 41, -4, 41); c.bezierCurveTo(-27, 32, -56, 194, -76, 144); c.bezierCurveTo(-91, 75, -161, -76, -88, -129);
  c.fillStyle = '#b7d5b109'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#b6d6b425'; c.stroke();
  c.beginPath(); c.moveTo(-65, -103); c.bezierCurveTo(-16, -87, 10, -80, 75, -112); c.stroke(); c.restore();
}
function dot(c, p, ghost = false) {
  if (!p || !Number.isFinite(p.x) || p.quality < .7) return;
  c.beginPath(); c.arc(p.x * 960, p.y * 960, ghost ? 12 : 8, 0, Math.PI * 2);
  if (ghost) { c.strokeStyle = '#d7edb6a0'; c.lineWidth = 2; c.stroke(); }
  else { c.fillStyle = '#ff99cc'; c.shadowColor = '#fc94cb'; c.shadowBlur = 17; c.fill(); c.shadowBlur = 0; c.beginPath(); c.arc(p.x * 960, p.y * 960, 17, 0, Math.PI * 2); c.strokeStyle = '#ff9dcc44'; c.lineWidth = 1.4; c.stroke(); }
}
function drawScene(c, protocol, points = [], current = null, ghost = null, camera = false) {
  background(c);
  if (camera && cameraStream && video.readyState >= 2) { c.drawImage(sensor, 0, 0, 960, 660); c.fillStyle = '#0a282d35'; c.fillRect(0, 0, 960, 660); }
  pathStroke(c, protocol.path, '#c2e8910a', protocol.config.tolerance * 1920);
  pathStroke(c, protocol.path, '#d4edab99', 2, [5, 9]);
  for (const [i, p] of [protocol.path[0], protocol.path.at(-1)].entries()) {
    c.beginPath(); c.arc(p.x * 960, p.y * 960, 5, 0, Math.PI * 2); c.fillStyle = '#c4dd9f'; c.fill(); c.fillStyle = '#a1bca0'; c.font = '10px sans-serif'; c.textAlign = 'center'; c.fillText(i ? 'B' : 'A', p.x * 960, p.y * 960 + 26);
  }
  pathStroke(c, points, '#e8a1c6a0', 2.5); dot(c, ghost, true); dot(c, current);
}
function demoFrame(t, protocol) {
  const mode = $('scenario').value, info = pathInfo(protocol.path);
  const speed = mode === 'fast' ? .68 : .17;
  const f = (t * speed / info.total) % 2; const p = pointAt(info, f <= 1 ? f : 2 - f);
  if (mode === 'still') Object.assign(p, pointAt(info, .5));
  if (mode === 'drift') p.y += .065 + Math.sin(t * 1.6) * .025;
  sensorCtx.fillStyle = '#183530'; sensorCtx.fillRect(0, 0, 320, 220);
  if (!(mode === 'lost' && t % 5 > 1.6)) {
    sensorCtx.fillStyle = '#f542a4'; sensorCtx.beginPath(); sensorCtx.arc(p.x * 320, p.y * 320, 5.5, 0, Math.PI * 2); sensorCtx.fill();
    if (mode === 'ambiguous') { sensorCtx.beginPath(); sensorCtx.arc(40, 60, 5.5, 0, Math.PI * 2); sensorCtx.fill(); }
  }
}
function cameraFrame() {
  const sw = video.videoWidth, sh = video.videoHeight; if (!sw || !sh) return false;
  const aspect = 960 / 660; const cw = Math.min(sw, sh * aspect), ch = cw / aspect;
  sensorCtx.drawImage(video, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 320, 220); return true;
}
function drawReplay(t) {
  if (!selected) return;
  const points = selected.samples.filter(s => s.t <= t); const last = points.at(-1);
  drawScene(replayCtx, selected.protocol, points, last?.valid ? last : null);
  $('replay-time').textContent = clock(t);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastFrame < 1000 / 30) return;
  const dt = Math.min(.2, (now - lastFrame) / 1000 || 1 / 30); lastFrame = now;
  if (view === 'review' && replayPlaying && selected) {
    const t = Math.min(selected.elapsed, (now - replayStart) / 1000); $('replay-range').value = t / selected.elapsed * 1000; drawReplay(t);
    if (t >= selected.elapsed) { replayPlaying = false; $('play-replay').textContent = '재생 ▷'; }
  }
  if (view !== 'practice') return;
  const protocol = currentProtocol(), t = running ? Math.min(protocol.config.duration, (now - startTime) / 1000) : now / 1000;
  if (source === 'demo') { demoFrame(t, protocol); observation = tracker.update(sensorCtx.getImageData(0, 0, 320, 220), 328, 24, dt); }
  else if (source === 'camera' && cameraStream && cameraFrame()) observation = tracker.update(sensorCtx.getImageData(0, 0, 320, 220), +$('hue').value, +$('tolerance').value, dt);
  else observation = source === 'pointer' ? pointer : null;
  const valid = observation && observation.quality >= .7 && !observation.ambiguous;
  $('signal').replaceChildren(el('i'), document.createTextNode(valid ? '마커 감지' : source === 'camera' && !cameraStream ? '카메라 연결 전' : observation?.ambiguous ? '색상 혼동 · 점수 제외' : '추적 대기'));
  if (running) {
    const sample = assessment.add(t, observation);
    const result = assessment.snapshot(); updateMetrics(result); setCoach(advice(sample, protocol.config));
    $('timer').textContent = clock(t); $('session-progress-fill').style.width = `${t / protocol.config.duration * 100}%`;
    trail.push(sample?.valid ? sample : null); if (trail.length > 150) trail.shift();
    if (t >= protocol.config.duration) { finish(); return; }
  }
  const info = pathInfo(protocol.path), cycle = t * .17 / info.total % 2;
  const ghost = $('ghost').checked ? pointAt(info, cycle > 1 ? 2 - cycle : cycle) : null;
  drawScene(ctx, protocol, trail, valid ? observation : null, ghost, source === 'camera');
  if (drawing) pathStroke(ctx, drawn, '#f1edcc', 4);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { finish(); toast('다른 화면으로 이동하여 세션을 종료했습니다.'); } });
window.addEventListener('pagehide', stopCamera);
if (history.length) showReport(history[0]);
setSource('demo'); requestAnimationFrame(frame);
