import { config } from "./config";
import { closeDatabase, ensureSchema } from "./db";
import { startHttpServer } from "./http";
import { logger } from "./logger";
import { logPublishMode } from "./publish-dispatcher";
import { publishJob } from "./publisher";
import { closeRedis, createPublishWorker } from "./queue";
import { syncEnvSources } from "./repositories";
import { startScheduler } from "./scheduler";

export async function bootstrap(): Promise<void> {
  await ensureSchema();
  await syncEnvSources();
  logPublishMode();

  const cleanupTasks: Array<() => Promise<void> | void> = [];
  let worker: ReturnType<typeof createPublishWorker> | undefined;

  if (config.role === "all" || config.role === "api") {
    cleanupTasks.push(await startHttpServer());
  }

  if (config.role === "all" || config.role === "scheduler") {
    const stopScheduler = await startScheduler();
    cleanupTasks.push(async () => stopScheduler());
  }

  if ((config.role === "all" || config.role === "worker") && !config.publish.inline) {
    worker = createPublishWorker(publishJob);
    cleanupTasks.push(async () => {
      if (worker) {
        await worker.close();
      }
    });
    logger.info({ concurrency: config.publish.concurrency }, "Publish worker started");
  }

  if ((config.role === "all" || config.role === "worker") && config.publish.inline) {
    logger.info("Inline publish mode active, BullMQ worker is disabled");
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    for (const task of cleanupTasks.reverse()) {
      await task();
    }
    await closeRedis();
    await closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Shutdown failed");
      process.exit(1);
    });
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Shutdown failed");
      process.exit(1);
    });
  });
}
