import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";

const repositories = vi.hoisted(() => ({
  ensureDelivery: vi.fn(),
  getDelivery: vi.fn(),
  getPost: vi.fn(),
  markDeliveryAttempt: vi.fn(),
  markDeliveryFailed: vi.fn(),
  markDeliverySent: vi.fn()
}));

const wahaClient = vi.hoisted(() => ({
  resolveConfiguredForwardTargetIds: vi.fn(),
  sendImage: vi.fn(),
  sendText: vi.fn()
}));

const telegramClient = vi.hoisted(() => ({
  isTelegramTargetId: vi.fn((targetId: string) => targetId.startsWith("telegram:")),
  parseTelegramTargetId: vi.fn((targetId: string) => targetId.slice("telegram:".length)),
  sendTelegramPost: vi.fn()
}));

vi.mock("../src/repositories", () => repositories);
vi.mock("../src/waha-client", () => wahaClient);
vi.mock("../src/telegram-client", () => telegramClient);
vi.mock("../src/formatter", () => ({
  buildMessage: vi.fn(() => "formatted message")
}));
vi.mock("../src/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

const { publishJob } = await import("../src/publisher");

describe("publishJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.waha.forwardTargetRefs = [];
    repositories.getPost.mockResolvedValue({
      id: 10,
      xPostId: "123",
      username: "tester",
      text: "hello",
      postUrl: "https://x.com/tester/status/123",
      postedAt: new Date("2026-01-01T00:00:00.000Z"),
      mediaType: null,
      mediaUrl: null,
      mediaAll: [],
      raw: {}
    });
  });

  it("skips forward targets that were already delivered", async () => {
    config.waha.forwardTargetRefs = ["forward-target"];
    repositories.getDelivery
      .mockResolvedValueOnce({ status: "pending", attempts: 0 })
      .mockResolvedValueOnce({ status: "sent", attempts: 1 });
    wahaClient.resolveConfiguredForwardTargetIds.mockResolvedValue(["forward-target@g.us"]);
    wahaClient.sendText.mockResolvedValue("message-id");

    await publishJob({ postId: 10, waChannelId: "primary@g.us" });

    expect(wahaClient.sendText).toHaveBeenCalledTimes(1);
    expect(wahaClient.sendText).toHaveBeenCalledWith("primary@g.us", "formatted message");
    expect(repositories.ensureDelivery).toHaveBeenCalledWith(10, "forward-target@g.us");
  });

  it("records forward-target failures without failing the primary delivery", async () => {
    config.waha.forwardTargetRefs = ["forward-target"];
    repositories.getDelivery
      .mockResolvedValueOnce({ status: "pending", attempts: 0 })
      .mockResolvedValueOnce({ status: "pending", attempts: 0 });
    wahaClient.resolveConfiguredForwardTargetIds.mockResolvedValue(["forward-target@g.us"]);
    wahaClient.sendText
      .mockResolvedValueOnce("primary-message")
      .mockRejectedValueOnce(new Error("forward failed"));

    await expect(publishJob({ postId: 10, waChannelId: "primary@g.us" })).resolves.toBeUndefined();

    expect(repositories.markDeliverySent).toHaveBeenCalledWith(10, "primary@g.us");
    expect(repositories.markDeliveryFailed).toHaveBeenCalledWith(10, "forward-target@g.us", "forward failed");
  });

  it("publishes Telegram targets through Telegram client", async () => {
    repositories.getDelivery.mockResolvedValueOnce({ status: "pending", attempts: 0 });
    telegramClient.sendTelegramPost.mockResolvedValue(undefined);

    await publishJob({ postId: 10, waChannelId: "telegram:@my_channel" });

    expect(wahaClient.sendText).not.toHaveBeenCalled();
    expect(telegramClient.sendTelegramPost).toHaveBeenCalledWith(
      "@my_channel",
      "formatted message",
      [],
      expect.objectContaining({ id: 10 })
    );
    expect(repositories.markDeliverySent).toHaveBeenCalledWith(10, "telegram:@my_channel");
  });
});
