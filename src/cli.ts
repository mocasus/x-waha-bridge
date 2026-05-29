#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type EnvMap = Record<string, string>;
type JsonObject = Record<string, unknown>;

type SourceRecord = {
  id: number;
  username: string;
  active: boolean;
  includeReplies: boolean;
  includeReposts: boolean;
  includeQuotes: boolean;
  lastCheckedAt: string | null;
};

type DeliveryPage = {
  items: Array<{
    status: string;
    attempts: number;
    wa_channel_id: string;
    x_post_id: string;
    username: string;
    last_error: string | null;
  }>;
  total: number;
};

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlack: "\x1b[40m",
  bgBlue: "\x1b[44m",
  bgRed: "\x1b[41m"
} as const;

const noColor = Boolean(process.env.NO_COLOR);

function color(value: string, code: keyof typeof ANSI): string {
  return noColor ? value : `${ANSI[code]}${value}${ANSI.reset}`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function pad(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

function truncate(value: string, width: number): string {
  if (visibleLength(value) <= width) {
    return value;
  }

  return `${stripAnsi(value).slice(0, Math.max(0, width - 3))}...`;
}

function terminalWidth(): number {
  return Math.max(46, Math.min(process.stdout.columns ?? 96, 112));
}

function line(char = "-"): string {
  return color(char.repeat(terminalWidth()), "blue");
}

function fixedWidth(value: string, width = terminalWidth()): string {
  return pad(truncate(value, width), width);
}

function loadDotEnv(): EnvMap {
  if (!existsSync(".env")) {
    return {};
  }

  const env: EnvMap = {};
  const content = readFileSync(".env", "utf8");

  for (const lineValue of content.split(/\r?\n/)) {
    const trimmed = lineValue.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator < 0) {
      continue;
    }

    env[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return env;
}

function getEnv(name: string, env: EnvMap): string {
  return process.env[name] ?? env[name] ?? "";
}

function detectRuntime(): string {
  if (process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux")) {
    return "Android Termux";
  }

  if (process.platform === "win32") {
    return "Windows";
  }

  if (process.platform === "darwin") {
    return "macOS";
  }

  if (process.platform === "linux") {
    return "Linux";
  }

  return `${process.platform}/${process.arch}`;
}

function runVersion(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    if (process.platform === "win32" && !command.endsWith(".cmd")) {
      return runVersion(`${command}.cmd`, args);
    }

    return "not found";
  }
}

function runNpmVersion(): string {
  try {
    if (process.env.npm_execpath) {
      return execFileSync(process.execPath, [process.env.npm_execpath, "--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    }
  } catch {
    // Fall through to PATH lookup.
  }

  return runVersion("npm", ["--version"]);
}

function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
  }
}

function printBanner(): void {
  const width = terminalWidth();
  const compact = width < 76;
  const route = compact
    ? "  [X] -> queue -> WA/TG"
    : "  [X] source monitor -> queue -> WAHA / Telegram";
  const artRows = compact
    ? [
      ["X   X", "Posts -> channels", "blue"],
      [" XXX ", "Queue + retry", "red"],
      ["X   X", "Admin console", "blue"]
    ]
    : [
      ["XX      XX", "X posts route", "blue"],
      [" XX    XX ", "PostgreSQL state + Redis/BullMQ queue", "red"],
      ["   XXXX   ", "Dashboard API + worker publishing", "blue"],
      [" XX    XX ", "WAHA channels + Telegram bot targets", "red"],
      ["XX      XX", "Railway-ready production control", "blue"]
    ];
  const leftWidth = compact ? 7 : 12;
  const rightWidth = Math.max(10, width - leftWidth - 1);

  console.log(color(" ".repeat(width), "bgBlack"));
  console.log(color(fixedWidth("  X WAHA BRIDGE", width), "bgBlue"));
  console.log(color(fixedWidth("  CLI dashboard for desktop + Termux", width), "bgBlack"));
  console.log(color(fixedWidth(route, width), "bgRed"));
  console.log(color(" ".repeat(width), "bgBlack"));

  for (const [mark, text, accent] of artRows) {
    console.log(
      `${color(fixedWidth(mark, leftWidth), "white")} ${color(fixedWidth(text, rightWidth), accent as keyof typeof ANSI)}`
    );
  }

  console.log(line("="));
}

function section(title: string): void {
  console.log(color(`\n${title}`, "bold"));
  console.log(line());
}

function printRows(title: string, rows: Array<[string, string]>): void {
  section(title);

  for (const [label, value] of rows) {
    console.log(`${color(pad(label, 22), "cyan")} ${value}`);
  }
}

function printTable(headers: string[], rows: string[][]): void {
  const gapWidth = Math.max(0, headers.length - 1) * 2;
  const maxCellWidth = Math.max(4, Math.floor((terminalWidth() - gapWidth) / headers.length));
  const widths = headers.map((header, index) => {
    const longest = Math.max(
      visibleLength(header),
      ...rows.map((row) => visibleLength(row[index] ?? ""))
    );
    return Math.min(Math.max(longest, 4), 28, maxCellWidth);
  });

  console.log(headers.map((header, index) => color(pad(header, widths[index]), "blue")).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));

  for (const row of rows) {
    console.log(row.map((cell, index) => pad(truncate(cell, widths[index]), widths[index])).join("  "));
  }
}

async function pause(rl: readline.Interface): Promise<void> {
  await rl.question(color("\nPress Enter to continue...", "dim"));
}

async function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return (await rl.question(color(prompt, "cyan"))).trim();
}

async function confirm(rl: readline.Interface, prompt: string): Promise<boolean> {
  const answer = (await ask(rl, `${prompt} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}

class LocalApi {
  readonly baseUrl: string;
  readonly adminToken: string;

  constructor(env: EnvMap) {
    const port = getEnv("APP_PORT", env) || getEnv("PORT", env) || "8080";
    this.baseUrl = getEnv("CLI_BASE_URL", env) || `http://localhost:${port}`;
    this.adminToken = getEnv("APP_ADMIN_TOKEN", env);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...extra,
      ...(this.adminToken ? { Authorization: `Bearer ${this.adminToken}` } : {})
    };
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init.headers as Record<string, string> | undefined),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    let payload: unknown = undefined;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { body: text };
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    return payload as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}

function statusLabel(value: boolean): string {
  return value ? color("on", "blue") : color("off", "red");
}

async function showOverview(api: LocalApi): Promise<void> {
  section("Overview");

  try {
    const health = await api.get<JsonObject>("/healthz");
    printRows("Health", [
      ["service", color("online", "blue")],
      ["role", String(health.role ?? "?")],
      ["waha", JSON.stringify(health.waha ?? {})],
      ["stats", JSON.stringify(health.stats ?? {})]
    ]);
  } catch (error) {
    printRows("Health", [
      ["service", color("offline", "red")],
      ["error", error instanceof Error ? error.message : String(error)],
      ["hint", "Run: docker compose up -d --build"]
    ]);
  }

  try {
    const runtime = await api.get<JsonObject>("/runtime");
    printRows("Targets", [
      ["waha", JSON.stringify((runtime.waha as JsonObject | undefined)?.resolvedTargets ?? [])],
      ["forward", JSON.stringify((runtime.waha as JsonObject | undefined)?.resolvedForwardTargets ?? [])],
      ["telegram", JSON.stringify((runtime.telegram as JsonObject | undefined)?.targets ?? [])]
    ]);
  } catch {
    console.log(color("Runtime locked or unavailable. Set APP_ADMIN_TOKEN for CLI access.", "dim"));
  }
}

async function listSources(api: LocalApi): Promise<SourceRecord[]> {
  const sources = await api.get<SourceRecord[]>("/sources");
  const rows = sources.map((source) => [
    String(source.id),
    `@${source.username}`,
    source.active ? color("active", "blue") : color("paused", "red"),
    statusLabel(source.includeReposts),
    statusLabel(source.includeQuotes),
    statusLabel(source.includeReplies),
    source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString() : "never"
  ]);

  section("X Accounts / Sources");
  printTable(["ID", "Account", "Status", "Reposts", "Quotes", "Replies", "Last checked"], rows);
  return sources;
}

async function accountMenu(rl: readline.Interface, api: LocalApi): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    await listSources(api).catch((error) => {
      console.log(color(error instanceof Error ? error.message : String(error), "red"));
      return [];
    });

    printRows("Account actions", [
      ["1", "Add account"],
      ["2", "Bulk add accounts"],
      ["3", "Toggle account active/paused"],
      ["4", "Update repost/quote/reply flags"],
      ["5", "Trigger Sync Now"],
      ["0", "Back"]
    ]);

    const choice = await ask(rl, "\nChoose account action: ");

    if (choice === "0") return;

    try {
      if (choice === "1") {
        const username = await ask(rl, "X username without @: ");
        if (!username) continue;
        await api.post("/sources", {
          username,
          includeReposts: await confirm(rl, "Include reposts?"),
          includeQuotes: await confirm(rl, "Include quotes?"),
          includeReplies: await confirm(rl, "Include replies?")
        });
      }

      if (choice === "2") {
        const raw = await ask(rl, "Usernames separated by comma: ");
        const usernames = raw.split(",").map((value) => value.trim()).filter(Boolean);
        await api.post("/sources/bulk", { usernames });
      }

      if (choice === "3") {
        const id = await ask(rl, "Source ID: ");
        const active = await confirm(rl, "Set active?");
        await api.patch(`/sources/${id}`, { active });
      }

      if (choice === "4") {
        const id = await ask(rl, "Source ID: ");
        await api.patch(`/sources/${id}`, {
          includeReposts: await confirm(rl, "Include reposts?"),
          includeQuotes: await confirm(rl, "Include quotes?"),
          includeReplies: await confirm(rl, "Include replies?")
        });
      }

      if (choice === "5") {
        await api.post("/sync-now", {});
        console.log(color("Sync triggered.", "blue"));
      }
    } catch (error) {
      console.log(color(error instanceof Error ? error.message : String(error), "red"));
    }

    await pause(rl);
  }
}

