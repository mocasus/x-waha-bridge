import type { VercelRequest, VercelResponse } from "@vercel/node";

type RequestHandler = (req: VercelRequest, res: VercelResponse) => void;

let app: RequestHandler | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const [{ ensureSchema }, { syncEnvSources }, { createHttpApp }] = await Promise.all([
        import("../src/db"),
        import("../src/repositories"),
        import("../src/http")
      ]);

      await ensureSchema();
      await syncEnvSources();

      app = createHttpApp();
    })();
  }

  return initPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await ensureInitialized();

    if (!app) {
      throw new Error("Application router is not initialized");
    }

    app(req, res);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const { logger } = await import("../src/logger").catch(() => ({ logger: null as const }));

    if (logger) {
      logger.error({ error: detail }, "Vercel request failed");
    }

    const fallbackUser = (process.env.APP_ADMIN_USERNAME || "").trim();
    const fallbackPassword = process.env.APP_ADMIN_PASSWORD || "";
    const authHeader = req.headers.authorization || "";

    if (fallbackUser && fallbackPassword) {
      const encoded = authHeader.startsWith("Basic ") ? authHeader.slice(6).trim() : "";
      const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
      const separatorIndex = decoded.indexOf(":");
      const providedUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
      const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

      if (providedUser !== fallbackUser || providedPassword !== fallbackPassword) {
        res.setHeader("WWW-Authenticate", 'Basic realm="X-WAHA Bridge"');
        res.status(401).json({ ok: false, error: "Authentication required" });
        return;
      }
    }

    res.status(503).json({
      ok: false,
      error: "Bridge is not configured correctly on Vercel",
      detail,
      requiredEnv: ["DATABASE_URL", "REDIS_URL", "WAHA_BASE_URL", "WAHA_SESSION_NAME", "WAHA_TARGETS"]
    });
  }
}
