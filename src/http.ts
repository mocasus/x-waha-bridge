import express from "express";
import session from "express-session";
import os from "node:os";
import { isAdminAuthConfigured, isAuthorizedRequest } from "./auth";
import { config } from "./config";
import { pool } from "./db";
import { logger } from "./logger";
import { dispatchPublish } from "./publish-dispatcher";
import { redis } from "./queue";
import {
  countDeliveries,
  countPosts,
  getHealthCounts,
  getDeliveryStats,
  getSourceById,
  listDeliveries,
  listRecentPosts,
  listRetryableDeliveries,
  listSources,
  softDeleteSource,
  updateSource,
  upsertSource
} from "./repositories";
import { runSchedulerOnce } from "./scheduler";
import { resolveConfiguredTelegramTargetIds } from "./telegram-client";
import type { DeliveryStatus } from "./types";
import { checkWahaSession, resolveConfiguredForwardTargetIds, resolveConfiguredTargetIds } from "./waha-client";

function timeAgo(date: Date | string | null): string {
  if (!date) return "never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    sent: "#22c55e",
    pending: "#eab308",
    failed: "#ef4444",
    WORKING: "#22c55e",
    STOPPED: "#ef4444",
    SCAN_QR_CODE: "#eab308"
  };
  const color = colors[status] ?? "#6b7280";
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${escapeHtml(status)}</span>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getSystemInfo() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    cpus: os.cpus().length,
    loadAverage: os.loadavg(),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      systemTotal: totalMem,
      systemFree: freeMem,
      systemUsed: usedMem,
      systemUsedPercent: Math.round((usedMem / totalMem) * 100)
    }
  };
}

function isCronRequestAuthorized(request: express.Request): boolean {
  const expected = config.cronSecret;

  if (!expected) {
    return true;
  }

  const header = request.header("authorization") || "";
  return header === `Bearer ${expected}`;
}

