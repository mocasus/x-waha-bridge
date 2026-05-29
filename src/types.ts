export type AppRole = "all" | "api" | "scheduler" | "worker";

export type SourceRecord = {
  id: number;
  username: string;
  userId: string | null;
  active: boolean;
  includeReplies: boolean;
  includeReposts: boolean;
  includeQuotes: boolean;
  lastSeenPostId: string | null;
  lastCheckedAt: Date | null;
};

export type XMedia = {
  type: "photo" | "video" | "animated_gif" | "unknown";
  url: string | null;
  previewImageUrl: string | null;
};

export type XPost = {
  id: string;
  authorId: string;
  username: string;
  text: string;
  createdAt: string;
  url: string;
  media: XMedia[];
  isQuote: boolean;
  raw: unknown;
};

export type PersistedPost = {
  id: number;
  xPostId: string;
  username: string;
  text: string;
  postUrl: string;
  postedAt: Date;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaAll: XMedia[];
  raw: unknown;
};

export type PublishJobData = {
  postId: number;
  waChannelId: string;
};

export type DeliveryStatus = "pending" | "sent" | "failed";