async function deliveryMenu(rl: readline.Interface, api: LocalApi): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    section("Deliveries");

    try {
      const page = await api.get<DeliveryPage>("/deliveries?limit=15&page=1");
      printTable(
        ["Status", "Try", "Target", "X post", "Account", "Error"],
        page.items.map((item) => [
          item.status === "sent" ? color(item.status, "blue") : item.status === "failed" ? color(item.status, "red") : item.status,
          String(item.attempts),
          item.wa_channel_id,
          item.x_post_id,
          `@${item.username}`,
          item.last_error ?? "-"
        ])
      );
      console.log(color(`\nTotal deliveries: ${page.total}`, "dim"));
    } catch (error) {
      console.log(color(error instanceof Error ? error.message : String(error), "red"));
    }

    printRows("Delivery actions", [
      ["1", "Retry failed deliveries"],
      ["2", "Retry pending + failed deliveries"],
      ["0", "Back"]
    ]);

    const choice = await ask(rl, "\nChoose delivery action: ");

    if (choice === "0") return;

    try {
      if (choice === "1") {
        await api.post("/deliveries/retry", { statuses: ["failed"] });
        console.log(color("Failed deliveries requeued.", "blue"));
      }

      if (choice === "2") {
        await api.post("/deliveries/retry", { statuses: ["pending", "failed"] });
        console.log(color("Pending and failed deliveries requeued.", "blue"));
      }
    } catch (error) {
      console.log(color(error instanceof Error ? error.message : String(error), "red"));
    }

    await pause(rl);
  }
}

