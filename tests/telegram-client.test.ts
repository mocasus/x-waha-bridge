import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import {
  buildTelegramTargetId,
  resolveConfiguredTelegramTargetIds,
  sendTelegramText
} from "../src/telegram-client";

describe("telegram-client", () => {
  beforeEach(() => {
    config.telegram.botToken = "123:token";
    config.telegram.chatIds = [];
    config.telegram.baseUrl = "https://api.telegram.org";
    vi.restoreAllMocks();
  });

  it("builds stable delivery target ids", () => {
    expect(buildTelegramTargetId("@channel")).toBe("telegram:@channel");
  });

  it("resolves configured targets and deduplicates them", () => {
    config.telegram.chatIds = ["@channel", "@channel", "-100123"];

    expect(resolveConfiguredTelegramTargetIds()).toEqual(["telegram:@channel", "telegram:-100123"]);
  });

  it("sends text through Telegram Bot API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, result: { message_id: 42 } })
    } as Response);

    await expect(sendTelegramText("@channel", "hello")).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123:token/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "@channel",
          text: "hello",
          disable_web_page_preview: false
        })
      })
    );
  });
});
