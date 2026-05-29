import http from "node:http";
import https from "node:https";
import { config } from "./config";
import { logger } from "./logger";
import type { SourceRecord, XMedia, XPost } from "./types";

const X_API_TIMEOUT_MS = 30_000;
const NITTER_TIMEOUT_MS = 20_000;

type XUserLookupResponse = {
  data: {
    id: string;
    username: string;
  };
};

type XTimelineResponse = {
  data?: Array<{
    id: string;
    author_id: string;
    created_at: string;
    text: string;
    attachments?: { media_keys?: string[] };
    referenced_tweets?: Array<{ type: string; id: string }>;
  }>;
  includes?: {
    media?: Array<{
      media_key: string;
      type: string;
      url?: string;
      preview_image_url?: string;
    }>;
  };
};

type ResolvedUser = {
  id: string;
  username: string;
  persistentId: boolean;
};

type NitterItem = {
  title: string;
  description: string;
  pubDate: string;
  guid: string;
  link: string;
  creator: string;
};

let officialDisabled = false;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}

function stripHtml(value: string): string {
  return normalizeWhitespace(
    decodeHtml(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${escapeRegExp(tag)}(?:\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`, "i"));
  return match ? decodeHtml(match[1]).trim() : "";
}

function isOfficialMode(): boolean {
  return config.x.provider === "official";
}

function canUseOfficial(): boolean {
  if (config.x.provider === "nitter") {
    return false;
  }

  if (!config.x.bearerToken) {
    return false;
  }

  return !officialDisabled;
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /X API (401|403):/.test(message);
}

function disableOfficial(reason: string): void {
  if (officialDisabled) {
    return;
  }

  officialDisabled = true;
  logger.warn({ reason }, "Official X API disabled, falling back to Nitter RSS");
}

async function requestOfficial<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = new URL(`${config.x.baseUrl}${path}`);

  if (params) {
    url.search = params.toString();
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.x.bearerToken}`
    },
    signal: AbortSignal.timeout(X_API_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}

async function resolveUserOfficial(username: string): Promise<ResolvedUser> {
  const result = await requestOfficial<XUserLookupResponse>(`/users/by/username/${encodeURIComponent(username)}`);
  return { id: result.data.id, username: result.data.username, persistentId: true };
}

async function fetchSourcePostsOfficial(source: SourceRecord): Promise<XPost[]> {
  if (!source.userId) {
    throw new Error(`Source ${source.username} is missing userId`);
  }

  const params = new URLSearchParams({
    max_results: String(config.x.fetchBatchSize),
    "tweet.fields": "created_at,author_id,attachments,referenced_tweets",
    expansions: "attachments.media_keys",
    "media.fields": "type,url,preview_image_url"
  });

  const excludes: string[] = [];

  if (!source.includeReplies) {
    excludes.push("replies");
  }

  if (!source.includeReposts) {
    excludes.push("retweets");
  }

  if (excludes.length > 0) {
    params.set("exclude", excludes.join(","));
  }

  if (source.lastSeenPostId) {
    params.set("since_id", source.lastSeenPostId);
  }

  const result = await requestOfficial<XTimelineResponse>(`/users/${source.userId}/tweets`, params);
  const mediaMap = new Map<string, XMedia>();

  for (const media of result.includes?.media ?? []) {
    mediaMap.set(media.media_key, {
      type: media.type === "photo" || media.type === "video" || media.type === "animated_gif" ? media.type : "unknown",
      url: media.url ?? null,
      previewImageUrl: media.preview_image_url ?? null
    });
  }

  const posts = (result.data ?? []).map<XPost>((item) => {
    const media = (item.attachments?.media_keys ?? []).map((key) => mediaMap.get(key)).filter(Boolean) as XMedia[];
    const isQuote = Boolean(item.referenced_tweets?.some((reference) => reference.type === "quoted"));

    return {
      id: item.id,
      authorId: item.author_id,
      username: source.username,
      text: item.text,
      createdAt: item.created_at,
      url: `https://x.com/${source.username}/status/${item.id}`,
      media,
      isQuote,
      raw: item
    };
  });

  return posts.filter((post) => source.includeQuotes || !post.isQuote);
}

async function requestNitterFeed(username: string): Promise<string> {
  const url = `${config.x.nitterBaseUrl}/${encodeURIComponent(username)}/rss`;

  return await new Promise<string>((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;

    const request = client.get(
      parsedUrl,
      {
        headers: {
          Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
        },
        timeout: NITTER_TIMEOUT_MS
      },
      (response) => {
        const chunks: string[] = [];

        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = chunks.join("");

          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Nitter RSS ${response.statusCode}: ${body}`));
            return;
          }

          resolve(body);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Nitter RSS request timed out after ${NITTER_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);
  });
}

function parseNitterFeed(xml: string): NitterItem[] {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);

  return blocks.map((block) => ({
    title: extractTag(block, "title"),
    description: extractTag(block, "description"),
    pubDate: extractTag(block, "pubDate"),
    guid: extractTag(block, "guid"),
    link: extractTag(block, "link"),
    creator: extractTag(block, "dc:creator")
  }));
}

function extractStatusId(item: NitterItem): string {
  const guid = item.guid.trim();

  if (/^\d+$/.test(guid)) {
    return guid;
  }

  const linkMatch = item.link.match(/\/status\/(\d+)/);
  if (linkMatch) {
    return linkMatch[1];
  }

  throw new Error(`Unable to extract status id from Nitter item: ${item.link}`);
}

function extractMedia(description: string): XMedia[] {
  const matches = [...description.matchAll(/<img[^>]+src="([^"]+)"/gi)];

  return matches.map<XMedia>((match) => {
    const rawUrl = decodeHtml(match[1]).replace(/^https?:\/\/nitter\.net/i, config.x.nitterBaseUrl);
    const lowerUrl = rawUrl.toLowerCase();
    const type = lowerUrl.includes(".mp4") ? "video" : lowerUrl.includes(".gif") ? "animated_gif" : "photo";

    return {
      type,
      url: rawUrl,
      previewImageUrl: rawUrl
    };
  });
}

function sanitizeNitterTitle(title: string): string {
  return normalizeWhitespace(decodeHtml(title).replace(/^RT by @[^:]+:\s*/i, ""));
}

function extractCaption(description: string, fallbackTitle: string): string {
  const cleanedDescription = description
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<img[^>]*>/gi, "");

  const caption = normalizeWhitespace(stripHtml(cleanedDescription));
  return caption || sanitizeNitterTitle(fallbackTitle);
}

function isRepost(item: NitterItem): boolean {
  return /^RT by @/i.test(item.title);
}

function isReply(item: NitterItem): boolean {
  return /^@/i.test(item.title) || /^R to @/i.test(item.title) || /replying to/i.test(stripHtml(item.description));
}

function isQuote(item: NitterItem): boolean {
  return !isRepost(item) && /<blockquote>/i.test(item.description);
}

function buildPostUrl(item: NitterItem, fallbackUsername: string, statusId: string): string {
  const linkMatch = item.link.match(/https?:\/\/[^/]+\/([^/]+)\/status\/(\d+)/i);

  if (linkMatch) {
    return `https://x.com/${linkMatch[1]}/status/${linkMatch[2]}`;
  }

  return `https://x.com/${fallbackUsername}/status/${statusId}`;
}

async function fetchSourcePostsNitter(source: SourceRecord): Promise<XPost[]> {
  const xml = await requestNitterFeed(source.username);
  const items = parseNitterFeed(xml);

  const posts = items.map<XPost>((item) => {
    const statusId = extractStatusId(item);
    const creator = item.creator.replace(/^@/, "") || source.username;

    return {
      id: statusId,
      authorId: creator,
      username: source.username,
      text: extractCaption(item.description, item.title),
      createdAt: new Date(item.pubDate).toISOString(),
      url: buildPostUrl(item, creator, statusId),
      media: extractMedia(item.description),
      isQuote: isQuote(item),
      raw: item
    };
  });

  return posts.filter((post, index) => {
    const item = items[index];

    if (!source.includeReplies && isReply(item)) {
      return false;
    }

    if (!source.includeReposts && isRepost(item)) {
      return false;
    }

    if (!source.includeQuotes && post.isQuote) {
      return false;
    }

    return true;
  }).slice(0, config.x.fetchBatchSize);
}

export async function resolveUser(username: string): Promise<ResolvedUser> {
  if (canUseOfficial()) {
    try {
      return await resolveUserOfficial(username);
    } catch (error) {
      if (isOfficialMode()) {
        throw error;
      }

      if (isAuthError(error)) {
        disableOfficial(error instanceof Error ? error.message : String(error));
      } else {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Official X user lookup failed, falling back to Nitter RSS");
      }
    }
  }

  return { id: username, username, persistentId: false };
}

export async function fetchSourcePosts(source: SourceRecord): Promise<XPost[]> {
  if (canUseOfficial()) {
    try {
      return await fetchSourcePostsOfficial(source);
    } catch (error) {
      if (isOfficialMode()) {
        throw error;
      }

      if (isAuthError(error)) {
        disableOfficial(error instanceof Error ? error.message : String(error));
      } else {
        logger.warn({ error: error instanceof Error ? error.message : String(error), username: source.username }, "Official X timeline fetch failed, falling back to Nitter RSS");
      }
    }
  }

  return await fetchSourcePostsNitter(source);
}
