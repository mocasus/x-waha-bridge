# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in X WAHA Bridge, please report it
privately rather than opening a public issue.

- Use GitHub's **Private vulnerability reporting** (Security tab → "Report a
  vulnerability") on this repository, or
- Contact the maintainer directly through the contact listed on the GitHub
  profile [@mocasus](https://github.com/mocasus).

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof of concept.
- Any suggested remediation, if known.

We aim to acknowledge reports within a few days and will keep you informed of
progress toward a fix. Please give us reasonable time to address the issue
before any public disclosure.

## Handling Secrets

This project relies on sensitive credentials such as `APP_ADMIN_TOKEN`,
`WAHA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, and `REDIS_URL`.

- Never commit `.env` files or secrets to the repository.
- Rotate any secret that has been exposed in chat, logs, screenshots, or issues.
- Use long, random values for `APP_ADMIN_TOKEN` and `APP_ADMIN_PASSWORD`.
- Enable `APP_LOGIN_ENABLED=true` whenever the dashboard is reachable on a public
  domain, and serve it over HTTPS.

## Supported Versions

This project is maintained on a best-effort basis. Security fixes are applied to
the latest `main` branch.
