// @scripts/utils/time.ts

/** Format ms → "H M S" dengan menit/detik zero-padded. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return "0H 00M 00S";
  ms = Math.max(0, Math.floor(ms));

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}H ${String(minutes).padStart(2, "0")}M ${String(seconds).padStart(2, "0")}S`;
}

/** Tidur selama ms (typed). */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Hitung ms untuk exponential backoff. attempt mulai dari 0. */
export function expoBackoffMs(
  attempt: number,
  baseMs = 1000,
  factor = 1.6,
  capMs = 30_000,
  jitter = true
): number {
  const a = Math.max(0, attempt);
  let ms = Math.min(capMs, Math.floor(baseMs * Math.pow(factor, a)));
  if (jitter) ms = Math.floor(ms * (0.7 + Math.random() * 0.6));
  return ms;
}

/** Sleep dengan exponential backoff. */
export async function sleepBackoff(
  attempt: number,
  baseMs = 1000,
  factor = 1.6,
  capMs = 30_000,
  jitter = true
): Promise<void> {
  const ms = expoBackoffMs(attempt, baseMs, factor, capMs, jitter);
  await sleep(ms);
}
