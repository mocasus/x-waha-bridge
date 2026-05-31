<p align="center">
  <img src="assets/logo.svg" alt="X WAHA Bridge" width="860">
</p>

<p align="center">
  <a href="https://nodejs.org"><img alt="Node.js 22" src="https://img.shields.io/badge/Node.js-22-101820?style=for-the-badge&logo=node.js&logoColor=white"></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white"></a>
  <a href="https://railway.com"><img alt="Railway ready" src="https://img.shields.io/badge/Railway-ready-0B0D0E?style=for-the-badge&logo=railway&logoColor=white"></a>
  <a href="https://docs.docker.com/compose/"><img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white"></a>
</p>

<p align="center">
  Mirror public X posts to WhatsApp via WAHA and Telegram via Bot API, with PostgreSQL state, Redis queues, retries, a dark CLI, and an admin dashboard.
</p>

## GitHub Share Preview

Repo ini sudah punya deskripsi dan topics GitHub agar link share punya konteks yang jelas. Custom preview image disiapkan di `assets/social-preview.png` dengan ukuran `1280x640`.

Untuk mengaktifkan gambar embed GitHub:

1. Buka repo di GitHub.
2. Masuk ke `Settings`.
3. Cari bagian `Social preview`.
4. Klik `Edit`, lalu upload `assets/social-preview.png`.

## Apa Ini?

X WAHA Bridge adalah service automation untuk memantau akun X publik, menyimpan post baru, lalu mengirimkannya ke target WhatsApp dan Telegram. Project ini cocok untuk membuat bot mirror, news relay, komunitas update channel, atau pipeline publikasi otomatis dari beberapa akun X ke channel yang kamu kelola.

Project ini tidak hanya mengambil post lalu langsung mengirim pesan. Ia menyimpan state di database, membuat delivery record, menahan duplikasi, memakai queue untuk publish, dan menyediakan dashboard admin untuk melihat source, post, delivery, retry, serta status WAHA.

## Kenapa Dibuat Begini?

Automation X ke WhatsApp/Telegram mudah terlihat sederhana, tapi biasanya rusak di bagian operasional:

- Post yang sama bisa terkirim dua kali.
- Scheduler bisa overlap saat polling lambat.
- WAHA atau Telegram bisa gagal sementara.
- Target WhatsApp channel/group butuh format ID berbeda.
- Scraping X lewat Nitter bisa timeout.
- Admin endpoint berbahaya jika terbuka tanpa auth.

Repo ini dibuat dengan asumsi masalah-masalah itu akan muncul di production, jadi sejak awal ada database state, queue, lock scheduler, retry, dan dashboard.

## Arsitektur

```mermaid
flowchart LR
  X["Public X Accounts"] --> Scheduler["bridge-scheduler"]
  Scheduler --> Postgres[("PostgreSQL")]
  Scheduler --> Redis[("Redis / BullMQ")]
  Redis --> Worker["bridge-worker"]
  Worker --> WAHA["WAHA / WhatsApp"]
  Worker --> Telegram["Telegram Bot API"]
  API["bridge-api dashboard"] --> Postgres
  API --> Redis
```

| Service | Tugas | Perlu public domain? |
| --- | --- | --- |
| `bridge-api` | Dashboard, admin API, healthcheck | Ya |
| `bridge-scheduler` | Polling X dan enqueue post baru | Tidak |
| `bridge-worker` | Publish job ke WAHA dan Telegram | Tidak |
| `postgres` | Source, post, delivery, retry state | Tidak |
| `redis` | BullMQ queue dan scheduler lock | Tidak |

## Fitur Utama

- Multi-source polling dari satu atau banyak akun X publik.
- Provider X official API atau Nitter RSS fallback.
- PostgreSQL persistence untuk source, post, dan delivery.
- Redis + BullMQ untuk publish queue yang tahan retry.
- WhatsApp publish lewat WAHA ke group, channel, atau direct chat.
- Telegram publish lewat Telegram Bot API.
- Delivery idempotency agar target yang sudah sukses tidak dikirim ulang.
- Scheduler lock berbasis Redis agar polling tidak overlap.
- Admin dashboard untuk source, runtime, delivery, retry, dan manual sync.
- Dark CLI untuk cek status, doctor, template env, dan checklist deploy.
- Siap deploy di Railway dengan role `api`, `scheduler`, dan `worker`.

## Platform Support

Project ini bisa dipakai di desktop dan Android Termux, dengan catatan dependency production tetap butuh PostgreSQL dan Redis.

