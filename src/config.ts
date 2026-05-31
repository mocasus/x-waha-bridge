import dotenv from "dotenv";
import { z } from "zod";
import type { AppRole } from "./types";

if (!process.env.VERCEL) {
  dotenv.config();
}

const TRUTHY = new Set(["true", "1", "yes", "y", "on"]);
const FALSY = new Set(["false", "0", "no", "n", "off", ""]);

/**
 * Parse a boolean environment variable safely.
 *
 * `z.coerce.boolean()` performs `Boolean(value)`, so any non-empty string
 * (including the literal "false") becomes `true`. This helper reads the value
 * explicitly so that "false"/"0"/"no" resolve to `false` as expected.
 */
function envBoolean(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      if (typeof value === "boolean") {
        return value;
      }

      const normalized = value.trim().toLowerCase();

      if (TRUTHY.has(normalized)) {
        return true;
      }

      if (FALSY.has(normalized)) {
        return false;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected a boolean-like value (true/false), received "${value}"`
      });

      return z.NEVER;
    });
}

const schema = z.object({
  APP_ROLE: z.enum(["all", "api", "scheduler", "worker"]).default("all"),
  APP_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  APP_ADMIN_TOKEN: z.string().optional().default(""),
  APP_ADMIN_USERNAME: z.string().optional().default(""),
  APP_ADMIN_PASSWORD: z.string().optional().default(""),
  APP_LOGIN_ENABLED: envBoolean(false),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  X_PROVIDER: z.enum(["auto", "official", "nitter"]).default("auto"),
  X_API_BASE_URL: z.string().url().default("https://api.x.com/2"),
  X_BEARER_TOKEN: z.string().optional().default(""),
  X_NITTER_BASE_URL: z.string().url().default("https://nitter.net"),
  X_SOURCE_USERNAMES: z.string().default(""),
  X_FETCH_INTERVAL_MS: z.coerce.number().int().positive().default(90000),
  X_FETCH_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  X_BOOTSTRAP_MODE: z.enum(["latest", "backfill"]).default("latest"),
  X_SCHEDULER_LOCK_MS: z.coerce.number().int().positive().default(180000),
  WAHA_BASE_URL: z.string().url(),
  WAHA_API_KEY: z.string().optional().default(""),
  WAHA_SESSION_NAME: z.string().min(1).default("default"),
  WAHA_TARGETS: z.string().default(""),
  WAHA_FORWARD_TARGETS: z.string().default(""),
  WAHA_CHANNEL_ID: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_IDS: z.string().default(""),
  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),
  TELEGRAM_SEND_MEDIA: envBoolean(true),
  MESSAGE_HEADER: z.string().default("[X Mirror]"),
  MESSAGE_FOOTER: z.string().default(""),
  SEND_MEDIA: envBoolean(true),
  PUBLISH_CONCURRENCY: z.coerce.number().int().positive().default(1),
  PUBLISH_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PUBLISH_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
  PUBLISH_INLINE: envBoolean(false),
  CRON_SECRET: z.string().optional().default("")
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

const env = parsed.data;

const wahaTargetRefs = (env.WAHA_TARGETS || env.WAHA_CHANNEL_ID)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const wahaForwardTargetRefs = env.WAHA_FORWARD_TARGETS
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const telegramChatIds = env.TELEGRAM_CHAT_IDS
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  role: env.APP_ROLE as AppRole,
  port: env.APP_PORT ?? env.PORT ?? 8080,
  admin: {
    token: env.APP_ADMIN_TOKEN.trim(),
    username: env.APP_ADMIN_USERNAME.trim(),
    password: env.APP_ADMIN_PASSWORD,
    loginEnabled: env.APP_LOGIN_ENABLED
  },
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  x: {
    provider: env.X_PROVIDER,
    baseUrl: env.X_API_BASE_URL.replace(/\/$/, ""),
    bearerToken: env.X_BEARER_TOKEN.trim(),
    nitterBaseUrl: env.X_NITTER_BASE_URL.replace(/\/$/, ""),
    sourceUsernames: env.X_SOURCE_USERNAMES.split(",").map((value) => value.trim()).filter(Boolean),
    fetchIntervalMs: env.X_FETCH_INTERVAL_MS,
    fetchBatchSize: env.X_FETCH_BATCH_SIZE,
    bootstrapMode: env.X_BOOTSTRAP_MODE,
    schedulerLockMs: env.X_SCHEDULER_LOCK_MS
  },
  waha: {
    baseUrl: env.WAHA_BASE_URL.replace(/\/$/, ""),
    apiKey: env.WAHA_API_KEY,
    sessionName: env.WAHA_SESSION_NAME,
    targetRefs: wahaTargetRefs,
    forwardTargetRefs: wahaForwardTargetRefs,
    channelId: env.WAHA_CHANNEL_ID
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN.trim(),
    chatIds: telegramChatIds,
    baseUrl: env.TELEGRAM_API_BASE_URL.replace(/\/$/, ""),
    sendMedia: env.TELEGRAM_SEND_MEDIA
  },
  message: {
    header: env.MESSAGE_HEADER.trim(),
    footer: env.MESSAGE_FOOTER.trim(),
    sendMedia: env.SEND_MEDIA
  },
  publish: {
    concurrency: env.PUBLISH_CONCURRENCY,
    attempts: env.PUBLISH_ATTEMPTS,
    backoffMs: env.PUBLISH_BACKOFF_MS,
    inline: env.PUBLISH_INLINE
  },
  cronSecret: env.CRON_SECRET.trim()
};