async function runtimeMenu(api: LocalApi): Promise<void> {
  section("Runtime / Targets");

  try {
    const runtime = await api.get<JsonObject>("/runtime");
    console.log(JSON.stringify(runtime, null, 2));
  } catch (error) {
    console.log(color(error instanceof Error ? error.message : String(error), "red"));
  }
}

function doctorRows(env: EnvMap): void {
  const required = ["DATABASE_URL", "REDIS_URL", "WAHA_BASE_URL", "WAHA_SESSION_NAME"];
  const optional = ["WAHA_API_KEY", "WAHA_TARGETS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_IDS", "APP_ADMIN_TOKEN"];

  printRows("Platform", [
    ["runtime", detectRuntime()],
    ["node", process.version],
    ["system", `${os.platform()} ${os.arch()}`],
    ["term", process.env.TERM_PROGRAM ?? process.env.TERM ?? "unknown"]
  ]);

  printRows("Tools", [
    ["npm", runNpmVersion()],
    ["git", runVersion("git", ["--version"])],
    ["docker", runVersion("docker", ["--version"])]
  ]);

  printRows("Required env", required.map((name) => [
    name,
    getEnv(name, env) ? color("set", "blue") : color("missing", "red")
  ]));

  printRows("Optional env", optional.map((name) => [
    name,
    getEnv(name, env) ? color("set", "blue") : color("empty", "dim")
  ]));

  if (detectRuntime() === "Android Termux") {
    printRows("Termux note", [
      ["database", "Use external PostgreSQL/Redis or another host."],
      ["docker", "Docker Compose is not expected on normal Termux."]
    ]);
  }
}

function commandDoctor(env: EnvMap): void {
  printBanner();
  doctorRows(env);
}

