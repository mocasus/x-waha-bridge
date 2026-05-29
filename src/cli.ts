#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { EOL } from "node:os";
import os from "node:os";

type EnvMap = Record<string, string>;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  black: "\x1b[30m",
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

function padVisible(value: string, width: number): string {
  const length = stripAnsi(value).length;
  return `${value}${" ".repeat(Math.max(0, width - length))}`;
}

function loadDotEnv(): EnvMap {
  if (!existsSync(".env")) {
    return {};
  }

  const env: EnvMap = {};
  const content = readFileSync(".env", "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    env[key] = value;
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

function printBanner(): void {
  const compact = (process.stdout.columns ?? 120) < 100;
  const line = `${color("═".repeat(74), "blue")}`;
  const compactLogo = [
    `${color("  X", "white")} ${color("WAHA", "blue")} ${color("BRIDGE", "red")}`,
    `${color("  X posts", "white")} ${color("-> queue", "blue")} ${color("-> WA / TG", "red")}`
  ];
  const logo = [
    `${color("██╗  ██╗", "white")}  ${color("██╗    ██╗ █████╗ ██╗  ██╗ █████╗", "blue")}   ${color("██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗", "red")}`,
    `${color("╚██╗██╔╝", "white")}  ${color("██║    ██║██╔══██╗██║  ██║██╔══██╗", "blue")}  ${color("██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝", "red")}`,
    `${color(" ╚███╔╝ ", "white")}  ${color("██║ █╗ ██║███████║███████║███████║", "blue")}  ${color("██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗", "red")}`,
    `${color(" ██╔██╗ ", "white")}  ${color("██║███╗██║██╔══██║██╔══██║██╔══██║", "blue")}  ${color("██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝", "red")}`,
    `${color("██╔╝ ██╗", "white")}  ${color("╚███╔███╔╝██║  ██║██║  ██║██║  ██║", "blue")}  ${color("██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗", "red")}`,
    `${color("╚═╝  ╚═╝", "white")}  ${color(" ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝", "blue")}  ${color("╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝", "red")}`
  ];

  console.log(line);
  console.log(`${color(" X WAHA Bridge CLI", "bold")} ${color("desktop + termux control panel", "dim")}`);
  console.log(line);
  for (const row of compact ? compactLogo : logo) {
    console.log(row);
  }
  console.log(line);
}

function printRows(title: string, rows: Array<[string, string]>): void {
  console.log(color(`\n${title}`, "bold"));
  console.log(color("─".repeat(74), "blue"));

  for (const [label, value] of rows) {
    console.log(`${color(padVisible(label, 24), "cyan")} ${value}`);
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000)
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      status: response.status,
      body: text
    };
  }
}

async function commandStatus(env: EnvMap): Promise<void> {
  printBanner();
  const port = getEnv("APP_PORT", env) || getEnv("PORT", env) || "8080";
  const adminToken = getEnv("APP_ADMIN_TOKEN", env);
  const healthUrl = `http://localhost:${port}/healthz`;
  const runtimeUrl = `http://localhost:${port}/runtime`;

  try {
    const health = await fetchJson(healthUrl);
    printRows("Local service", [
      ["healthz", JSON.stringify(health, null, 2)]
    ]);
  } catch (error) {
    printRows("Local service", [
      ["healthz", color(error instanceof Error ? error.message : String(error), "red")],
      ["hint", "Start with: docker compose up -d --build"]
    ]);
  }

  if (adminToken) {
    try {
      const runtime = await fetchJson(runtimeUrl, {
        Authorization: `Bearer ${adminToken}`
      });
      printRows("Runtime", [
        ["runtime", JSON.stringify(runtime, null, 2)]
      ]);
    } catch (error) {
      printRows("Runtime", [
        ["runtime", color(error instanceof Error ? error.message : String(error), "red")]
      ]);
    }
  }
}

function commandDoctor(env: EnvMap): void {
  printBanner();

  const required = [
    "DATABASE_URL",
    "REDIS_URL",
    "WAHA_BASE_URL",
    "WAHA_SESSION_NAME"
  ];
  const optional = [
    "WAHA_API_KEY",
    "WAHA_TARGETS",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_IDS",
    "APP_ADMIN_TOKEN"
  ];

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
      ["database", "Use external PostgreSQL/Redis or run them on another host."],
      ["docker", "Docker Compose is not expected to work on normal Termux."]
    ]);
  }
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
  ].join(EOL));
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
  printRows("Commands", [
    ["npm run cli", "Open this panel."],
    ["npm run cli -- doctor", "Check OS, tools, and env readiness."],
    ["npm run cli -- status", "Check local /healthz and /runtime."],
    ["npm run cli -- env", "Print minimal .env template."],
    ["npm run cli -- railway", "Show Railway deployment checklist."]
  ]);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
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

  commandHelp();
}

main().catch((error) => {
  console.error(color(error instanceof Error ? error.message : String(error), "red"));
  process.exit(1);
});
