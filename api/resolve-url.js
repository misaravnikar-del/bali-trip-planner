export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body || {};
  if (!url) return res.json({});

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };

  function extractCoords(u) {
    let m;
    m = u.match(/!3d(-?\d+\.?\d+)!4d(-?\d+\.?\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = u.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+),[\d.]+z/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = u.match(/[?&]q=(-?\d+\.?\d+),(-?\d+\.?\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = u.match(/[?&]ll=(-?\d+\.?\d+),(-?\d+\.?\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
  }

  function extractName(u) {
    try {
      const m = u.match(/\/maps\/place\/([^/@?&+][^/@?]*)/);
      if (m) {
        const raw = m[1].split('/')[0];
        return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
      }
    } catch {}
    return null;
  }

  function extractCoordsFromHtml(html) {
    let m;
    // APP_INITIALIZATION_STATE format: [null,null,lat,lng]
    m = html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // meta canonical URL
    m = html.match(/content="https:\/\/www\.google\.com\/maps\/place\/[^"]*@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // og:url or canonical with @lat,lng
    m = html.match(/["']https:\/\/(?:www\.)?google\.com\/maps[^"']*@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // JSON-like coordinates in page data (Bali-specific range: lat -9 to -8, lng 114 to 116)
    m = html.match(/(-8\.\d{4,}),(-?\d+),\s*(11[45]\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[3]) };
    m = html.match(/"(-8\.\d{4,})","(11[45]\.\d{4,})"/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    // Generic lat/lng pattern in JS data
    m = html.match(/[",\[](-?\d+\.\d{5,})[",\]],[",\[](-?\d+\.\d{5,})/);
    if (m) {
      const a = parseFloat(m[1]), b = parseFloat(m[2]);
      // Bali is around -8.5, 115
      if (a > -10 && a < -7 && b > 113 && b < 117) return { lat: a, lng: b };
      if (b > -10 && b < -7 && a > 113 && a < 117) return { lat: b, lng: a };
    }
    return null;
  }

  function extractNameFromHtml(html) {
    let m;
    m = html.match(/<title>([^<]+) - Google Maps<\/title>/);
    if (m) return m[1].trim();
    m = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (m) return m[1].trim();
    return null;
  }

  try {
    // Step 1: manually follow redirects to capture each hop
    let currentUrl = url;
    let finalUrl = url;
    const visited = new Set();

    for (let i = 0; i < 8; i++) {
      if (visited.has(currentUrl)) break;
      visited.add(currentUrl);

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);

      let resp;
      try {
        resp = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: HEADERS,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }

      const location = resp.headers.get('location');
      finalUrl = currentUrl;

      // Check if current URL already has coords
      const earlyCoords = extractCoords(currentUrl);
      if (earlyCoords) {
        return res.json({ ...earlyCoords, name: extractName(currentUrl) });
      }

      if (location) {
        currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
        // Check redirect target for coords immediately
        const redirectCoords = extractCoords(currentUrl);
        if (redirectCoords) {
          return res.json({ ...redirectCoords, name: extractName(currentUrl) });
        }
        continue;
      }

      // No more redirects — read the HTML
      if (resp.status >= 200 && resp.status < 400) {
        const html = await resp.text().catch(() => '');
        const coordsHtml = extractCoordsFromHtml(html);
        const nameHtml = extractNameFromHtml(html) || extractName(currentUrl);
        if (coordsHtml) return res.json({ ...coordsHtml, name: nameHtml });
        return res.json({ name: nameHtml });
      }
      break;
    }

    // Fallback: try auto-follow
    const controller2 = new AbortController();
    const t2 = setTimeout(() => controller2.abort(), 6000);
    try {
      const r2 = await fetch(url, { method: 'GET', redirect: 'follow', headers: HEADERS, signal: controller2.signal });
      clearTimeout(t2);
      const fu = r2.url;
      const c = extractCoords(fu);
      const n = extractName(fu);
      if (c) return res.json({ ...c, name: n });
      const html2 = await r2.text().catch(() => '');
      const ch = extractCoordsFromHtml(html2);
      const nh = extractNameFromHtml(html2) || n;
      if (ch) return res.json({ ...ch, name: nh });
      return res.json({ name: nh });
    } finally {
      clearTimeout(t2);
    }
  } catch (e) {
    return res.json({});
  }
}
