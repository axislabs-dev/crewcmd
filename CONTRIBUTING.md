# Contributing to CrewCmd

Thanks for your interest in contributing to CrewCmd. This guide covers the process for humans and AI agents alike.

## Getting Started

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev
```

No database setup required. CrewCmd uses embedded PGlite for local development.

## Development Workflow

1. **Fork the repo** and create a feature branch from `main`
2. **Make your changes** with atomic commits (one logical change per commit)
3. **Run `pnpm build`** to verify the project compiles
4. **Run `pnpm typecheck`** to verify TypeScript types
5. **Open a pull request** against `main`
6. **Wait for CI** — PRs must pass the `check` job (typecheck + build) and get one approving review before merge

### Pre-commit Hooks

Hooks install automatically when you run `pnpm install` (via Husky). No manual setup.

- **Pre-commit:** Runs `tsc --noEmit` on staged `.ts/.tsx` files. Type errors block the commit.
- **Pre-push:** Runs full typecheck + `pnpm build`. Build failures block the push.

If you need to bypass hooks in an emergency: `git commit --no-verify` (but CI will still catch issues).

### Branch Protection

`main` is protected:
- CI must pass (typecheck + build)
- 1 approving review required
- Linear history enforced (squash or rebase, no merge commits)
- No force pushes

## Code Style

- TypeScript strict mode
- Functional components only
- Server components by default; use `"use client"` only when needed
- No `any` types unless absolutely unavoidable (with a comment explaining why)
- Tables: `snake_case` plural (e.g., `cost_events`)
- API routes: `/api/[resource]` RESTful
- Components: PascalCase files in `/src/components/`
- Pages: kebab-case directories in `/src/app/`

## Commit Messages

Use conventional commit format:

```
feat: add agent budget alerts
fix: resolve PGlite schema init race condition
refactor: consolidate org chart and team pages
docs: update README quick start section
chore: update dependencies
```

## Pull Requests

- Keep PRs focused. One feature or fix per PR.
- Include a clear description of what changed and why.
- If your PR adds a new feature, update CLAUDE.md and README.md as needed.
- If your PR changes the database schema, include a migration (`pnpm db:generate`).
- Screenshots or screen recordings for UI changes are appreciated.

## Database Changes

- Schema lives in `src/db/schema.ts`
- After changing the schema, run `pnpm db:generate` to create a migration
- Test with both PGlite (default) and external Postgres if possible
- Never remove or rename columns without a migration plan

## API Changes

- All GET endpoints are public (no auth required)
- Mutations (POST/PATCH/DELETE) require `Authorization: Bearer <HEARTBEAT_SECRET>` or a valid NextAuth session
- Don't break existing API contracts. Existing consumers (crons, agent integrations) depend on them.

## Testing

Currently there's no test suite. If you add tests, use Vitest. Contributions that add test coverage are very welcome.

## Reporting Issues

- Use [GitHub Issues](https://github.com/axislabs-dev/crewcmd/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- For bugs, include your Node.js version, OS, and whether you're using PGlite or external Postgres

## Security

See [SECURITY.md](./SECURITY.md) for reporting security vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the project's [BSL 1.1 license](./LICENSE).
