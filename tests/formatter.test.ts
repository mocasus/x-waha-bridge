import { describe, expect, it } from "vitest";
import { buildMessage } from "../src/formatter";
import type { PersistedPost } from "../src/types";

function makePost(text: string): PersistedPost {
  return {
    id: 1,
    xPostId: "123",
    username: "tester",
    text,
    postUrl: "https://x.com/tester/status/123",
    postedAt: new Date("2026-01-01T00:00:00.000Z"),
    mediaType: null,
    mediaUrl: null,
    mediaAll: [],
    raw: {}
  };
}

describe("buildMessage", () => {
  it("trims leading and trailing whitespace", () => {
    expect(buildMessage(makePost("  hello world  \n"))).toBe("hello world");
  });

  it("keeps internal line breaks", () => {
    const text = "line 1\nline 2";
    expect(buildMessage(makePost(text))).toBe(text);
  });
});
