import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("Invalid Supabase URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10, "Supabase anon key required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10, "Supabase service role key required"),
  TELEGRAM_BOT_TOKEN: z.string().min(10, "Telegram bot token required"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(10, "Webhook secret required for security"),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Environment variable validation failed:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    // Don't throw in build - just warn
    if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder")) {
      throw new Error("Missing required environment variables");
    }
    // Return partial env for build
    return process.env as unknown as Env;
  }

  _env = parsed.data;
  return _env;
}

// Convenience exports
export const env = {
  get supabaseUrl() { return getEnv().NEXT_PUBLIC_SUPABASE_URL; },
  get supabaseAnonKey() { return getEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY; },
  get supabaseServiceKey() { return getEnv().SUPABASE_SERVICE_ROLE_KEY; },
  get telegramBotToken() { return getEnv().TELEGRAM_BOT_TOKEN; },
  get telegramWebhookSecret() { return getEnv().TELEGRAM_WEBHOOK_SECRET; },
  get appUrl() { return getEnv().NEXT_PUBLIC_APP_URL; },
};