function commandEnv(): void {
  printBanner();
  console.log([
    "DATABASE_URL=postgres://bridge:bridge@postgres:5432/x_waha_bridge",
    "REDIS_URL=redis://redis:6379",
    "",
    "APP_LOGIN_ENABLED=true",
    "APP_ADMIN_USERNAME=admin",
    "APP_ADMIN_PASSWORD=change_this_password",
    "APP_ADMIN_TOKEN=change_this_long_random_token",
    "",
    "X_PROVIDER=nitter",
    "X_NITTER_BASE_URL=https://nitter.net",
    "X_SOURCE_USERNAMES=xdevelopers",
    "X_BOOTSTRAP_MODE=latest",
    "",
    "WAHA_BASE_URL=https://your-waha-host.example.com",
    "WAHA_API_KEY=your_waha_api_key",
    "WAHA_SESSION_NAME=default",
    "WAHA_TARGETS=120363xxxxxxxxxx@g.us",
    "",
    "TELEGRAM_BOT_TOKEN=",
    "TELEGRAM_CHAT_IDS="
  ].join("\n"));
}

function commandRailway(): void {
  printBanner();
  printRows("Railway services", [
    ["bridge-api", "APP_ROLE=api, public domain, healthcheck /healthz"],
    ["bridge-scheduler", "APP_ROLE=scheduler, no public domain"],
    ["bridge-worker", "APP_ROLE=worker, no public domain"],
    ["postgres", "Railway PostgreSQL"],
    ["redis", "Railway Redis"]
  ]);
  printRows("Deploy flow", [
    ["1", "Create Railway project and connect GitHub repo."],
    ["2", "Add PostgreSQL and Redis services."],
    ["3", "Create three app services from the same repo."],
    ["4", "Copy env vars to all app services, changing APP_ROLE only."],
    ["5", "Deploy and open bridge-api /healthz."]
  ]);
}

function commandHelp(): void {
  printBanner();
  printRows("CLI quick start", [
    ["1", "npm install"],
    ["2", "copy .env.example .env"],
    ["3", "edit .env with WAHA, DB, Redis, and admin token"],
    ["4", "npm run doctor"],
    ["5", "docker compose up -d --build"],
    ["6", "npm run cli"]
  ]);
  printRows("Commands", [
    ["npm run cli", "Open interactive dashboard menu."],
    ["npm run doctor", "Check OS, tools, and env readiness."],
    ["npm run status", "Check local /healthz and /runtime."],
    ["npm run cli -- env", "Print minimal .env template."],
    ["npm run cli -- railway", "Show Railway deployment checklist."]
  ]);
}

async function dashboard(env: EnvMap): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const api = new LocalApi(env);

  try {
    while (true) {
      clearScreen();
      printBanner();
      printRows("Main menu", [
        ["1", "Overview and health"],
        ["2", "X accounts / sources"],
        ["3", "Deliveries and retries"],
        ["4", "Runtime targets"],
        ["5", "Doctor"],
        ["6", "Railway guide"],
        ["7", "Print env template"],
        ["0", "Exit"]
      ]);

      const choice = await ask(rl, "\nChoose menu: ");

      clearScreen();
      printBanner();

      if (choice === "0") {
        return;
      }

      if (choice === "1") {
        await showOverview(api);
        await pause(rl);
        continue;
      }

      if (choice === "2") {
        await accountMenu(rl, api);
        continue;
      }

      if (choice === "3") {
        await deliveryMenu(rl, api);
        continue;
      }

      if (choice === "4") {
        await runtimeMenu(api);
        await pause(rl);
        continue;
      }

      if (choice === "5") {
        doctorRows(env);
        await pause(rl);
        continue;
      }

      if (choice === "6") {
        commandRailway();
        await pause(rl);
        continue;
      }

      if (choice === "7") {
        commandEnv();
        await pause(rl);
        continue;
      }
    }
  } finally {
    rl.close();
  }
}

async function commandStatus(env: EnvMap): Promise<void> {
  printBanner();
  await showOverview(new LocalApi(env));
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "dashboard";
  const env = loadDotEnv();

  if (command === "doctor") {
    commandDoctor(env);
    return;
  }

  if (command === "status") {
    await commandStatus(env);
    return;
  }

  if (command === "env") {
    commandEnv();
    return;
  }

  if (command === "railway") {
    commandRailway();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    commandHelp();
    return;
  }

  await dashboard(env);
}

main().catch((error) => {
  console.error(color(error instanceof Error ? error.message : String(error), "red"));
  process.exit(1);
});
