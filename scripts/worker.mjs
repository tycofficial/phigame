// Serve an immutable, tested revision selected by the GitHub release workflow.
const ORIGIN = 'https://raw.githubusercontent.com/tycofficial/phigame';
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', wav: 'audio/wav' };
export function createWorker(fallback, fetcher = fetch, cacheProvider = () => globalThis.caches?.default) {
  async function cachedFetch(url, ttl, context) {
    const cache = cacheProvider();
    const key = new Request(url);
    const cached = cache && await cache.match(key);
    if (cached) return cached;
    const result = await fetcher(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
    if (cache && result.ok) {
      const copy = new Response(result.clone().body, result);
      copy.headers.set('Cache-Control', `public, max-age=${ttl}`);
      const put = cache.put(key, copy);
      if (context?.waitUntil) context.waitUntil(put); else await put;
    }
    return result;
  }
  return {
    async fetch(request, env, context) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const url = new URL(request.url);
      const match = url.pathname.match(/^\/_v\/([a-f0-9]{40})\/(.*)$/);
      let revision = match?.[1] || null;
      let path = match ? match[2] : url.pathname.slice(1);
      if (!path) path = 'index.html';
      if (!Object.hasOwn(fallback, path)) return new Response('Not found', { status: 404 });
      if (!revision) {
        try {
          const response = await cachedFetch(`${ORIGIN}/gh-pages/release.json`, 20, context);
          if (response.ok) {
            const release = await response.json();
            if (/^[a-f0-9]{40}$/.test(release.source)) revision = release.source;
          }
        } catch { /* Keep the bundled version available if GitHub is unavailable. */ }
      }
      let body;
      if (revision && path !== 'version.json') {
        const upstreamPath = path.startsWith('src/') ? path : `public/${path}`;
        try {
          const response = await cachedFetch(`${ORIGIN}/${revision}/${upstreamPath}`, 31536000, context);
          if (response.ok) body = await response.arrayBuffer();
        } catch { /* The complete bundled first release remains usable. */ }
      }
      if (!body) body = Uint8Array.from(atob(fallback[path]), c => c.charCodeAt(0));
      const extension = path.split('.').at(-1);
      if (extension === 'html' && revision) {
        body = new TextDecoder().decode(body).replace('<head>', `<head><base href="/_v/${revision}/">`).replace('<a href="./" aria-label="PHIGAME 首页">', '<a href="/" aria-label="PHIGAME 首页">');
      }
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: {
          'Content-Type': MIME[extension] || 'application/octet-stream',
          'Cache-Control': match && extension !== 'html' ? 'public, max-age=31536000, immutable' : 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-PHIGAME-Source': revision || 'bundled',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; base-uri 'self'; object-src 'none'"
        }
      });
    }
  };
}
