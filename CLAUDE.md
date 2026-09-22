# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Workbench is a human-supervised AI software team: the user submits a product idea, and role-based agents (PM → Designer → Engineer) turn it into persistent, structured artifacts (requirements, design specs, tasks, eventually code/PRs), with human approval gates on consequential steps. V1 is single-user. The project is primarily a learning and portfolio vehicle for production-style AI systems, so architectural choices should be deliberate, explainable, and recorded as ADRs in `docs/architecture/decisions/`.

Core design (ADR-0001, data model in `docs/system-design/data-model.md`): agents communicate only via typed, versioned **artifacts**; a deterministic **workflow** decides which agent runs next; **approval decisions** gate progression. Prefer adding infrastructure (queues, workers, distributed pieces) only when a concrete problem demands it, and document why.

It is in early development: currently a Next.js app plus the `@repo/db` persistence layer, planned to grow (per `docs/roadmap/README.md`) through frontend platform → full-stack → distributed system → AI application → multi-agent system → production AI platform. Many directories (`infrastructure/`, `labs/`, `scripts/`, `docs/*`, `tests/*` subfolders, `apps/web/{components,features,hooks,lib,types}`) are placeholder scaffolding containing only `.gitkeep`.

Requires Node.js 24+ and npm 11.x (enforced via `engines` / `devEngines` in the root `package.json`).

## Commands

Run from the repo root:

```sh
npm install
npm run dev            # turbo run dev → Next.js on http://localhost:3000 + the agent worker
npm run worker         # the agent worker alone (processes queued agent runs)
npm run build          # turbo run build
npm run lint           # turbo run lint (ESLint, --max-warnings 0)
npm run check-types    # turbo run check-types (web: next typegen && tsc --noEmit)
npm run format         # prettier --write on **/*.{ts,tsx,md}
npm run format:check
npm test               # vitest in watch mode
npm run test:run       # vitest single run
```

Database (Postgres 18 in Docker; copy `.env.example` to `.env` first):

```sh
npm run db:up          # start Postgres (waits until healthy)
npm run db:migrate     # apply migrations in packages/db/migrations
npm run db:generate    # generate a migration after editing packages/db/src/schema.ts
npm run db:studio      # Drizzle Studio
npm run db:down        # stop (add `-- -v` to also wipe data)
```

Run the PM agent for real from the CLI (needs `ANTHROPIC_API_KEY` in `.env` and a migrated DB; `AGENT_MODEL` overrides the default `claude-opus-5`):

```sh
npm run agent:pm -- "A meal planner for busy families"
```

To name a migration, run drizzle-kit directly: `cd packages/db && npx drizzle-kit generate --name <name>`.

Single test file / single test:

```sh
npx vitest run tests/hello.test.ts
npx vitest run -t "runs Vitest successfully"
```

Scope a turbo task to one workspace: `npx turbo run lint --filter=web`.

CI (`.github/workflows/ci.yml`) runs, in order: `format:check`, `lint`, `check-types`, `db:migrate` (against a Postgres service container), `test:run`, `build`. Run the same sequence locally before considering a change done.

## Architecture

npm-workspaces + Turborepo monorepo (`apps/*`, `packages/*`):

