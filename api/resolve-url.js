export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let { url } = req.body || {};
  if (!url) return res.json({});

  // Strip app-specific params that break web redirects
  try {
    const u = new URL(url);
    u.searchParams.delete('g_st');
    u.searchParams.delete('entry');
    url = u.toString();
  } catch {}

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  function coords(u) {
    let m;
    m = u.match(/!3d(-?\d+\.?\d+)!4d(-?\d+\.?\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+),[\d.]+z/);
    if (m) return { lat: +m[1], lng: +m[2] };
    m = u.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    m = u.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    return null;
  }

  function name(u) {
    try {
      const m = u.match(/\/maps\/place\/([^/@?&+][^/@?+]*)/);
      if (m) return decodeURIComponent(m[1].split('/')[0].replace(/\+/g, ' ')).trim();
    } catch {}
    return null;
  }

  function coordsHtml(html) {
    let m;
    // Canonical / og:url containing @lat,lng
    m = html.match(/google\.com\/maps\/[^"']*@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2] };
    // APP_INITIALIZATION_STATE
    m = html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
    if (m) return { lat: +m[1], lng: +m[2] };
    // window.APP_INITIALIZATION_STATE or similar JSON blobs
    m = html.match(/"(-?\d+\.\d{5,})","(-?\d+\.\d{5,})"/g);
    if (m) {
      for (const s of m) {
        const p = s.match(/"(-?\d+\.\d{5,})","(-?\d+\.\d{5,})"/);
        if (p) {
          const a = +p[1], b = +p[2];
          if (a > -90 && a < 90 && b > -180 && b < 180 && !(a === 0 && b === 0)) {
            return { lat: a, lng: b };
          }
        }
      }
    }
    return null;
  }

  function nameHtml(html) {
    let m;
    m = html.match(/<title>([^<|]+)/);
    if (m && !m[1].includes('Google Maps')) return m[1].trim();
    m = html.match(/<title>([^<]+) - Google Maps/);
    if (m) return m[1].trim();
    m = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
    if (m) return m[1].trim();
    return null;
  }

  // Follow redirects manually, checking each hop
  async function resolve(startUrl) {
    let cur = startUrl;
    const seen = new Set();

    for (let i = 0; i < 10; i++) {
      if (seen.has(cur)) break;
      seen.add(cur);

      const c = coords(cur);
      if (c) return { ...c, name: name(cur) };

      let resp;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 7000);
        resp = await fetch(cur, {
          redirect: 'manual',
          headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
          signal: ctrl.signal,
        });
        clearTimeout(t);
      } catch { break; }

      const loc = resp.headers.get('location');
      if (loc) {
        cur = loc.startsWith('http') ? loc : new URL(loc, cur).href;
        continue;
      }

      // Final page — read HTML
      const html = await resp.text().catch(() => '');

      // Check for meta-refresh redirect
      const mr = html.match(/<meta[^>]+http-equiv="refresh"[^>]+content="[^"]*url=([^"']+)/i)
                || html.match(/window\.location\s*=\s*["']([^"']+)/);
      if (mr) { cur = mr[1].startsWith('http') ? mr[1] : new URL(mr[1], cur).href; continue; }

      const ch = coordsHtml(html);
      const nh = nameHtml(html) || name(cur);
      return ch ? { ...ch, name: nh } : { name: nh };
    }
    return {};
  }

  const result = await resolve(url).catch(() => ({}));
  res.json(result || {});
}
