import { config } from "./config";
import { logger } from "./logger";
import { publishJob } from "./publisher";
import { buildPublishJobId, publishQueue } from "./queue";
import type { PublishJobData } from "./types";

export async function dispatchPublish(data: PublishJobData): Promise<void> {
  if (config.publish.inline) {
    await publishJob(data);
    return;
  }

  await publishQueue.add("publish-post", data, {
    jobId: buildPublishJobId(data.postId, data.waChannelId)
  });
}

export function logPublishMode(): void {
  logger.info({ inline: config.publish.inline }, "Publish mode configured");
}
