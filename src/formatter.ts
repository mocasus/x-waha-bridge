import type { PersistedPost } from "./types";

export function buildMessage(post: PersistedPost): string {
  return post.text.trim();
}
