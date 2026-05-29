import type { Request } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { isAuthorizedRequest } from "../src/auth";
import { config } from "../src/config";

function makeRequest(headers: Record<string, string> = {}): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as Request;
}

describe("auth", () => {
  beforeEach(() => {
    config.admin.token = "";
    config.admin.username = "";
    config.admin.password = "";
  });

  it("allows requests when admin auth is not configured", () => {
    expect(isAuthorizedRequest(makeRequest())).toBe(true);
  });

  it("accepts bearer token auth", () => {
    config.admin.token = "secret-token";

    expect(isAuthorizedRequest(makeRequest({ authorization: "Bearer secret-token" }))).toBe(true);
    expect(isAuthorizedRequest(makeRequest({ authorization: "Bearer wrong-token" }))).toBe(false);
  });

  it("accepts basic auth credentials", () => {
    config.admin.username = "admin";
    config.admin.password = "s3cret";
    const basic = Buffer.from("admin:s3cret").toString("base64");

    expect(isAuthorizedRequest(makeRequest({ authorization: `Basic ${basic}` }))).toBe(true);
    expect(isAuthorizedRequest(makeRequest())).toBe(false);
  });
});
