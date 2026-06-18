export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { url } = req.body;

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

  async function resolveCoords(u) {
    try {
      let finalUrl = u;
      for (let i = 0; i < 5; i++) {
        const r = await fetch(finalUrl, { method: 'HEAD', redirect: 'manual' });
        const loc = r.headers.get('location');
        if (!loc) break;
        finalUrl = loc.startsWith('http') ? loc : new URL(loc, finalUrl).href;
      }
      return extractCoords(finalUrl);
    } catch { return null; }
  }

  const coords = extractCoords(url || '') || await resolveCoords(url || '');
  res.json(coords || {});
}
