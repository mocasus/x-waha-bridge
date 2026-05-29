import type { QueryResultRow } from "pg";
import { config } from "./config";
import { pool } from "./db";
import type { DeliveryStatus, PersistedPost, SourceRecord, XMedia, XPost } from "./types";

function mapSource(row: QueryResultRow): SourceRecord {
  return {
    id: row.id,
    username: row.username,
    userId: row.user_id,
    active: row.active,
    includeReplies: row.include_replies,
    includeReposts: row.include_reposts,
    includeQuotes: row.include_quotes,
    lastSeenPostId: row.last_seen_post_id,
    lastCheckedAt: row.last_checked_at
  };
}

function mapPost(row: QueryResultRow): PersistedPost {
  let mediaAll: XMedia[] = [];

  try {
    const raw = row.media_all;

    if (Array.isArray(raw) && raw.length > 0) {
      mediaAll = raw as XMedia[];
    }
  } catch {
    // ignore parse errors, fall back to empty
  }

  // Backwards compat: if media_all is empty but legacy columns exist, reconstruct
  if (mediaAll.length === 0 && row.media_url) {
    mediaAll = [
      {
        type: (row.media_type as XMedia["type"]) ?? "photo",
        url: row.media_url,
        previewImageUrl: row.media_url
      }
    ];
  }

  return {
    id: Number(row.id),
    xPostId: row.x_post_id,
    username: row.username,
    text: row.text,
    postUrl: row.post_url,
    postedAt: row.posted_at,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    mediaAll,
    raw: row.raw
  };
}

function cleanPreviewText(text: string): string {
  return text.replace(/^RT by @[^:]+:\s*/i, "").trim();
}

export async function syncEnvSources(): Promise<void> {
  for (const username of config.x.sourceUsernames) {
    await upsertSource({ username });
  }
}

export async function listSources(): Promise<SourceRecord[]> {
  const result = await pool.query(`SELECT * FROM sources ORDER BY username ASC`);
  return result.rows.map(mapSource);
}

export async function getActiveSources(): Promise<SourceRecord[]> {
  const result = await pool.query(`SELECT * FROM sources WHERE active = TRUE ORDER BY username ASC`);
  return result.rows.map(mapSource);
}

export async function upsertSource(input: {
  username: string;
  includeReplies?: boolean;
  includeReposts?: boolean;
  includeQuotes?: boolean;
}): Promise<SourceRecord> {
  const result = await pool.query(
    `
      INSERT INTO sources (username, include_replies, include_reposts, include_quotes)
      VALUES ($1, COALESCE($2, FALSE), COALESCE($3, FALSE), COALESCE($4, TRUE))
      ON CONFLICT (username)
      DO UPDATE SET
        include_replies = CASE WHEN $2 IS NULL THEN sources.include_replies ELSE EXCLUDED.include_replies END,
        include_reposts = CASE WHEN $3 IS NULL THEN sources.include_reposts ELSE EXCLUDED.include_reposts END,
        include_quotes = CASE WHEN $4 IS NULL THEN sources.include_quotes ELSE EXCLUDED.include_quotes END,
        updated_at = NOW()
      RETURNING *
    `,
    [
      input.username.toLowerCase(),
      input.includeReplies,
      input.includeReposts,
      input.includeQuotes
    ]
  );

  return mapSource(result.rows[0]);
}

export async function updateSourceIdentity(sourceId: number, userId: string): Promise<void> {
  await pool.query(`UPDATE sources SET user_id = $2, updated_at = NOW() WHERE id = $1`, [sourceId, userId]);
}

