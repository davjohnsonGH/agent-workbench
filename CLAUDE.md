# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Workbench is a human-supervised AI software team: the user submits a product idea, and role-based agents (PM → Designer → Engineer) turn it into persistent, structured artifacts (requirements, design specs, tasks, eventually code/PRs), with human approval gates on consequential steps. V1 is single-user. The project is primarily a learning and portfolio vehicle for production-style AI systems, so architectural choices should be deliberate, explainable, and recorded as ADRs in `docs/architecture/decisions/`.

Core design (ADR-0001, data model in `docs/system-design/data-model.md`): agents communicate only via typed, versioned **artifacts**; a deterministic **workflow** decides which agent runs next; **approval decisions** gate progression. Prefer adding infrastructure (queues, workers, distributed pieces) only when a concrete problem demands it, and document why.

It is in early development: currently a frontend-only Next.js app, planned to grow (per `docs/roadmap/README.md`) through frontend platform → full-stack → distributed system → AI application → multi-agent system → production AI platform. Many directories (`infrastructure/`, `labs/`, `scripts/`, `docs/*`, `tests/*` subfolders, `apps/web/{components,features,hooks,lib,types}`) are placeholder scaffolding containing only `.gitkeep`.

Requires Node.js 24+ and npm 11.x (enforced via `engines` / `devEngines` in the root `package.json`).

## Commands

Run from the repo root:

```sh
npm install
npm run dev            # turbo run dev → Next.js on http://localhost:3000
npm run build          # turbo run build
npm run lint           # turbo run lint (ESLint, --max-warnings 0)
npm run check-types    # turbo run check-types (web: next typegen && tsc --noEmit)
npm run format         # prettier --write on **/*.{ts,tsx,md}
npm run format:check
npm test               # vitest in watch mode
npm run test:run       # vitest single run
```

Single test file / single test:

```sh
npx vitest run tests/hello.test.ts
npx vitest run -t "runs Vitest successfully"
```

Scope a turbo task to one workspace: `npx turbo run lint --filter=web`.

CI (`.github/workflows/ci.yml`) runs, in order: `format:check`, `lint`, `check-types`, `test:run`, `build`. Run the same sequence locally before considering a change done.

## Architecture

npm-workspaces + Turborepo monorepo (`apps/*`, `packages/*`):

- `apps/web` — Next.js 16 App Router app (React 19), the only application today. Code lives in `app/`.
- `packages/ui` (`@repo/ui`) — shared React components. Exports source directly with no build step: `import X from "@repo/ui/<name>"` resolves to `packages/ui/src/<name>.tsx`. Currently empty.
- `packages/eslint-config` (`@repo/eslint-config`) — flat configs exported as `./base`, `./next-js`, `./react-internal`.
- `packages/typescript-config` (`@repo/typescript-config`) — `base.json`, `nextjs.json`, `react-library.json`. Base is `strict` with `noUncheckedIndexedAccess`.

Tooling notes:

- Vitest runs from the **root** (no config file), not via turbo; tests live in the top-level `tests/` directory, not inside workspaces.
- ESLint uses `eslint-plugin-only-warn`, turning every error into a warning — but lint scripts use `--max-warnings 0`, so any warning fails lint/CI.
- `turbo/no-undeclared-env-vars` is enabled: env vars used in code must be declared in `turbo.json`.
- Turbo `build` hashes `.env*` files as inputs and caches `.next/**` outputs.