- `apps/web` — Next.js 16 App Router app (React 19). Pages (`app/page.tsx` project list + new idea, `app/projects/[id]/page.tsx` workflow/review/version history/run log) are `force-dynamic` server components that call `@repo/workflow` directly; client components in `features/projects/` mutate via the API routes (`lib/api.ts` `postJson`) and then `router.refresh()`. Styling is plain CSS in `app/globals.css` (CSS variables, light/dark). JSON API route handlers under `app/api/` are thin: they validate input with Zod and call `@repo/workflow`, with `lib/server.ts` providing the shared DB pool, model provider, and `handle()` (maps `WorkflowError` codes to 400/404/409/501). `next.config.js` loads the **repo-root** `.env` and lists workspace packages in `transpilePackages` — add new `@repo/*` packages there. Imports use the `@/` alias for `apps/web/`.
  - `POST /api/projects` `{ idea, name? }` · `GET /api/projects/:id` (project, workflow state, versions with decisions, runs) · `POST /api/projects/:id/run` (queues the next step's agent and returns immediately; the UI polls) · `POST /api/versions/:id/decision` `{ decision: "approved" | "rejected", feedback? }`
- `packages/ui` (`@repo/ui`) — shared React components. Exports source directly with no build step: `import X from "@repo/ui/<name>"` resolves to `packages/ui/src/<name>.tsx`. Currently empty.
- `packages/artifacts` (`@repo/artifacts`) — Zod schemas for artifact content (`requirements`, `design_spec`) and `artifactRegistry`, the single source of truth for artifact types (`@repo/db` imports `artifactTypes` from here). The same schemas serve LLM structured output (`artifactJsonSchema`), validation (`parseArtifactContent`), and TS types, so keep constraints JSON-Schema friendly and put guidance for the model in `.describe()`. Bump an entry's `schemaVersion` on incompatible changes.
- `apps/worker` — the background worker (ADR-0005): polls the `agents` queue and executes agent runs via `agentJobHandlers` from `@repo/workflow`. Logs JSON lines; SIGINT/SIGTERM finish the current job then exit. Without a running worker, queued runs stay queued.
- `packages/queue` (`@repo/queue`) — generic Postgres job queue: `enqueue` (accepts a transaction), `claimJob` (`FOR UPDATE SKIP LOCKED`, lease via `locked_until`, reclaims expired leases), `heartbeat`/`completeJob`/`failJob` (all fenced on lease ownership), and `processNextJob`/`runWorker` with retry + exponential backoff driven by each `JobHandler`'s `isRetryable`/`onRetry`/`onFailed`. Use DB `now()` for all times.
- `packages/workflow` (`@repo/workflow`) — the ADR-0001 workflow. `state.ts` is pure: `workflowSteps` (the PM → Designer `sequence`, with each step's required artifacts taken from its agent's `inputs`) and `computeWorkflowState(snapshot)`, which derives each step's state and the single next action (run / review / wait / complete). `service.ts` is the DB-backed API the routes use: `createProject`, `getProjectDetail`, `decideVersion` (rejection requires feedback; approval supersedes older approved versions), and `enqueueNextStep` (creates a queued run + job in one transaction; a rejected latest version triggers a revision run with its feedback; a duplicate concurrent request hits the `agent_run_one_active_per_role` partial unique index and becomes a 409), plus `agentJobHandlers` for the worker (retries transient/bad-output errors via `isRetryableModelError`).
- `packages/agents` (`@repo/agents`) — agent logic (ADR-0003). `ModelProvider` is the only model interface agents use; `AnthropicProvider` implements it with structured outputs, adaptive thinking, and `fallbacks: "default"`. Each role is an `AgentDefinition` (`pm-agent.ts`, `designer-agent.ts`, registered in `registry.ts`): what it produces, which approved artifacts it takes as `inputs`, its system prompt, `buildPrompt` (including revisions with feedback), and an optional `check` for problems the schema can't catch (the designer rejects references to unknown user stories). `run.ts` is shared by all roles: `createAgentRun` (queued) → `executeAgentRun(runId)` loads the latest approved inputs, calls the agent, runs `check`, and stores a new `pending_approval` version whose lineage links its inputs and the version it revises; it is idempotent (a succeeded run is returned without calling the model) and on failure records the error and rethrows, leaving retry (`requeueAgentRun`) vs. give-up (`failAgentRun`) to the caller. `runAgent` does create + execute in-process (scripts, tests). Every model request is traced as a `model_call` row (prompts, output, error, request id, tokens, latency; ADR-0004), including failed ones. To add a role: add it to `agentRoles` in the DB schema, add its artifact to `@repo/artifacts`, write an `AgentDefinition`, register it, and add it to `sequence` in `@repo/workflow`.
- `packages/db` (`@repo/db`) — Drizzle schema, `createDb(url)` client, and committed SQL migrations (ADR-0002). Like `@repo/ui`, it exports TypeScript source (no build step). Enum-like columns are `text` with TS enums, not Postgres enums. Postgres truncates identifiers at 63 chars, so give long constraint names explicitly (see `artifactVersionInput`).
- `packages/eslint-config` (`@repo/eslint-config`) — flat configs exported as `./base`, `./next-js`, `./react-internal`.
- `packages/typescript-config` (`@repo/typescript-config`) — `base.json`, `nextjs.json`, `react-library.json`. Base is `strict` with `noUncheckedIndexedAccess`.

Tooling notes:

- Vitest runs from the **root** (`vitest.config.ts`, which loads `.env`), not via turbo; tests live in the top-level `tests/` directory, not inside workspaces. `tests/fixtures/` holds sample artifacts and `FakeProvider` (canned model output, no API calls). `tests/integration/` needs Postgres running and is skipped when `DATABASE_URL` is unset. Tests never use the dev database: `vitest.config.ts` points `DATABASE_URL` at `TEST_DATABASE_URL` or `<DATABASE_URL>_test`, and `tests/setup/test-database.ts` (global setup) creates and migrates it.
- The root package is ESM (`"type": "module"`); `scripts/*.ts` run via `tsx`.
- ESLint uses `eslint-plugin-only-warn`, turning every error into a warning — but lint scripts use `--max-warnings 0`, so any warning fails lint/CI.
- `turbo/no-undeclared-env-vars` is enabled: env vars used in code must be declared in `turbo.json`.
- Turbo `build` hashes `.env*` files as inputs and caches `.next/**` outputs.
- TypeScript 7 does not auto-include `@types/*`; a package that needs Node globals must set `"types": ["node"]` in its tsconfig.
