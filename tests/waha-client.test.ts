import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import {
  resolveConfiguredTargetIds,
  sendImage,
  sendText
} from "../src/waha-client";

describe("waha-client", () => {
  beforeEach(() => {
    config.waha.targetRefs = [];
    config.waha.sessionName = "default";
    config.waha.baseUrl = "http://localhost:3000";
    config.waha.apiKey = "";
    vi.restoreAllMocks();
  });

  it("resolves configured targets and deduplicates resolved ids", async () => {
    config.waha.targetRefs = [
      "6281234567890",
      "120363012345678901@g.us",
      "https://whatsapp.com/channel/ABC123",
      "ABC123"
    ];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ id: "999888777@newsletter" })
      } as Response);

    const resolved = await resolveConfiguredTargetIds();

    expect(resolved).toEqual([
      "6281234567890@c.us",
      "120363012345678901@g.us",
      "999888777@newsletter"
    ]);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("sendText returns serialized id from key payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        key: {
          remoteJid: "120363012345678901@g.us",
          fromMe: true,
          id: "ABCD",
          participant: "628111222333@c.us"
        }
      })
    } as Response);

    const messageId = await sendText("120363012345678901@g.us", "hello");

    expect(messageId).toBe("true_120363012345678901@g.us_ABCD_628111222333@c.us");
  });

  it("sendText keeps pre-serialized id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "true_120@g.us_ABCD" })
    } as Response);

    const messageId = await sendText("120@g.us", "hello");

    expect(messageId).toBe("true_120@g.us_ABCD");
  });

  it("sendImage throws WAHA error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error"
    } as Response);

    await expect(sendImage("120@g.us", "https://example.com/image.jpg", "caption")).rejects.toThrow(
      "WAHA 500: internal error"
    );
  });
});
