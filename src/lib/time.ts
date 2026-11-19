/** Timezone helpers without external deps (Intl-based). */

/** Offset in minutes of `tz` at the given UTC instant (e.g. -300 for CDT). */
export function tzOffsetMinutes(utc: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(utc).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/** Convert a wall-clock time in `tz` to a UTC Date. `day` = 'YYYY-MM-DD'. */
export function zonedToUtc(day: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const off1 = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(first, tz);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

/** 'YYYY-MM-DD' for a UTC instant as seen in `tz`. */
export function localDay(utc: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(utc);
}

export function formatLocal(utc: Date, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(utc);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function isValidDay(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day + 'T00:00:00Z'));
}

export function hoursBetween(a: Date, b: Date) { return (b.getTime() - a.getTime()) / 3_600_000; }