function renderLoginPage(errorMessage?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - X-WAHA Bridge</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); 
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e2e8f0;
    }
    .login-container {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      color: #f8fafc;
      text-align: center;
    }
    .subtitle {
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 32px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #f8fafc;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #475569;
      border-radius: 8px;
      background: #0f172a;
      color: #f8fafc;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    input::placeholder {
      color: #64748b;
    }
    .error {
      background: #7f1d1d;
      color: #fecaca;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 13px;
      border: 1px solid #991b1b;
      display: none;
    }
    .error.show {
      display: block;
    }
    button {
      width: 100%;
      padding: 10px 16px;
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #2563eb;
    }
    button:active {
      background: #1d4ed8;
    }
    .info {
      margin-top: 24px;
      padding: 12px 16px;
      background: #1e3a8a;
      border: 1px solid #1e40af;
      border-radius: 8px;
      font-size: 12px;
      color: #bfdbfe;
      text-align: center;
    }
    @media (max-width: 480px) {
      .login-container {
        padding: 24px;
      }
      h1 {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>🔐 X-WAHA Bridge</h1>
    <p class="subtitle">Secure Access Required</p>
    
    <form method="POST" action="/login">
      <div class="error${errorMessage ? " show" : ""}" id="error">${errorMessage || ""}</div>
      
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" placeholder="Enter your username" required autofocus>
      </div>
      
      <div class="form-group">
        <label for="password">PIN</label>
        <input type="password" id="password" name="password" placeholder="Enter your PIN" required>
      </div>
      
      <button type="submit">Login</button>
    </form>
    
    <div class="info">
      🔒 This system is protected. Only authorized users can access.
    </div>
  </div>
</body>
</html>`;
}

async function renderDashboard(): Promise<string> {
  const [counts, stats, sources, posts, postsTotal, deliveries, deliveriesTotal, wahaStatus] = await Promise.all([
    getHealthCounts(),
    getDeliveryStats(),
    listSources(),
    listRecentPosts(20),
    countPosts(),
    listDeliveries(30),
    countDeliveries(),
    checkWahaSession().catch(() => ({ status: "UNKNOWN", phone: "?" }))
  ]);

  const [targets, forwards] = await Promise.all([
    resolveConfiguredTargetIds().catch(() => []),
    resolveConfiguredForwardTargetIds().catch(() => [])
  ]);

  const sysInfo = getSystemInfo();
  const uptime = sysInfo.uptime;
  const uptimeStr = uptime < 3600
    ? `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`
    : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

  const postsRows = posts.map((p: any) => `
    <tr>
      <td><a href="${escapeHtml(p.post_url)}" target="_blank" style="color:#3b82f6">${escapeHtml(p.x_post_id)}</a></td>
      <td>@${escapeHtml(p.username)}</td>
      <td title="${escapeHtml(p.text)}">${escapeHtml(p.text.length > 80 ? p.text.substring(0, 80) + "..." : p.text)}</td>
      <td>${p.mediaCount ?? 0}</td>
      <td>${timeAgo(p.posted_at)}</td>
    </tr>`).join("");

  const deliveriesRows = deliveries.map((d: any) => `
    <tr>
      <td><a href="${escapeHtml(d.post_url)}" target="_blank" style="color:#3b82f6">${escapeHtml(d.x_post_id)}</a></td>
      <td>${statusBadge(d.status)}</td>
      <td>${d.attempts}</td>
      <td title="${escapeHtml(d.wa_channel_id)}">${d.wa_channel_id.startsWith("telegram:") ? "Telegram" : d.wa_channel_id.includes("@g.us") ? "Group" : d.wa_channel_id.includes("@newsletter") ? "Channel" : "DM"}</td>
      <td>${d.last_error ? `<span style="color:#ef4444" title="${escapeHtml(d.last_error)}">${escapeHtml(d.last_error.substring(0, 40))}...</span>` : "-"}</td>
      <td>${timeAgo(d.delivered_at || d.updated_at)}</td>
    </tr>`).join("");

  const sourcesRows = sources.map((s: any) => `
    <tr>
      <td><a href="https://x.com/${escapeHtml(s.username)}" target="_blank" style="color:#3b82f6">@${escapeHtml(s.username)}</a></td>
      <td>${s.active ? statusBadge("WORKING") : statusBadge("STOPPED")}</td>
      <td><input type="checkbox" data-source-id="${s.id}" data-field="includeReposts" ${s.includeReposts ? "checked" : ""} onchange="updateSource(this)"></td>
      <td><input type="checkbox" data-source-id="${s.id}" data-field="includeQuotes" ${s.includeQuotes ? "checked" : ""} onchange="updateSource(this)"></td>
      <td>${timeAgo(s.lastCheckedAt)}</td>
      <td>
        <button class="btn-mini ${s.active ? "btn-warn" : "btn-primary"}" onclick="toggleSource(${s.id}, ${!s.active})">${s.active ? "Disable" : "Enable"}</button>
        <button class="btn-mini btn-danger" onclick="deleteSource(${s.id}, '${escapeHtml(s.username)}')">Delete</button>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X-WAHA Bridge Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    h1 { font-size: 24px; color: #f8fafc; margin: 0; }
    .user-info { display: flex; align-items: center; gap: 16px; }
    .username { font-size: 13px; color: #94a3b8; }
    .btn-logout { padding: 6px 12px; background: #7f1d1d; color: #fecaca; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; text-decoration: none; display: inline-block; transition: background 0.2s; }
    .btn-logout:hover { background: #991b1b; }
    .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #1e293b; border-radius: 12px; padding: 16px; border: 1px solid #334155; }
    .card-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 28px; font-weight: 700; color: #f8fafc; margin-top: 4px; }
    .card-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
    .section { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; margin-bottom: 20px; }
    .section h2 { font-size: 16px; margin-bottom: 12px; color: #f8fafc; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; color: #94a3b8; border-bottom: 1px solid #334155; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
    tr:hover td { background: #334155; }
    a { text-decoration: none; }
    a:hover { text-decoration: underline; }
    .actions { display: flex; gap: 8px; margin-bottom: 24px; }
    .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-warn { background: #eab308; color: #1e293b; }
    .btn-warn:hover { background: #ca8a04; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-mini { padding: 4px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 11px; font-weight: 600; margin-right: 4px; }
    .source-form { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
    .source-form input[type="text"] { padding: 6px 10px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 13px; flex: 1; min-width: 200px; }
    .source-form label { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .pagination { display: flex; justify-content: space-between; align-items: center; padding: 12px 0 0; font-size: 13px; color: #94a3b8; }
    .pagination button { padding: 6px 12px; background: #334155; color: #f8fafc; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; }
    .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
    .pagination button:not(:disabled):hover { background: #475569; }
    .progress-bar { width: 100%; height: 6px; background: #0f172a; border-radius: 3px; margin-top: 8px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #eab308, #ef4444); border-radius: 3px; transition: width 0.3s; }
    .refresh-controls { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #94a3b8; }
    .refresh-controls select { padding: 4px 8px; background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 6px; font-size: 12px; }
    .toast { position: fixed; bottom: 20px; right: 20px; background: #22c55e; color: #fff; padding: 10px 20px; border-radius: 8px; display: none; font-size: 13px; z-index: 100; }
    .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; }
    .config-grid dt { color: #94a3b8; }
    .config-grid dd { color: #f8fafc; word-break: break-all; }
    @media (max-width: 768px) {
      .header { flex-direction: column; align-items: flex-start; }
      .grid { grid-template-columns: repeat(2, 1fr); }
      .config-grid { grid-template-columns: 1fr; }
      td, th { padding: 6px 8px; font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>X-WAHA Bridge</h1>
        <p class="subtitle">Uptime: ${uptimeStr} &middot; Node ${escapeHtml(sysInfo.nodeVersion)}</p>
      </div>
      <div class="refresh-controls">
        <span id="refreshIndicator" title="Last refresh">just now</span>
        <select id="refreshInterval" onchange="setRefreshInterval(this.value)" title="Auto-refresh interval">
          <option value="10000">10s</option>
          <option value="30000" selected>30s</option>
          <option value="60000">1m</option>
          <option value="300000">5m</option>
          <option value="0">Off</option>
        </select>
        <button class="btn-mini btn-primary" onclick="location.reload()">Refresh</button>
        ${config.admin.loginEnabled ? `<span class="username">&middot; ${escapeHtml(config.admin.username)}</span><a href="/logout" class="btn-logout">Logout</a>` : ""}
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">WAHA Session</div>
        <div class="card-value">${statusBadge(wahaStatus.status)}</div>
        <div class="card-sub">${escapeHtml(String(wahaStatus.phone ?? ""))}</div>
      </div>
      <div class="card">
        <div class="card-label">Sources</div>
        <div class="card-value">${counts.sources}</div>
        <div class="card-sub">active accounts</div>
      </div>
      <div class="card">
        <div class="card-label">Delivered</div>
        <div class="card-value" style="color:#22c55e">${stats.sent}</div>
        <div class="card-sub">messages sent</div>
      </div>
      <div class="card">
        <div class="card-label">Pending</div>
        <div class="card-value" style="color:#eab308">${stats.pending}</div>
        <div class="card-sub">in queue</div>
      </div>
      <div class="card">
        <div class="card-label">Failed</div>
        <div class="card-value" style="color:#ef4444">${stats.failed}</div>
        <div class="card-sub">need retry</div>
      </div>
      <div class="card">
        <div class="card-label">Provider</div>
        <div class="card-value" style="font-size:18px">${escapeHtml(config.x.provider)}</div>
        <div class="card-sub">${escapeHtml(config.x.nitterBaseUrl)}</div>
      </div>
      <div class="card">
        <div class="card-label">Memory</div>
        <div class="card-value" style="font-size:18px">${formatBytes(sysInfo.memory.heapUsed)}</div>
        <div class="card-sub">heap / RSS ${formatBytes(sysInfo.memory.rss)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(Math.round((sysInfo.memory.heapUsed / sysInfo.memory.heapTotal) * 100), 100)}%"></div></div>
      </div>
      <div class="card">
        <div class="card-label">System Load</div>
        <div class="card-value" style="font-size:18px">${sysInfo.loadAverage[0].toFixed(2)}</div>
        <div class="card-sub">${sysInfo.cpus} CPUs &middot; ${escapeHtml(sysInfo.platform)}</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="doAction('/sync-now', 'Sync triggered')">Sync Now</button>
      <button class="btn btn-warn" onclick="doAction('/deliveries/retry', 'Retrying failed deliveries')">Retry Failed</button>
    </div>

    <div class="section">
      <h2>Sources</h2>
      <form class="source-form" onsubmit="addSource(event)">
        <input type="text" id="newUsername" placeholder="X username (without @)" required>
        <label><input type="checkbox" id="newReposts"> Reposts</label>
        <label><input type="checkbox" id="newQuotes" checked> Quotes</label>
        <label><input type="checkbox" id="newReplies"> Replies</label>
        <button type="submit" class="btn btn-primary">Add Source</button>
      </form>
      <table>
        <thead><tr><th>Account</th><th>Status</th><th>Reposts</th><th>Quotes</th><th>Last Checked</th><th>Actions</th></tr></thead>
        <tbody>${sourcesRows || '<tr><td colspan="6" style="text-align:center;color:#64748b">No sources configured</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Recent Posts</h2>
      <table>
        <thead><tr><th>Post ID</th><th>Author</th><th>Text</th><th>Media</th><th>Posted</th></tr></thead>
        <tbody>${postsRows || '<tr><td colspan="5" style="text-align:center;color:#64748b">No posts yet</td></tr>'}</tbody>
      </table>
      <div class="pagination">
        <span>Showing ${posts.length} of ${postsTotal} posts</span>
        <div>
          <button onclick="exportData('posts')">Export JSON</button>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Deliveries</h2>
      <table>
        <thead><tr><th>Post ID</th><th>Status</th><th>Attempts</th><th>Target</th><th>Error</th><th>Time</th></tr></thead>
        <tbody>${deliveriesRows || '<tr><td colspan="6" style="text-align:center;color:#64748b">No deliveries yet</td></tr>'}</tbody>
      </table>
      <div class="pagination">
        <span>Showing ${deliveries.length} of ${deliveriesTotal} deliveries</span>
        <div>
          <button onclick="exportData('deliveries')">Export JSON</button>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Configuration</h2>
      <dl class="config-grid">
        <dt>Targets</dt><dd>${targets.map(escapeHtml).join(", ") || "none"}</dd>
        <dt>Forward Targets</dt><dd>${forwards.map(escapeHtml).join(", ") || "none"}</dd>
        <dt>Poll Interval</dt><dd>${config.x.fetchIntervalMs / 1000}s</dd>
        <dt>Batch Size</dt><dd>${config.x.fetchBatchSize}</dd>
        <dt>Source Usernames</dt><dd>${config.x.sourceUsernames.map(u => "@" + escapeHtml(u)).join(", ")}</dd>
      </dl>
    </div>
  </div>

  <div class="toast" id="toast"></div>
  <script>
    let refreshTimer = null;

    function showToast(msg, type) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = type === 'error' ? '#ef4444' : (type === 'warn' ? '#eab308' : '#22c55e');
      t.style.color = type === 'warn' ? '#1e293b' : '#fff';
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    async function doAction(path, msg) {
      try {
        const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast(msg);
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        showToast('Action failed: ' + e.message, 'error');
      }
    }

    async function addSource(e) {
      e.preventDefault();
      const username = document.getElementById('newUsername').value.trim().toLowerCase();
      if (!username) return;
      try {
        const res = await fetch('/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            includeReposts: document.getElementById('newReposts').checked,
            includeQuotes: document.getElementById('newQuotes').checked,
            includeReplies: document.getElementById('newReplies').checked
          })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast('Source added');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        showToast('Add failed: ' + e.message, 'error');
      }
    }

    async function updateSource(input) {
      const id = input.dataset.sourceId;
      const field = input.dataset.field;
      try {
        const res = await fetch('/sources/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: input.checked })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast('Updated ' + field);
      } catch (e) {
        showToast('Update failed: ' + e.message, 'error');
        input.checked = !input.checked;
      }
    }

    async function toggleSource(id, active) {
      try {
        const res = await fetch('/sources/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast(active ? 'Source enabled' : 'Source disabled');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        showToast('Toggle failed: ' + e.message, 'error');
      }
    }

    async function deleteSource(id, username) {
      if (!confirm('Disable source @' + username + '?\\n\\nThis will stop polling. Existing posts will remain in the database.')) return;
      try {
        const res = await fetch('/sources/' + id, { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast('Source disabled');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
      }
    }

    function exportData(kind) {
      window.open('/' + kind + '?limit=200', '_blank');
    }

    function setRefreshInterval(ms) {
      const interval = parseInt(ms, 10);
      localStorage.setItem('refreshIntervalMs', String(interval));
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (interval > 0) {
        refreshTimer = setInterval(() => location.reload(), interval);
      }
    }

    (function init() {
      const saved = localStorage.getItem('refreshIntervalMs');
      const select = document.getElementById('refreshInterval');
      if (saved !== null) {
        select.value = saved;
      }
      setRefreshInterval(select.value);
    })();
  </script>
</body>
</html>`;
}

export function createHttpApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session middleware for login support
  if (config.admin.loginEnabled) {
    app.use(
      session({
        secret: config.admin.token || config.admin.password || "x-waha-bridge-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: process.env.NODE_ENV === "production",
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
      })
    );
  }

  const protectAdminRoute = (request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (isAdminAuthConfigured() && isAuthorizedRequest(request)) {
      next();
      return;
    }

    if (config.admin.loginEnabled && !request.session?.authenticated) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (isAdminAuthConfigured()) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };

  // Login page
  if (config.admin.loginEnabled) {
    app.get("/login", (_request, response) => {
      response.type("html").send(renderLoginPage());
    });

    app.post("/login", (request, response) => {
      const { username, password } = request.body;

      if (
        username === config.admin.username &&
        password === config.admin.password
      ) {
        request.session.authenticated = true;
        response.redirect("/");
        return;
      }

      response.type("html").send(renderLoginPage("Invalid username or PIN. Please try again."));
    });

    app.get("/logout", (request, response) => {
      request.session.destroy(() => {
        response.redirect("/login");
      });
    });
  }

  // Dashboard
  app.get("/", protectAdminRoute, async (_request, response) => {
    try {
      const html = await renderDashboard();
      response.type("html").send(html);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Dashboard render failed");
      response.status(500).send("Dashboard error");
    }
  });

  // Health check
  app.get("/healthz", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      await redis.ping();
      const counts = await getHealthCounts();
      const stats = await getDeliveryStats();
      const waha = await checkWahaSession().catch(() => ({ status: "UNKNOWN" }));
      response.json({ ok: true, role: config.role, counts, stats, waha });
    } catch (error) {
      response.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Runtime config
  app.get("/runtime", protectAdminRoute, async (_request, response) => {
    const [targets, forwards] = await Promise.all([
      resolveConfiguredTargetIds().catch(() => []),
      resolveConfiguredForwardTargetIds().catch(() => [])
    ]);
    const telegramTargets = resolveConfiguredTelegramTargetIds();

    response.json({
      role: config.role,
      uptime: process.uptime(),
      x: {
        provider: config.x.provider,
        nitterBaseUrl: config.x.nitterBaseUrl,
        fetchIntervalMs: config.x.fetchIntervalMs,
        fetchBatchSize: config.x.fetchBatchSize,
        bootstrapMode: config.x.bootstrapMode,
        bearerEnabled: Boolean(config.x.bearerToken),
        sourceUsernames: config.x.sourceUsernames
      },
      waha: {
        sessionName: config.waha.sessionName,
        targetRefs: config.waha.targetRefs,
        resolvedTargets: targets,
        forwardTargetRefs: config.waha.forwardTargetRefs,
        resolvedForwardTargets: forwards
      },
      telegram: {
        enabled: Boolean(config.telegram.botToken && config.telegram.chatIds.length > 0),
        targets: telegramTargets
      },
      message: {
        sendMedia: config.message.sendMedia
      }
    });
  });

  // Sources CRUD
  app.get("/sources", protectAdminRoute, async (_request, response) => {
    response.json(await listSources());
  });

  app.post("/sources", protectAdminRoute, async (request, response) => {
    const body = request.body as {
      username?: string;
      includeReplies?: boolean;
      includeReposts?: boolean;
      includeQuotes?: boolean;
    };

    if (!body.username?.trim()) {
      response.status(400).json({ error: "username is required" });
      return;
    }

    const source = await upsertSource({
      username: body.username.trim().toLowerCase(),
      includeReplies: body.includeReplies,
      includeReposts: body.includeReposts,
      includeQuotes: body.includeQuotes
    });

    response.status(201).json(source);
  });

  app.post("/sources/bulk", protectAdminRoute, async (request, response) => {
    const body = request.body as {
      usernames?: string[];
      includeReplies?: boolean;
      includeReposts?: boolean;
      includeQuotes?: boolean;
    };

    const usernames = (body.usernames ?? [])
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean);

    if (usernames.length === 0) {
      response.status(400).json({ error: "usernames is required and must contain at least one entry" });
      return;
    }

    const unique = [...new Set(usernames)];
    const sources = await Promise.all(
      unique.map((username) =>
        upsertSource({
          username,
          includeReplies: body.includeReplies,
          includeReposts: body.includeReposts,
          includeQuotes: body.includeQuotes
        })
      )
    );

    response.status(201).json({ count: sources.length, sources });
  });

  app.patch("/sources/:id", protectAdminRoute, async (request, response) => {
    const id = Number(request.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      response.status(400).json({ error: "Invalid source id" });
      return;
    }

    const body = request.body as {
      active?: boolean;
      includeReplies?: boolean;
      includeReposts?: boolean;
      includeQuotes?: boolean;
    };

    const updated = await updateSource(id, {
      active: typeof body.active === "boolean" ? body.active : undefined,
      includeReplies: typeof body.includeReplies === "boolean" ? body.includeReplies : undefined,
      includeReposts: typeof body.includeReposts === "boolean" ? body.includeReposts : undefined,
      includeQuotes: typeof body.includeQuotes === "boolean" ? body.includeQuotes : undefined
    });

    if (!updated) {
      response.status(404).json({ error: "Source not found" });
      return;
    }

    response.json(updated);
  });

  app.delete("/sources/:id", protectAdminRoute, async (request, response) => {
    const id = Number(request.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      response.status(400).json({ error: "Invalid source id" });
      return;
    }

    const existing = await getSourceById(id);

    if (!existing) {
      response.status(404).json({ error: "Source not found" });
      return;
    }

    const ok = await softDeleteSource(id);
    response.json({ ok, deleted: existing.username });
  });

  // System info
  app.get("/system", protectAdminRoute, (_request, response) => {
    response.json(getSystemInfo());
  });

  // Deliveries
  app.get("/deliveries", protectAdminRoute, async (request, response) => {
    const rawLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawPage = Number(request.query.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([listDeliveries(limit, offset), countDeliveries()]);
    response.json({ items, total, page, pageSize: limit });
  });

  // Stats
  app.get("/stats", protectAdminRoute, async (_request, response) => {
    const stats = await getDeliveryStats();
    const counts = await getHealthCounts();
    response.json({ ...counts, ...stats });
  });

  // Posts
  app.get("/posts", protectAdminRoute, async (request, response) => {
    const rawLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
    const rawPage = Number(request.query.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([listRecentPosts(limit, offset), countPosts()]);
    response.json({ items, total, page, pageSize: limit });
  });

  // Sync now
  app.post("/sync-now", protectAdminRoute, async (_request, response) => {
    runSchedulerOnce().catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Manual sync failed");
    });
    response.status(202).json({ ok: true, message: "Sync triggered" });
  });

  app.get("/cron/sync", async (request, response) => {
    if (!isCronRequestAuthorized(request)) {
      response.status(401).json({ ok: false, error: "Unauthorized cron request" });
      return;
    }

    runSchedulerOnce().catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Cron sync failed");
    });

    response.status(202).json({ ok: true, message: "Cron sync triggered" });
  });

  // Retry failed deliveries
  app.post("/deliveries/retry", protectAdminRoute, async (request, response) => {
    const body = request.body as { statuses?: DeliveryStatus[] };
    const allowedStatuses: DeliveryStatus[] = ["pending", "failed"];
    const statuses = (body.statuses?.filter((status): status is DeliveryStatus => allowedStatuses.includes(status)) ?? allowedStatuses);
    const deliveries = await listRetryableDeliveries(statuses);

    for (const delivery of deliveries) {
      await dispatchPublish({ postId: delivery.postId, waChannelId: delivery.waChannelId });
    }

    response.status(202).json({ ok: true, requeued: deliveries.length, statuses });
  });

  // WAHA session status
  app.get("/waha/status", protectAdminRoute, async (_request, response) => {
    try {
      const status = await checkWahaSession();
      response.json(status);
    } catch (error) {
      response.status(502).json({ status: "ERROR", error: error instanceof Error ? error.message : String(error) });
    }
  });

  return app;
}

export async function startHttpServer(): Promise<() => Promise<void>> {
  const app = createHttpApp();

  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info({ port: config.port, host: "0.0.0.0" }, "HTTP server started");
  });

  return async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };
}
