import { config } from "./config";
import { buildMessage } from "./formatter";
import { logger } from "./logger";
import {
  ensureDelivery,
  getDelivery,
  getPost,
  markDeliveryAttempt,
  markDeliveryFailed,
  markDeliverySent
} from "./repositories";
import { isTelegramTargetId, parseTelegramTargetId, sendTelegramPost } from "./telegram-client";
import type { PersistedPost, PublishJobData, XMedia } from "./types";
import { resolveConfiguredForwardTargetIds, sendImage, sendText } from "./waha-client";

const INTER_MEDIA_DELAY_MS = 1500;
const INTER_TARGET_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveMediaItems(post: PersistedPost): XMedia[] {
  if (post.mediaAll.length > 0) {
    return post.mediaAll.filter((media) => media.type === "photo" && (media.url || media.previewImageUrl));
  }

  if (post.mediaType === "photo" && post.mediaUrl) {
    return [{ type: "photo", url: post.mediaUrl, previewImageUrl: post.mediaUrl }];
  }

  return [];
}

async function sendToTarget(
  chatId: string,
  message: string,
  mediaItems: XMedia[],
  post: PersistedPost
): Promise<void> {
  if (mediaItems.length === 0) {
    await sendText(chatId, message);
    return;
  }

  for (let index = 0; index < mediaItems.length; index++) {
    const media = mediaItems[index];
    const imageUrl = media.url ?? media.previewImageUrl ?? "";

    await sendImage(chatId, imageUrl, message);

    logger.info(
      { postId: post.id, chatId, mediaIndex: index + 1, totalMedia: mediaItems.length },
      "Sent media item"
    );

    if (index < mediaItems.length - 1) {
      await delay(INTER_MEDIA_DELAY_MS);
    }
  }
}

async function sendForwardTargets(
  sourceTargetId: string,
  message: string,
  mediaItems: XMedia[],
  post: PersistedPost
): Promise<void> {
  if (!sourceTargetId.endsWith("@g.us") || config.waha.forwardTargetRefs.length === 0) {
    return;
  }

  const forwardTargetIds = await resolveConfiguredForwardTargetIds();

  for (const forwardTargetId of forwardTargetIds) {
    if (forwardTargetId === sourceTargetId) {
      continue;
    }

    await ensureDelivery(post.id, forwardTargetId);
    const forwardDelivery = await getDelivery(post.id, forwardTargetId);

    if (forwardDelivery?.status === "sent") {
      continue;
    }

    await delay(INTER_TARGET_DELAY_MS);
    await markDeliveryAttempt(post.id, forwardTargetId);

    try {
      await sendToTarget(forwardTargetId, message, mediaItems, post);
      await markDeliverySent(post.id, forwardTargetId);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await markDeliveryFailed(post.id, forwardTargetId, errMsg);
      logger.warn(
        {
          postId: post.id,
          fromTargetId: sourceTargetId,
          forwardTargetId,
          error: errMsg
        },
        "Failed to send to forward target"
      );
    }
  }
}

export async function publishJob(data: PublishJobData): Promise<void> {
  const delivery = await getDelivery(data.postId, data.waChannelId);

  if (delivery?.status === "sent") {
    logger.info({ postId: data.postId, channelId: data.waChannelId }, "Skipping already delivered post");
    return;
  }

  const post = await getPost(data.postId);

  if (!post) {
    throw new Error(`Post ${data.postId} not found`);
  }

  const message = buildMessage(post);
  const mediaItems = resolveMediaItems(post);

  await markDeliveryAttempt(post.id, data.waChannelId);

  try {
    if (isTelegramTargetId(data.waChannelId)) {
      await sendTelegramPost(parseTelegramTargetId(data.waChannelId), message, mediaItems, post);
      await markDeliverySent(post.id, data.waChannelId);
      logger.info({ postId: post.id, xPostId: post.xPostId }, "Published post to Telegram");
      return;
    }

    await sendToTarget(data.waChannelId, message, mediaItems, post);
    await markDeliverySent(post.id, data.waChannelId);
    await sendForwardTargets(data.waChannelId, message, mediaItems, post);

    logger.info(
      { postId: post.id, xPostId: post.xPostId, mediaCount: mediaItems.length },
      "Published post to WAHA"
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await markDeliveryFailed(post.id, data.waChannelId, errMsg);
    logger.error({ postId: post.id, error: errMsg }, "Failed to publish post");
    throw error;
  }
}
