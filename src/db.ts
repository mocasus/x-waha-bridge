import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool({
  connectionString: config.databaseUrl
});

export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [90210]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sources (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        user_id TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        include_replies BOOLEAN NOT NULL DEFAULT FALSE,
        include_reposts BOOLEAN NOT NULL DEFAULT FALSE,
        include_quotes BOOLEAN NOT NULL DEFAULT TRUE,
        last_seen_post_id TEXT,
        last_checked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id BIGSERIAL PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        x_post_id TEXT NOT NULL UNIQUE,
        x_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        post_url TEXT NOT NULL,
        posted_at TIMESTAMPTZ NOT NULL,
        has_media BOOLEAN NOT NULL DEFAULT FALSE,
        media_type TEXT,
        media_url TEXT,
        media_all JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Add media_all column for existing deployments
    await client.query(`
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_all JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id BIGSERIAL PRIMARY KEY,
        post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        wa_channel_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (post_id, wa_channel_id)
      )
    `);

    // Indexes to keep dashboard/queries fast as the tables grow.
    await client.query("CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts (posted_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_posts_source_id ON posts (source_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries (status)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_deliveries_post_id ON deliveries (post_id)");

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