| Platform | Status | Mode yang disarankan |
| --- | --- | --- |
| Windows | Supported | Docker Compose atau Node.js + external DB/Redis |
| macOS | Supported | Docker Compose atau Node.js + external DB/Redis |
| Linux | Supported | Docker Compose atau Node.js + external DB/Redis |
| Android Termux | Supported | Node.js + external PostgreSQL/Redis |

Termux biasanya tidak cocok untuk Docker Compose biasa. Kalau menjalankan dari Android, pakai PostgreSQL dan Redis external, misalnya Railway, Neon/Supabase untuk Postgres, dan Upstash/Redis Cloud untuk Redis.

## Quick Start CLI

CLI adalah control panel terminal untuk project ini. Jalankan semua command dari folder repo `x-waha-bridge`.

Ada dua jenis command:

- Setup command: bisa dijalankan sebelum server hidup, misalnya `doctor`, `env`, dan `railway`.
- Dashboard command: butuh `bridge-api` sudah hidup, karena menu ini membaca dan mengubah data lewat API lokal.

CLI memakai tema terminal dominan hitam, biru, dan merah dengan logo X. Banner otomatis memakai mode compact di terminal sempit seperti Termux, jadi tidak mudah pecah di layar HP.

### 1. Siapkan repo dan dependency

Kalau baru pertama kali:

```bash
git clone https://github.com/mocasus/x-waha-bridge.git
cd x-waha-bridge
npm install
```

Buat file `.env` dari contoh:

```bash
cp .env.example .env
```

Di Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Isi minimal `DATABASE_URL`, `REDIS_URL`, `WAHA_BASE_URL`, `WAHA_SESSION_NAME`, `WAHA_TARGETS`, dan `APP_ADMIN_TOKEN`.

### 2. Cek kesiapan mesin

```bash
npm run doctor
```

Command ini mengecek OS, Node.js, npm, Git, Docker, dan env penting seperti `DATABASE_URL`, `REDIS_URL`, `WAHA_BASE_URL`, dan `APP_ADMIN_TOKEN`.

### 3. Lihat template env minimal kalau masih bingung

```bash
npm run cli -- env
```

Gunakan output ini sebagai referensi saat mengisi `.env`.

### 4. Jalankan service

Desktop dengan Docker:

```bash
docker compose up -d --build
```

Termux atau server tanpa Docker:

```bash
npm run build
npm start
```

Untuk Termux, gunakan PostgreSQL dan Redis remote.

### 5. Buka dashboard CLI interaktif

```bash
npm run cli
```

Dashboard CLI memiliki menu:

- Overview and health.
- X accounts / sources.
- Deliveries and retries.
- Runtime targets.
- Doctor.
- Railway guide.
- Env template.

Menu `X accounts / sources` bisa dipakai untuk list akun, tambah akun, bulk add, toggle active/paused, update repost/quote/reply, dan trigger `Sync Now`.

Menu `Deliveries and retries` bisa melihat delivery terakhir dan retry delivery `failed` atau `pending + failed`.

### Command reference

| Command | Fungsi |
| --- | --- |
| `npm run cli` | Buka dashboard CLI interaktif |
| `npm run doctor` | Cek OS, Node, Git, Docker, dan env penting |
| `npm run status` | Cek `/healthz` dan `/runtime` lokal |
| `npm run cli -- env` | Cetak template `.env` minimal |
| `npm run cli -- railway` | Tampilkan checklist deploy Railway |
| `npm run cli -- help` | Tampilkan ringkasan quick start CLI |

Kalau package sudah di-build dan dipasang sebagai binary, CLI juga tersedia sebagai:

```bash
x-waha-bridge doctor
```

## Quick Start Lokal

Gunakan langkah ini untuk menjalankan semua service lokal dengan Docker Compose.

### 1. Clone dan install

```bash
git clone https://github.com/mocasus/x-waha-bridge.git
cd x-waha-bridge
npm install
```

### 2. Buat file `.env`

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

### 3. Isi konfigurasi minimal

```env
DATABASE_URL=postgres://bridge:bridge@postgres:5432/x_waha_bridge
REDIS_URL=redis://redis:6379

APP_LOGIN_ENABLED=true
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=change_this_password
APP_ADMIN_TOKEN=change_this_long_random_token

X_PROVIDER=nitter
X_NITTER_BASE_URL=https://nitter.net
X_SOURCE_USERNAMES=xdevelopers
X_BOOTSTRAP_MODE=latest

WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
WAHA_FORWARD_TARGETS=
```

Telegram opsional:

```env
TELEGRAM_BOT_TOKEN=123456:telegram_bot_token
TELEGRAM_CHAT_IDS=@your_channel
TELEGRAM_SEND_MEDIA=true
```

### 4. Jalankan

```bash
docker compose up -d --build
```

### 5. Cek service

