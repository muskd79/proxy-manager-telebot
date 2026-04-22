/**
 * Extract real client IP from request headers.
 *
 * Priority: x-real-ip (Vercel sets this, unspoofable)
 *        -> x-forwarded-for (LAST entry, closest proxy — not first, which is client-controlled)
 *        -> 'unknown'
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const lastIp = parts[parts.length - 1]?.trim();
    if (lastIp) return lastIp;
  }

  return "unknown";
}
