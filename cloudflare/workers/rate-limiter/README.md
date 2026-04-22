# Rate Limiter — Cloudflare Worker + Durable Object

Token-bucket rate limiter fronting every vendor API call. One DO instance
per `(vendor_slug, scope)` key; single-threaded per instance so the bucket
math is race-free without explicit locking.

## Architecture

```
Vercel Next.js (src/lib/vendors/saga/drain.ts)
  └─ rateLimitTake({vendorSlug, scope, cost})
       ↓ HMAC-SHA256 signed request
       ↓ (X-RL-Signature, X-RL-Key-Id)
CF Worker fetch handler (src/index.ts)
  ├─ parse body, size-check
  ├─ verifyHmac()            ← clock-skew + nonce-replay checks
  ├─ key-guard.assertValidKey()
  └─ idFromName(key) → TokenBucketDO
       ↓
TokenBucketDO (src/token-bucket.ts)
  ├─ storage: tokens, capacity, refillPerSec, lastRefill, lastAccessed
  ├─ consume(cost) — lazy refill, single-threaded
  └─ alarm() — 7-day GC of idle buckets
```

## Security model

- **Authentication** — HMAC-SHA256 with dual keys (primary + secondary)
  for zero-downtime rotation.
- **Signing input** — `hmac/v1:<ts>:<keyId>:<METHOD>:<host>:<path>:<sortedQuery>:<bodyHash>`.
  Covers query params and body tampering; binds to this Worker's host.
- **Replay defence** — timestamp window `-10s..+5s` PLUS nonce-KV store
  with 15s TTL. An attacker who captures one request cannot replay it.
- **Key-space defence** — `KEY_RE` regex at Worker entrypoint prevents
  unbounded DO instance creation by rejecting malformed `credential_id`.
- **Timing hardening** — HMAC verification path is constant-time. Unknown
  key IDs still compute the HMAC to neutralise key-lookup timing leaks.
- **Bounded storage** — every `consume` schedules a 7-day alarm; idle
  buckets self-destruct on wakeup.

## Setup (one-time)

```bash
cd cloudflare/workers/rate-limiter
npm install
npx wrangler login

# Create the nonce KV namespace and paste the returned id into wrangler.toml
npx wrangler kv:namespace create nonce_store

# Generate strong HMAC secrets (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set secrets (paste generated values when prompted)
npx wrangler secret put RL_SHARED_SECRET_PRIMARY
npx wrangler secret put RL_SHARED_SECRET_SECONDARY
npx wrangler secret put RL_ADMIN_SECRET

# Deploy
npx wrangler deploy
```

After deploy, on Vercel (all environments), set:

```
RL_WORKER_URL=https://rate-limiter.<your-account>.workers.dev
RL_SHARED_SECRET=<same value as RL_SHARED_SECRET_PRIMARY>
RL_KEY_ID=primary
```

Then redeploy Vercel (or `vercel env pull` + `vercel --prod`).

## Smoke test

```bash
# From anywhere with the primary secret:
TS=$(date +%s)
KEY="webshare:default"
BODY='{"key":"webshare:default","capacity":30,"refillPerSec":0.5,"cost":1}'
HOST=rate-limiter.<account>.workers.dev
BODY_HASH=$(printf "%s" "$BODY" | openssl dgst -sha256 -hex | awk '{print $2}')
INPUT="hmac/v1:${TS}:primary:POST:${HOST}:/take::${BODY_HASH}"
SIG=$(printf "%s" "$INPUT" | openssl dgst -sha256 -hmac "$RL_SHARED_SECRET_PRIMARY" -hex | awk '{print $2}')

curl -X POST "https://${HOST}/take" \
  -H "content-type: application/json" \
  -H "x-rl-key-id: primary" \
  -H "x-rl-signature: t=${TS},v1=${SIG}" \
  -d "$BODY"
```

Expected: `{"allowed":true,"tokensLeft":29,"retryAfterMs":0}` the first 30
times, then 429 with `Retry-After` header until tokens refill.

## Rotating the shared secret

1. `wrangler secret put RL_SHARED_SECRET_SECONDARY` (new value)
2. Deploy — Worker now accepts both.
3. Update Vercel env `RL_SHARED_SECRET` to the new value AND flip
   `RL_KEY_ID` to `secondary`. Redeploy Vercel.
4. **Wait 30 minutes** for all Vercel warm instances to cycle onto the new
   key. (This is the step @security-reviewer flagged as critical.)
5. `wrangler secret put RL_SHARED_SECRET_PRIMARY` (copy new value to primary).
6. Flip Vercel `RL_KEY_ID` back to `primary`. Redeploy.
7. Retire the old secret from your password manager.

## Observability

The Worker emits analytics events to the `rate_limiter_take_events`
dataset. Query via Workers Analytics SQL:

```sql
-- Deny ratio per vendor per 5min window
SELECT index1 AS vendor,
       countIf(blob3 = 'deny') * 1.0 / count() AS deny_ratio,
       toStartOfInterval(timestamp, INTERVAL '5' MINUTE) AS bucket
FROM rate_limiter_take_events
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY vendor, bucket
ORDER BY bucket DESC
```

Alert thresholds:
- `deny_ratio > 0.5 for 5min` → vendor near bill cap or capacity misconfigured
- Auth failures > 10/min → rotation bug or attack

## Testing

```bash
npm test
```

Unit tests cover: token-bucket math, lazy refill, cold-start init,
concurrent `consume` serialization, HMAC sign+verify, replay rejection,
key-guard regex.

Integration tests run against `miniflare` (shipped with
`@cloudflare/vitest-pool-workers`).

## Files

```
src/
  index.ts         # Worker fetch handler, routes /take /peek /reset
  token-bucket.ts  # TokenBucketDO class
  hmac.ts          # verifyHmac + signingInput + constant-time compare
  key-guard.ts     # KEY_RE + assertValidKey
  types.ts         # Env binding + request/response types
  __tests__/       # vitest suites
wrangler.toml      # DO + KV + Analytics bindings, env vars
tsconfig.json      # target ES2022 + @cloudflare/workers-types
package.json       # wrangler + vitest
```