```bash
curl http://localhost:8080/healthz
```

Response sehat kira-kira seperti ini:

```json
{
  "ok": true,
  "role": "api"
}
```

### 6. Buka dashboard

```text
http://localhost:8080
```

Login memakai `APP_ADMIN_USERNAME` dan `APP_ADMIN_PASSWORD`, lalu klik `Sync Now` untuk memicu polling manual.

## Quick Start Termux

Gunakan mode ini kalau ingin menjalankan app dari Android. Termux hanya menjalankan Node.js app; PostgreSQL, Redis, dan WAHA sebaiknya remote.

### 1. Install package Termux

```bash
pkg update
pkg install nodejs-lts git
```

### 2. Clone dan install

```bash
git clone https://github.com/mocasus/x-waha-bridge.git
cd x-waha-bridge
npm install
```

### 3. Buat `.env`

```bash
cp .env.example .env
```

Isi `.env` dengan remote database:

```env
DATABASE_URL=postgres://user:password@host:5432/database
REDIS_URL=redis://default:password@host:6379

APP_ROLE=all
APP_PORT=8080
APP_LOGIN_ENABLED=true
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=change_this_password
APP_ADMIN_TOKEN=change_this_long_random_token

X_PROVIDER=nitter
X_SOURCE_USERNAMES=xdevelopers
X_BOOTSTRAP_MODE=latest

WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
```

### 4. Cek dan jalankan

```bash
npm run doctor
npm run build
npm start
```

Dashboard akan tersedia di:

```text
http://127.0.0.1:8080
```

## Deploy Ke Railway

Railway adalah target paling nyaman untuk project ini karena bisa menjalankan API, scheduler, worker, PostgreSQL, dan Redis dalam satu project.

### 1. Buat project

1. Buat project baru di Railway.
2. Connect repository GitHub ini.
3. Tambahkan PostgreSQL.
4. Tambahkan Redis.

### 2. Buat tiga app service

Buat tiga service dari repo yang sama:

| Railway service | Variable pembeda |
| --- | --- |
| `bridge-api` | `APP_ROLE=api` |
| `bridge-scheduler` | `APP_ROLE=scheduler` |
| `bridge-worker` | `APP_ROLE=worker` |

Hanya `bridge-api` yang perlu public domain.

### 3. Variable untuk `bridge-api`

Masukkan variable ini di Railway service `bridge-api`:

```env
APP_ROLE=api
APP_LOGIN_ENABLED=true
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=replace_with_a_strong_password
APP_ADMIN_TOKEN=replace_with_a_long_random_token

DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

X_PROVIDER=nitter
X_NITTER_BASE_URL=https://nitter.net
X_SOURCE_USERNAMES=xdevelopers
X_FETCH_INTERVAL_MS=90000
X_BOOTSTRAP_MODE=latest
X_SCHEDULER_LOCK_MS=300000

WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
WAHA_FORWARD_TARGETS=

PUBLISH_INLINE=false
PUBLISH_CONCURRENCY=1
PUBLISH_ATTEMPTS=3
PUBLISH_BACKOFF_MS=5000
```

Tambahkan ini jika ingin publish ke Telegram:

```env
TELEGRAM_BOT_TOKEN=123456:telegram_bot_token
TELEGRAM_CHAT_IDS=@your_channel
TELEGRAM_SEND_MEDIA=true
```

Railway otomatis mengisi `PORT`, jadi `APP_PORT` tidak wajib di Railway.

### 4. Variable untuk scheduler dan worker

Copy variable yang sama dari `bridge-api`, lalu ubah `APP_ROLE`.

Untuk scheduler:

```env
APP_ROLE=scheduler
```

Untuk worker:

```env
APP_ROLE=worker
```

`bridge-scheduler` dan `bridge-worker` tidak perlu public domain.

### 5. Healthcheck

Untuk `bridge-api`, set healthcheck path:

```text
/healthz
```

### 6. Urutan deploy

1. Deploy PostgreSQL dan Redis.
2. Deploy `bridge-api`.
3. Deploy `bridge-scheduler`.
4. Deploy `bridge-worker`.
5. Buka domain public `bridge-api`.
6. Cek `/healthz`.
7. Login dashboard.
8. Tambah atau cek source X.
9. Klik `Sync Now`.

## Setup WAHA

WAHA adalah service yang menghubungkan aplikasi ini ke WhatsApp. Untuk production, lebih aman memakai WAHA remote yang sudah stabil.

```env
WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
WAHA_FORWARD_TARGETS=120363xxxxxxxxxx@newsletter
```

Target yang didukung:

