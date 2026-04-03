/**
 * Computes the solar terminator line (day/night boundary) for a given UTC time.
 * Returns an array of {lat, lon} points tracing the terminator.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Sun's ecliptic longitude (degrees) from Julian date */
function sunEclipticLon(JD: number): number {
  const n = JD - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) * DEG;
  return L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
}

/** Sun's declination and right ascension (degrees) */
function sunPosition(timestampMs: number): { dec: number; ra: number } {
  const JD = timestampMs / 86400000 + 2440587.5;
  const lon = sunEclipticLon(JD) * DEG;
  const obliquity = 23.439 * DEG;
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(lon)) * RAD;
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(lon), Math.cos(lon)) * RAD;
  return { dec, ra };
}

/** GMST in degrees */
function gmstDeg(timestampMs: number): number {
  const JD = timestampMs / 86400000 + 2440587.5;
  return ((280.46061837 + 360.98564736629 * (JD - 2451545.0)) % 360 + 360) % 360;
}

/**
 * Returns terminator polygon points as {lat, lon}[] for canvas drawing.
 * The terminator is the great circle 90° from the sub-solar point.
 */
export function getTerminatorPoints(timestampMs: number, steps = 180): Array<{ lat: number; lon: number }> {
  const { dec, ra } = sunPosition(timestampMs);
  const gst = gmstDeg(timestampMs);

  // Sub-solar longitude
  const subSolarLon = ra - gst;
  const subSolarLat = dec;

  const slLat = subSolarLat * DEG;
  const slLon = subSolarLon * DEG;

  const points: Array<{ lat: number; lon: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    // Rotate a point 90° from sub-solar point around the great circle
    const lat = Math.asin(
      Math.sin(slLat) * Math.cos(Math.PI / 2) +
      Math.cos(slLat) * Math.sin(Math.PI / 2) * Math.cos(angle)
    );
    const dlon = Math.atan2(
      Math.sin(angle) * Math.sin(Math.PI / 2) * Math.cos(slLat),
      Math.cos(Math.PI / 2) - Math.sin(slLat) * Math.sin(lat)
    );
    const lon = slLon + dlon;
    points.push({ lat: lat * RAD, lon: ((lon * RAD + 540) % 360) - 180 });
  }

  return points;
}

/**
 * Returns whether a lat/lon point is in the night side.
 */
export function isNightSide(lat: number, lon: number, timestampMs: number): boolean {
  const { dec, ra } = sunPosition(timestampMs);
  const gst = gmstDeg(timestampMs);
  const subSolarLon = ra - gst;
  const subSolarLat = dec;

  const latR = lat * DEG;
  const lonR = lon * DEG;
  const ssLatR = subSolarLat * DEG;
  const ssLonR = subSolarLon * DEG;

  // Dot product between point and sub-solar point on unit sphere
  const dot =
    Math.sin(latR) * Math.sin(ssLatR) +
    Math.cos(latR) * Math.cos(ssLatR) * Math.cos(lonR - ssLonR);

  return dot < 0;
}
