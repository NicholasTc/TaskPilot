/**
 * Minimal date/time helpers used by the planner.
 *
 * The planner deals in local date strings ("YYYY-MM-DD") and local time
 * strings ("HH:mm") — it never touches the host's timezone. Every helper
 * here is pure and string-based so the engine stays deterministic.
 *
 * We deliberately avoid date-fns / dayjs so there is zero runtime surface
 * and zero ambiguity about how dates are normalized.
 */

export const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function isValidDayKey(value: string): boolean {
  if (!DAY_KEY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

export function isValidTime(value: string): boolean {
  if (!TIME_PATTERN.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

/** "10:30" → 630 (minutes since midnight). */
export function hhmmToMinutes(value: string): number {
  if (!isValidTime(value)) {
    throw new Error(`Invalid time string: ${value}`);
  }
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** 630 → "10:30". Clamped to [0, 1439]. */
export function minutesToHhmm(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) {
    throw new Error(`Invalid minutes: ${totalMinutes}`);
  }
  const clamped = Math.max(0, Math.min(1439, Math.floor(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Add N days to a "YYYY-MM-DD" string, returning a new "YYYY-MM-DD".
 * Uses UTC math so DST / host-timezone never shifts the result.
 */
export function addDays(dayKey: string, days: number): string {
  if (!isValidDayKey(dayKey)) {
    throw new Error(`Invalid dayKey: ${dayKey}`);
  }
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Lexicographic compare works for well-formed "YYYY-MM-DD" strings. */
export function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Get today's local dayKey. Exposed mainly so callers outside the engine
 * can build a `PlanDayInput.today`. The engine itself never calls this.
 */
export function todayDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