| Target | Contoh |
| --- | --- |
| WhatsApp group | `120363xxxxxxxxxx@g.us` |
| WhatsApp channel/newsletter | `120363xxxxxxxxxx@newsletter` |
| Direct chat | `628xxxxxxxxxx@c.us` |
| Nomor polos | `628xxxxxxxxxx` |

Catatan untuk WhatsApp Channel: akun WhatsApp yang login di WAHA harus menjadi admin atau owner channel.

## Setup Telegram

1. Buka Telegram.
2. Chat `@BotFather`.
3. Jalankan `/newbot`.
4. Copy token ke `TELEGRAM_BOT_TOKEN`.
5. Tambahkan bot ke group atau channel.
6. Jika targetnya channel, jadikan bot sebagai admin.
7. Isi `TELEGRAM_CHAT_IDS`.

Contoh:

```env
TELEGRAM_CHAT_IDS=@public_channel
```

Private group atau channel biasanya memakai ID numeric:

```env
TELEGRAM_CHAT_IDS=-1001234567890
```

Banyak target:

```env
TELEGRAM_CHAT_IDS=@public_channel,-1001234567890
```

## Mengelola Source X

Lewat dashboard:

1. Buka `/`.
2. Tambahkan username tanpa `@`.
3. Pilih apakah repost, quote, atau reply ikut dipublish.
4. Klik `Sync Now`.

Lewat API:

```bash
curl -X POST https://your-railway-domain.up.railway.app/sources \
  -H "Authorization: Bearer $APP_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"xdevelopers","includeReposts":false,"includeQuotes":true}'
```

Tambah banyak source:

```bash
curl -X POST https://your-railway-domain.up.railway.app/sources/bulk \
  -H "Authorization: Bearer $APP_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"usernames":["xdevelopers","vercel","github"]}'
```

## Endpoint Penting

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/` | Dashboard admin |
| `GET` | `/healthz` | Healthcheck publik |
| `GET` | `/runtime` | Ringkasan konfigurasi runtime |
| `GET` | `/sources` | Daftar source X |
| `POST` | `/sources` | Tambah satu source |
| `POST` | `/sources/bulk` | Tambah banyak source |
| `PATCH` | `/sources/:id` | Update source |
| `DELETE` | `/sources/:id` | Nonaktifkan source |
| `GET` | `/posts?limit=20&page=1` | Daftar post tersimpan |
| `GET` | `/deliveries?limit=50&page=1` | Daftar delivery |
| `POST` | `/sync-now` | Trigger polling manual |
| `POST` | `/deliveries/retry` | Retry delivery pending atau failed |
| `GET` | `/waha/status` | Cek status session WAHA |

Endpoint admin bisa diakses lewat login browser atau header:

```http
Authorization: Bearer <APP_ADMIN_TOKEN>
```

## Development

Jalankan hanya PostgreSQL dan Redis di Docker, lalu app di host:

```bash
npm run dev:infra
npm run dev
```

Untuk mode ini, pakai URL lokal:

```env
DATABASE_URL=postgres://bridge:bridge@localhost:5432/x_waha_bridge
REDIS_URL=redis://localhost:6379
```

Stop infra:

```bash
npm run dev:infra:stop
```

## WAHA Lokal Opsional

WAHA lokal tidak start secara default. Kalau ingin menjalankan WAHA lokal:

```bash
docker compose --profile local-waha up -d --build
```

Lalu set:

```env
WAHA_BASE_URL=http://waha:3000
```

## Testing

```bash
npm run typecheck
npm test
```

## Catatan Production

- Jangan commit `.env`.
- Rotate secret yang pernah dipaste di chat, log, screenshot, atau issue.
- Gunakan password admin dan token admin yang panjang.
- Aktifkan `APP_LOGIN_ENABLED=true` jika dashboard punya public domain.
- `X_PROVIDER=nitter` cocok untuk MVP, tetapi bergantung pada availability public Nitter.
- Untuk production jangka panjang, pertimbangkan `X_PROVIDER=official` dengan token API resmi X.
- Gunakan `X_BOOTSTRAP_MODE=latest` agar source baru tidak mem-publish semua history lama.
- Di Railway, gunakan `PUBLISH_INLINE=false` karena worker berjalan persistent.


## Contributing

Kontribusi sangat diterima, baik bug report, feature request, dokumentasi, maupun
kode. Sebelum membuat pull request, jalankan `npm run typecheck` dan `npm test`.
Detail lengkap ada di [CONTRIBUTING.md](CONTRIBUTING.md).

Untuk laporan keamanan, jangan buka issue publik. Ikuti panduan di
[SECURITY.md](SECURITY.md).

## License

Project ini dirilis sebagai open source di bawah lisensi [MIT](LICENSE).
Copyright (c) 2026 mocasus.