export async function updateSource(
  id: number,
  patch: {
    active?: boolean;
    includeReplies?: boolean;
    includeReposts?: boolean;
    includeQuotes?: boolean;
  }
): Promise<SourceRecord | null> {
  const result = await pool.query(
    `
      UPDATE sources
      SET
        active = COALESCE($2, active),
        include_replies = COALESCE($3, include_replies),
        include_reposts = COALESCE($4, include_reposts),
        include_quotes = COALESCE($5, include_quotes),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, patch.active, patch.includeReplies, patch.includeReposts, patch.includeQuotes]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapSource(result.rows[0]);
}

export async function softDeleteSource(id: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sources SET active = FALSE, updated_at = NOW() WHERE id = $1`,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getSourceById(id: number): Promise<SourceRecord | null> {
  const result = await pool.query(`SELECT * FROM sources WHERE id = $1`, [id]);

  if (result.rowCount === 0) {
    return null;
  }

  return mapSource(result.rows[0]);
}

export async function markSourceChecked(sourceId: number, lastSeenPostId: string | null): Promise<void> {
  await pool.query(
    `
      UPDATE sources
      SET
        last_seen_post_id = COALESCE($2, last_seen_post_id),
        last_checked_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [sourceId, lastSeenPostId]
  );
}

export async function insertPost(source: SourceRecord, post: XPost): Promise<PersistedPost | null> {
  const primaryMedia = post.media[0];
  const result = await pool.query(
    `
      INSERT INTO posts (
        source_id,
        x_post_id,
        x_user_id,
        username,
        text,
        post_url,
        posted_at,
        has_media,
        media_type,
        media_url,
        media_all,
        raw
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
      ON CONFLICT (x_post_id) DO NOTHING
      RETURNING *
    `,
    [
      source.id,
      post.id,
      post.authorId,
      post.username,
      post.text,
      post.url,
      new Date(post.createdAt),
      post.media.length > 0,
      primaryMedia?.type ?? null,
      primaryMedia?.url ?? primaryMedia?.previewImageUrl ?? null,
      JSON.stringify(post.media),
      JSON.stringify(post.raw)
    ]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapPost(result.rows[0]);
}

export async function ensureDelivery(postId: number, waChannelId: string): Promise<void> {
  await pool.query(
    `
      INSERT INTO deliveries (post_id, wa_channel_id)
      VALUES ($1, $2)
      ON CONFLICT (post_id, wa_channel_id) DO NOTHING
    `,
    [postId, waChannelId]
  );
}

export async function getPost(postId: number): Promise<PersistedPost | null> {
  const result = await pool.query(`SELECT * FROM posts WHERE id = $1`, [postId]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapPost(result.rows[0]);
}

export async function getDelivery(postId: number, waChannelId: string): Promise<{
  status: DeliveryStatus;
  attempts: number;
} | null> {
  const result = await pool.query(
    `SELECT status, attempts FROM deliveries WHERE post_id = $1 AND wa_channel_id = $2`,
    [postId, waChannelId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0] as { status: DeliveryStatus; attempts: number };
}

export async function markDeliveryAttempt(postId: number, waChannelId: string): Promise<void> {
  await pool.query(
    `
      UPDATE deliveries
      SET attempts = attempts + 1, updated_at = NOW()
      WHERE post_id = $1 AND wa_channel_id = $2
    `,
    [postId, waChannelId]
  );
}

export async function markDeliverySent(postId: number, waChannelId: string): Promise<void> {
  await pool.query(
    `
      UPDATE deliveries
      SET status = 'sent', delivered_at = NOW(), last_error = NULL, updated_at = NOW()
      WHERE post_id = $1 AND wa_channel_id = $2
    `,
    [postId, waChannelId]
  );
}

export async function markDeliveryFailed(postId: number, waChannelId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `
      UPDATE deliveries
      SET status = 'failed', last_error = LEFT($3, 2000), updated_at = NOW()
      WHERE post_id = $1 AND wa_channel_id = $2
    `,
    [postId, waChannelId, errorMessage]
  );
}

export async function listDeliveries(limit: number, offset = 0): Promise<QueryResultRow[]> {
  const result = await pool.query(
    `
      SELECT
        deliveries.id,
        deliveries.status,
        deliveries.attempts,
        deliveries.last_error,
        deliveries.delivered_at,
        deliveries.created_at,
        deliveries.updated_at,
        deliveries.wa_channel_id,
        posts.x_post_id,
        posts.username,
        posts.post_url,
        posts.text
      FROM deliveries
      INNER JOIN posts ON posts.id = deliveries.post_id
      ORDER BY deliveries.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );
  return result.rows;
}

export async function countDeliveries(): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::INT AS total FROM deliveries`);
  return Number(result.rows[0].total);
}

export async function listRecentPosts(limit: number, offset = 0): Promise<QueryResultRow[]> {
  const result = await pool.query(
    `
      SELECT
        posts.id,
        posts.x_post_id,
        posts.username,
        posts.text,
        posts.post_url,
        posts.posted_at,
        posts.media_type,
        posts.media_url,
        posts.media_all,
        sources.active AS source_active
      FROM posts
      INNER JOIN sources ON sources.id = posts.source_id
      ORDER BY posts.posted_at DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );
  return result.rows.map((row) => ({
    ...row,
    text: cleanPreviewText(String(row.text ?? "")),
    mediaCount: Array.isArray(row.media_all) ? row.media_all.length : 0
  }));
}

export async function countPosts(): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::INT AS total FROM posts`);
  return Number(result.rows[0].total);
}

export async function listRetryableDeliveries(statuses: DeliveryStatus[]): Promise<Array<{ postId: number; waChannelId: string }>> {
  if (statuses.length === 0) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT post_id, wa_channel_id
      FROM deliveries
      WHERE status = ANY($1::text[])
      ORDER BY created_at ASC
    `,
    [statuses]
  );

  return result.rows.map((row) => ({
    postId: Number(row.post_id),
    waChannelId: row.wa_channel_id as string
  }));
}

export async function getHealthCounts(): Promise<{ sources: number; pendingDeliveries: number }> {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::INT FROM sources WHERE active = TRUE) AS sources,
      (SELECT COUNT(*)::INT FROM deliveries WHERE status = 'pending') AS pending_deliveries
  `);

  return {
    sources: result.rows[0].sources,
    pendingDeliveries: result.rows[0].pending_deliveries
  };
}

export async function getDeliveryStats(): Promise<{ sent: number; pending: number; failed: number; total: number }> {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0)::INT AS sent,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::INT AS pending,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0)::INT AS failed,
      COUNT(*)::INT AS total
    FROM deliveries
  `);

  return {
    sent: result.rows[0].sent,
    pending: result.rows[0].pending,
    failed: result.rows[0].failed,
    total: result.rows[0].total
  };
}
