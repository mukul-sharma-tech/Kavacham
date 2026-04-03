/**
 * Parse satellite id from standardized burn_id strings (EVASION_, RECOVERY_, AUTONOMOUS_*, etc.).
 */
export const BURN_ID_PREFIX_REGEX =
  /(?:EVASION|RECOVERY|GRAVEYARD|STATION_KEEPING|MANUAL|DEMO_|AUTONOMOUS_[A-Z_]+)_([^_]+(?:-[^_]+)*?)_\d/;

export function parseSatelliteIdFromBurnId(burnId: string): string | null {
  const m = burnId.match(BURN_ID_PREFIX_REGEX);
  return m ? m[1] : null;
}
