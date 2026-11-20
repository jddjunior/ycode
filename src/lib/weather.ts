/**
 * Event-day weather risk via Open-Meteo (free, no key). Inflatables must not
 * operate in sustained winds above the operator's limit (manufacturer/ASTM
 * guidance is typically 15–20 mph). Forecast horizon: 16 days.
 */
export interface WeatherRisk { day: string; maxWindMph: number; maxGustMph: number; precipProb: number; maxTempF: number; level: 'ok' | 'watch' | 'stop'; reasons: string[] }

const cache = new Map<string, { at: number; v: WeatherRisk | null }>();

export function assessRisk(day: string, wind: number, gust: number, precip: number, temp: number, windLimit = 20): WeatherRisk {
  const reasons: string[] = [];
  let level: WeatherRisk['level'] = 'ok';
  if (wind >= windLimit || gust >= windLimit + 10) { level = 'stop'; reasons.push(`Wind ${Math.round(wind)} mph (gusts ${Math.round(gust)}) exceeds the ${windLimit} mph limit`); }
  else if (wind >= windLimit - 5 || gust >= windLimit) { level = 'watch'; reasons.push(`Breezy: ${Math.round(wind)} mph, gusts ${Math.round(gust)}`); }
  if (precip >= 60) { level = level === 'stop' ? 'stop' : 'watch'; reasons.push(`${precip}% chance of rain`); }
  if (temp >= 95) { level = level === 'stop' ? 'stop' : 'watch'; reasons.push(`Heat ${Math.round(temp)}°F — vinyl gets hot; plan shade & water`); }
  return { day, maxWindMph: wind, maxGustMph: gust, precipProb: precip, maxTempF: temp, level, reasons };
}

export async function forecast(lat: number, lng: number, day: string, windLimit = 20): Promise<WeatherRisk | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${day}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3 * 3_600_000) return hit.v;
  const daysOut = (Date.parse(day) - Date.now()) / 86_400_000;
  if (daysOut > 16 || daysOut < -1) return null;
  try {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', String(lat)); u.searchParams.set('longitude', String(lng));
    u.searchParams.set('daily', 'wind_speed_10m_max,wind_gusts_10m_max,precipitation_probability_max,temperature_2m_max');
    u.searchParams.set('wind_speed_unit', 'mph'); u.searchParams.set('temperature_unit', 'fahrenheit');
    u.searchParams.set('timezone', 'auto'); u.searchParams.set('start_date', day); u.searchParams.set('end_date', day);
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { daily?: Record<string, number[]> };
    const d = j.daily ?? {};
    const v = assessRisk(day, d.wind_speed_10m_max?.[0] ?? 0, d.wind_gusts_10m_max?.[0] ?? 0, d.precipitation_probability_max?.[0] ?? 0, d.temperature_2m_max?.[0] ?? 0, windLimit);
    cache.set(key, { at: Date.now(), v });
    return v;
  } catch {
    cache.set(key, { at: Date.now(), v: null });
    return null;
  }
}
