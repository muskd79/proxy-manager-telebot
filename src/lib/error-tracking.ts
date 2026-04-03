/**
 * Error tracking module.
 *
 * Currently logs to console with structured JSON format (optimized for Vercel logs).
 * To enable Sentry:
 *   1. npm install @sentry/nextjs
 *   2. npx @sentry/wizard@latest -i nextjs
 *   3. Set NEXT_PUBLIC_SENTRY_DSN in Vercel env vars
 *   4. Uncomment Sentry.init() and Sentry.captureException() in this file
 *   5. Optionally add sentry.client.config.ts and sentry.server.config.ts
 *
 * This module provides a unified interface so switching
 * to Sentry (or any other provider) requires no code changes
 * in the rest of the codebase.
 */

// import * as Sentry from "@sentry/nextjs";

// Sentry.init({
//   dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
//   tracesSampleRate: 0.1,
//   environment: process.env.NODE_ENV,
// });

interface ErrorContext {
  /** Where the error occurred (e.g., "api.proxies.create", "cron.health-check") */
  source: string;
  /** Additional metadata */
  extra?: Record<string, unknown>;
  /** User identifier */
  userId?: string;
  /** Error severity */
  level?: "error" | "warning" | "info";
}

/**
 * Capture an error with context.
 * Currently logs to console. Replace with Sentry when ready.
 */
export function captureError(error: unknown, context: ErrorContext): void {
  const { source, extra, userId, level = "error" } = context;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Structured log format for Vercel logs
  const logEntry = {
    level,
    source,
    message: errorMessage,
    stack: errorStack,
    userId,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  if (level === "error") {
    console.error(`[${source}]`, JSON.stringify(logEntry));
  } else if (level === "warning") {
    console.warn(`[${source}]`, JSON.stringify(logEntry));
  } else {
    console.info(`[${source}]`, JSON.stringify(logEntry));
  }

  // TODO: Uncomment when Sentry is installed
  // if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  //   Sentry.captureException(error, {
  //     tags: { source },
  //     extra,
  //     user: userId ? { id: userId } : undefined,
  //     level,
  //   });
  // }
}

/**
 * Capture a message (non-error event).
 */
export function captureMessage(
  message: string,
  context: Omit<ErrorContext, "level"> & { level?: "warning" | "info" },
): void {
  const { source, extra, level = "info" } = context;

  const logEntry = {
    level,
    source,
    message,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  if (level === "warning") {
    console.warn(`[${source}]`, JSON.stringify(logEntry));
  } else {
    console.info(`[${source}]`, JSON.stringify(logEntry));
  }

  // TODO: Uncomment when Sentry is installed
  // if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  //   Sentry.captureMessage(message, {
  //     tags: { source },
  //     extra,
  //     level,
  //   });
  // }
}
