import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config";
import type { PublishJobData } from "./types";

const redisUrl = new URL(config.redisUrl);

const queueConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace("/", "") || 0) : 0,
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null as null
};

export const JOB_NAME = "publish-post" as const;

export function buildPublishJobId(postId: number, targetId: string): string {
  return `${postId}__${Buffer.from(targetId).toString("base64url")}`;
}

export const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null
});

export const publishQueue = new Queue<PublishJobData, void, typeof JOB_NAME>(JOB_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: config.publish.attempts,
    backoff: {
      type: "exponential",
      delay: config.publish.backoffMs
    },
    removeOnComplete: 200,
    removeOnFail: 200
  }
});

export function createPublishWorker(
  processor: (data: PublishJobData) => Promise<void>
): Worker<PublishJobData, void, typeof JOB_NAME> {
  return new Worker<PublishJobData, void, typeof JOB_NAME>(
    JOB_NAME,
    async (job) => {
      await processor(job.data);
    },
    {
      connection: queueConnection,
      concurrency: config.publish.concurrency
    }
  );
}

export async function closeRedis(): Promise<void> {
  await publishQueue.close();
  await redis.quit();
}
