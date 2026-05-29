import { config } from "./config";
import type { PersistedPost, XMedia } from "./types";

const TELEGRAM_TIMEOUT_MS = 30_000;
const TELEGRAM_TARGET_PREFIX = "telegram:";
const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramMessage = {
  message_id: number;
};

function trimForTelegram(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

async function postTelegram<T>(method: string, body: unknown): Promise<T> {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to publish Telegram targets");
  }

  const response = await fetch(`${config.telegram.baseUrl}/bot${config.telegram.botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS)
  });

  const rawBody = await response.text();
  let payload: TelegramResponse<T>;

  try {
    payload = JSON.parse(rawBody) as TelegramResponse<T>;
  } catch {
    payload = {
      ok: false,
      description: rawBody
    };
  }

  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(`Telegram ${response.status}: ${payload.description ?? "request failed"}`);
  }

  return payload.result;
}

export function buildTelegramTargetId(chatId: string): string {
  return `${TELEGRAM_TARGET_PREFIX}${chatId}`;
}

export function isTelegramTargetId(targetId: string): boolean {
  return targetId.startsWith(TELEGRAM_TARGET_PREFIX);
}

export function parseTelegramTargetId(targetId: string): string {
  if (!isTelegramTargetId(targetId)) {
    throw new Error(`Invalid Telegram target id: ${targetId}`);
  }

  return targetId.slice(TELEGRAM_TARGET_PREFIX.length);
}

export function resolveConfiguredTelegramTargetIds(): string[] {
  return Array.from(new Set(config.telegram.chatIds.map(buildTelegramTargetId)));
}

export async function sendTelegramText(chatId: string, text: string): Promise<number> {
  const message = await postTelegram<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text: trimForTelegram(text, MAX_TEXT_LENGTH),
    disable_web_page_preview: false
  });

  return message.message_id;
}

export async function sendTelegramPhoto(chatId: string, photoUrl: string, caption?: string): Promise<number> {
  const message = await postTelegram<TelegramMessage>("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption ? trimForTelegram(caption, MAX_CAPTION_LENGTH) : undefined
  });

  return message.message_id;
}

export async function sendTelegramPost(
  chatId: string,
  message: string,
  mediaItems: XMedia[],
  _post: PersistedPost
): Promise<void> {
  if (!config.telegram.sendMedia || mediaItems.length === 0) {
    await sendTelegramText(chatId, message);
    return;
  }

  let sentAnyPhoto = false;

  for (let index = 0; index < mediaItems.length; index++) {
    const media = mediaItems[index];
    const photoUrl = media.url ?? media.previewImageUrl;

    if (!photoUrl) {
      continue;
    }

    await sendTelegramPhoto(chatId, photoUrl, index === 0 ? message : undefined);
    sentAnyPhoto = true;
  }

  if (!sentAnyPhoto) {
    await sendTelegramText(chatId, message);
  }
}
