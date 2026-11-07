import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../scripts/worker.mjs';
const revision = '1234567890123456789012345678901234567890';
const encode = text => Buffer.from(text).toString('base64');
const fallback = { 'index.html': encode('<html><head></head><body>fallback</body></html>'), 'src/app.js': encode('fallback script') };
test('release pointer pins HTML and relative assets to a tested source revision', async () => {
  const requests = [];
  const worker = createWorker(fallback, async url => {
    requests.push(url);
    if (url.endsWith('/release.json')) return Response.json({ source: revision });
    if (url.endsWith('/public/index.html')) return new Response('<html><head></head><body>released</body></html>');
    return new Response('released script');
  }, () => null);
  const page = await worker.fetch(new Request('https://game.example/'));
  assert.equal(page.headers.get('X-PHIGAME-Source'), revision);
  const html = await page.text(); assert.ok(html.includes(`<base href="/_v/${revision}/">`)); assert.ok(html.includes('released'));
  const asset = await worker.fetch(new Request(`https://game.example/_v/${revision}/src/app.js`));
  assert.equal(await asset.text(), 'released script'); assert.ok(asset.headers.get('Cache-Control').includes('immutable'));
  assert.ok(requests.includes(`https://raw.githubusercontent.com/tycofficial/phigame/${revision}/src/app.js`));
});
test('bundled game stays available when GitHub is unavailable', async () => {
  const worker = createWorker(fallback, async () => { throw new Error('offline'); }, () => null);
  const page = await worker.fetch(new Request('https://game.example/'));
  assert.equal(page.status, 200); assert.ok((await page.text()).includes('fallback'));
});
test('only shipped assets and GET/HEAD requests pass through the delivery worker', async () => {
  const worker = createWorker(fallback, async () => { throw new Error('must not fetch'); }, () => null);
  assert.equal((await worker.fetch(new Request('https://game.example/secrets'))).status, 404);
  assert.equal((await worker.fetch(new Request('https://game.example/', { method: 'POST' }))).status, 405);
});
