export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body || {};
  if (!url) return res.json({});

  function extractCoords(u) {
    let m;
    m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = u.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = u.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+),\d+/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
  }

  function extractName(u) {
    try {
      // /maps/place/Place+Name/ or /maps/place/Place%20Name/
      const m = u.match(/\/maps\/place\/([^/@?]+)/);
      if (m) {
        return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
      }
    } catch {}
    return null;
  }

  try {
    // Follow redirects with GET to get final URL
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      signal: AbortSignal.timeout(8000),
    });
    const finalUrl = r.url;

    const coords = extractCoords(finalUrl);
    const name = extractName(finalUrl);

    // If no coords in URL, try to extract from page HTML
    if (!coords) {
      const html = await r.text();
      // Look for coords in page source
      const cm = html.match(/"(-8\.\d+)","(115\.\d+)"/) || html.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (cm) {
        return res.json({ lat: parseFloat(cm[1]), lng: parseFloat(cm[2]), name });
      }
    }

    return res.json({ ...( coords || {}), name: name || null });
  } catch (e) {
    return res.json({});
  }
}
