import type { NextFunction, Request, Response } from "express";
import "express-session";
import { config } from "./config";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

function safeEqual(left: string, right: string): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function parseBasicAuth(header: string): { username: string; password: string } | null {
  if (!header.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

export function isAdminAuthConfigured(): boolean {
  return Boolean(config.admin.token || (config.admin.username && config.admin.password));
}

export function isAuthorizedRequest(request: Request): boolean {
  // Check if user has valid session
  if (config.admin.loginEnabled && request.session?.authenticated) {
    return true;
  }

  const authHeader = request.header("authorization") ?? "";
  const tokenCandidate = request.header("x-admin-token")
    ?? (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "");

  if (config.admin.token && tokenCandidate) {
    return safeEqual(tokenCandidate, config.admin.token);
  }

  if (config.admin.username && config.admin.password) {
    const basic = parseBasicAuth(authHeader);

    if (!basic) {
      return false;
    }

    return safeEqual(basic.username, config.admin.username) && safeEqual(basic.password, config.admin.password);
  }

  return !isAdminAuthConfigured();
}

export function requireAdminAccess(request: Request, response: Response, next: NextFunction): void {
  if (isAuthorizedRequest(request)) {
    next();
    return;
  }

  // If login is enabled and session is not authenticated, redirect to login
  if (config.admin.loginEnabled) {
    response.status(401).json({ error: "Unauthorized", redirect: "/login" });
    return;
  }

  response.setHeader("WWW-Authenticate", 'Basic realm="x-waha-bridge"');
  response.status(401).json({ error: "Unauthorized" });
}
