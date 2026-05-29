import { config } from "./config";
import { logger } from "./logger";
import { dispatchPublish } from "./publish-dispatcher";
import {
  ensureDelivery,
  getActiveSources,
  insertPost,
  listRetryableDeliveries,
  markSourceChecked,
  syncEnvSources,
  updateSourceIdentity
} from "./repositories";
import { resolveConfiguredTargetIds } from "./waha-client";
import { fetchSourcePosts, resolveUser } from "./x-client";
import { acquireSchedulerLock } from "./scheduler-lock";
import { resolveConfiguredTelegramTargetIds } from "./telegram-client";

async function refreshLockOrThrow(refresh: () => Promise<boolean>): Promise<void> {
  const refreshed = await refresh();

  if (!refreshed) {
    throw new Error("Scheduler lock was lost while processing");
  }
}

async function processSource(source: Awaited<ReturnType<typeof getActiveSources>>[number]): Promise<void> {
  const resolved = source.userId ? { id: source.userId, username: source.username } : await resolveUser(source.username);

  if (!source.userId && "persistentId" in resolved && resolved.persistentId) {
    await updateSourceIdentity(source.id, resolved.id);
  }

  const posts = await fetchSourcePosts({ ...source, userId: resolved.id });
  const sorted = posts.slice().sort((left, right) => Number(left.id) - Number(right.id));

  if (!source.lastSeenPostId && config.x.bootstrapMode === "latest") {
    const latest = sorted.at(-1)?.id ?? null;
    await markSourceChecked(source.id, latest);
    logger.info({ username: source.username, latest }, "Bootstrapped source without publishing history");
    return;
  }

  let latestSeen = source.lastSeenPostId;

  for (const post of sorted) {
    const persisted = await insertPost(source, post);
    latestSeen = post.id;

    if (!persisted) {
      continue;
    }

    const targetIds = [
      ...(await resolveConfiguredTargetIds()),
      ...resolveConfiguredTelegramTargetIds()
    ];

    if (targetIds.length === 0) {
      logger.warn(
        { postId: persisted.id, username: source.username },
        "Publish target list is empty, skipping publish enqueue"
      );
      continue;
    }

    for (const targetId of targetIds) {
      await ensureDelivery(persisted.id, targetId);
      await dispatchPublish({ postId: persisted.id, waChannelId: targetId });
    }
  }

  await markSourceChecked(source.id, latestSeen);
}

export async function runSchedulerOnce(): Promise<void> {
  const lock = await acquireSchedulerLock();

  if (!lock) {
    logger.debug("Scheduler lock already held");
    return;
  }

  try {
    await syncEnvSources();
    const sources = await getActiveSources();

    for (const source of sources) {
      await refreshLockOrThrow(lock.refresh);
      await processSource(source);
    }

    // Auto-retry failed deliveries
    try {
      await refreshLockOrThrow(lock.refresh);
      const failed = await listRetryableDeliveries(["failed"]);

      if (failed.length > 0) {
        logger.info({ count: failed.length }, "Auto-retrying failed deliveries");

        for (const delivery of failed) {
          await dispatchPublish({ postId: delivery.postId, waChannelId: delivery.waChannelId });
        }
      }
    } catch (retryError) {
      logger.error(
        { error: retryError instanceof Error ? retryError.message : String(retryError) },
        "Auto-retry of failed deliveries encountered an error"
      );
    }
  } finally {
    await lock.release();
  }
}

export async function startScheduler(): Promise<() => void> {
  try {
    await runSchedulerOnce();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Initial scheduler poll failed"
    );
  }

  const timer = setInterval(() => {
    runSchedulerOnce().catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Scheduler tick failed");
    });
  }, config.x.fetchIntervalMs);

  logger.info({ intervalMs: config.x.fetchIntervalMs }, "Scheduler started");

  return () => clearInterval(timer);
}
