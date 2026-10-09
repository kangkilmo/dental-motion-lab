import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', ({'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await fs.mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.clock.install();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.clock.runFor(100);
await page.screenshot({ path: 'test-results/desktop-practice.png', fullPage: true });
await page.locator('#start-button').click();
await page.clock.runFor(31000);
assert.equal(await page.locator('#view-review').isVisible(), true);
const good = await page.locator('#report-score').textContent();
assert.ok(Number(good) > 80, `Good score was ${good}`);
await page.screenshot({ path: 'test-results/desktop-review.png', fullPage: true });
await page.locator('#play-replay').click(); await page.clock.runFor(3000);
assert.notEqual(await page.locator('#replay-time').textContent(), '00:00');
const downloadPromise = page.waitForEvent('download'); await page.locator('#export-csv').click();
const download = await downloadPromise; await download.saveAs('test-results/export-test.csv');
assert.ok((await fs.readFile('test-results/export-test.csv', 'utf8')).split('\n').length > 500);
await page.locator('[data-view=practice]').click();
await page.locator('#scenario').selectOption('still'); await page.locator('#start-button').click(); await page.clock.runFor(31000);
assert.equal(await page.locator('#report-score').textContent(), '—');
await page.locator('[data-view=practice]').click();
await page.locator('#scenario').selectOption('lost'); await page.locator('#start-button').click(); await page.clock.runFor(31000);
assert.equal(await page.locator('#report-score').textContent(), '—');
await page.locator('[data-view=progress]').click();
assert.equal(await page.locator('#history-empty').isVisible(), true);
await page.locator('#history-source').selectOption('demo'); assert.equal(await page.locator('#history-table tr').count(), 3);
await page.reload(); await page.locator('[data-view=progress]').click(); await page.locator('#history-source').selectOption('demo');
assert.equal(await page.locator('#history-table tr').count(), 3);
await page.locator('[data-view=practice]').click(); await page.locator('[data-source=camera]').click();
await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
await page.locator('#camera-button').click(); assert.ok((await page.locator('#toast').textContent()).includes('권한'));
await page.locator('[data-source=pointer]').click();
await page.locator('#draw-path').click();
const box = await page.locator('#stage').boundingBox();
await page.mouse.move(box.x + box.width * .25, box.y + box.width * .25); await page.mouse.down();
await page.mouse.move(box.x + box.width * .75, box.y + box.width * .35, { steps: 25 }); await page.mouse.up();
await page.locator('#draw-path').click(); assert.equal(await page.locator('#drill').inputValue(), 'custom');
await page.locator('[data-view=method]').click(); await page.screenshot({ path: 'test-results/desktop-method.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-view=practice]').click();
await page.locator('[data-source=demo]').click(); await page.screenshot({ path: 'test-results/mobile-practice.png', fullPage: true });
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile overflows viewport');
assert.deepEqual(errors, []);
console.log(JSON.stringify({ goodScore: good, sessions: 3, errors, checks: ['normal/still/lost sessions', 'replay', 'CSV export', 'persistence', 'source separation', 'camera permission denial', 'custom reference', 'mobile overflow'] }));
} finally { await browser.close(); server.close(); }
