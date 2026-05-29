import { config } from "./config";

const WAHA_TIMEOUT_MS = 30_000;

type ChannelLookupResponse = {
  id: string;
  name?: string;
  invite?: string;
  role?: string;
};

type SentMessageResponse = {
  id?: string;
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
  };
};

const resolvedTargetIds = new Map<string, string>();

function headers(): HeadersInit {
  if (!config.waha.apiKey) {
    return {
      "Content-Type": "application/json"
    };
  }

  return {
    "Content-Type": "application/json",
    "X-Api-Key": config.waha.apiKey
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.waha.baseUrl}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WAHA_TIMEOUT_MS)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WAHA ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${config.waha.baseUrl}${path}`, {
    method: "GET",
    headers: headers(),
    signal: AbortSignal.timeout(WAHA_TIMEOUT_MS)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WAHA ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

function normalizeTargetRef(targetRef: string): string {
  const trimmed = targetRef.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.includes("@newsletter") || trimmed.includes("@g.us") || trimmed.includes("@c.us")) {
    return trimmed;
  }

  if (/^\d+$/.test(trimmed)) {
    return `${trimmed}@c.us`;
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? "";
  }

  return trimmed;
}

async function resolveTargetId(targetRef: string): Promise<string> {
  const normalized = normalizeTargetRef(targetRef);

  if (!normalized) {
    throw new Error("WAHA target reference is empty");
  }

  const cached = resolvedTargetIds.get(normalized);

  if (cached) {
    return cached;
  }

  if (normalized.includes("@newsletter") || normalized.includes("@g.us") || normalized.includes("@c.us")) {
    resolvedTargetIds.set(normalized, normalized);
    return normalized;
  }

  const lookup = await get<ChannelLookupResponse>(
    `/api/${encodeURIComponent(config.waha.sessionName)}/channels/${encodeURIComponent(normalized)}`
  );

  if (!lookup.id?.includes("@newsletter")) {
    throw new Error(`WAHA channel lookup returned invalid id for ref ${normalized}`);
  }

  resolvedTargetIds.set(normalized, lookup.id);
  return lookup.id;
}

export async function resolveConfiguredTargetIds(): Promise<string[]> {
  const refs = config.waha.targetRefs;

  if (refs.length === 0) {
    return [];
  }

  const resolved = await Promise.all(refs.map((ref) => resolveTargetId(ref)));
  return Array.from(new Set(resolved));
}

export async function resolveConfiguredForwardTargetIds(): Promise<string[]> {
  const refs = config.waha.forwardTargetRefs;

  if (refs.length === 0) {
    return [];
  }

  const resolved = await Promise.all(refs.map((ref) => resolveTargetId(ref)));
  return Array.from(new Set(resolved));
}

function serializeMessageId(chatId: string, response: SentMessageResponse): string {
  if (typeof response.id === "string" && /^(true|false)_/.test(response.id)) {
    return response.id;
  }

  const rawId = response.key?.id;

  if (!rawId) {
    throw new Error("WAHA send response did not include a message id");
  }

  const remoteJid = response.key?.remoteJid ?? chatId;
  const fromMe = response.key?.fromMe ?? true;
  const participant = response.key?.participant;

  return `${fromMe}_${remoteJid}_${rawId}${participant ? `_${participant}` : ""}`;
}

export async function sendText(chatId: string, text: string): Promise<string> {
  const response = await post<SentMessageResponse>("/api/sendText", {
    session: config.waha.sessionName,
    chatId,
    text
  });

  return serializeMessageId(chatId, response);
}

export async function sendImage(chatId: string, imageUrl: string, caption: string): Promise<string> {
  const response = await post<SentMessageResponse>("/api/sendImage", {
    session: config.waha.sessionName,
    chatId,
    caption,
    file: {
      url: imageUrl,
      filename: "image.jpg",
      mimetype: "image/jpeg"
    }
  });

  return serializeMessageId(chatId, response);
}

export async function checkWahaSession(): Promise<{ status: string; phone?: string }> {
  const result = await get<{ status: string; config?: { proxy?: string }; me?: { id: string } }>(
    `/api/sessions/${encodeURIComponent(config.waha.sessionName)}`
  );
  return { status: result.status ?? "UNKNOWN", phone: result.me?.id ?? undefined };
}

export async function forwardMessage(chatId: string, messageId: string): Promise<void> {
  await post("/api/forwardMessage", {
    session: config.waha.sessionName,
    chatId,
    messageId
  });
}
