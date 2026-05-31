# Contributing to X WAHA Bridge

Thanks for your interest in contributing! This project mirrors public X posts to
WhatsApp (via WAHA) and Telegram (via Bot API). Contributions of all kinds are
welcome: bug reports, feature requests, documentation, and code.

## Code of Conduct

Be respectful and constructive. Harassment, discrimination, or abusive behavior
will not be tolerated. By participating you agree to keep interactions
professional and welcoming.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment template and fill in the required values:
   ```bash
   cp .env.example .env
   ```
4. Start local infrastructure (PostgreSQL + Redis) and the app:
   ```bash
   npm run dev:infra
   npm run dev
   ```

## Development Workflow

- Create a feature branch from `main` (for example `fix/config-boolean-parsing`).
- Keep changes focused; one logical change per pull request.
- Before opening a PR, make sure the project builds and passes checks:
  ```bash
  npm run typecheck
  npm test
  ```
- Update documentation (`README.md`, `.env.example`) when behavior or
  configuration changes.

## Pull Requests

- Describe **what** changed and **why**.
- Reference any related issues.
- Note how you tested the change and call out any known limitations.
- Do not commit secrets. Never include real tokens, passwords, or `.env` files.

## Reporting Bugs

Open an issue with:

- A clear description of the problem and expected behavior.
- Steps to reproduce.
- Relevant logs (with secrets redacted), environment, and version info.

## Security Issues

Please do not open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report them responsibly.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers this project.
