import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/**
 * A small eval runner. Output layout (per `.claude/hillclimb` convention):
 *
 *   <flowDir>/_state.json                  metrics + approved harness sha
 *   <flowDir>/<variant>/results.jsonl      one row per scored (case, rep)
 *   <flowDir>/<variant>/errors.jsonl       attempts that produced no scorable output
 *   <flowDir>/<variant>/traces/<id>_rep<k>.json
 *
 * Rows are appended as cases finish, and a rerun skips (case, rep) pairs
 * already in results.jsonl, so a crashed run resumes where it stopped.
 */

export interface TraceTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/** A scorable outcome. `truncated` and `refused` are recorded but left out of means. */
export interface CaseResult {
  status: "ok" | "truncated" | "refused";
  stop_reason: "end_turn" | "max_tokens" | "refusal";
  grade: Record<string, number>;
  explanation?: Record<string, string>;
  model: string;
  usage: Usage;
  judge_model?: string;
  judge_usage?: Usage;
  latency_s: number;
  meta?: Record<string, unknown>;
  trace: TraceTurn[];
}

/** An attempt that produced no scorable output; goes to errors.jsonl, never results. */
export class EvalError extends Error {
  constructor(
    readonly failureClass:
      | "api_error"
      | "timeout"
      | "served_model_mismatch"
      | "invalid_output"
      | "grader_error",
    message: string,
    readonly details: { model?: string; usage?: Usage } = {},
  ) {
    super(message);
    this.name = "EvalError";
  }
}

export interface EvalCase {
  id: string;
  prompt: string;
  tags: string[];
}

export interface RunEvalOptions<C extends EvalCase> {
  flowDir: string;
  variant: string;
  cases: C[];
  reps: number;
  concurrency: number;
  /** Hard wall-clock ceiling per attempt. */
  timeoutMs: number;
  maxAttempts?: number;
  /** Transient infrastructure errors worth retrying (with jittered backoff). */
  isRetryable(error: unknown): boolean;
  runCase(testCase: C, rep: number): Promise<CaseResult>;
  onProgress?(message: string): void;
}

export interface RunEvalSummary {
  scored: number;
  skipped: number;
  errors: number;
}

export async function runEval<C extends EvalCase>(
  options: RunEvalOptions<C>,
): Promise<RunEvalSummary> {
  if (!/^(baseline|v\d+)$/.test(options.variant)) {
    throw new Error(
      `Variant must be "baseline" or "v<N>", got "${options.variant}"`,
    );
  }
  const variantDir = join(options.flowDir, options.variant);
  const resultsPath = join(variantDir, "results.jsonl");
  const errorsPath = join(variantDir, "errors.jsonl");
  await mkdir(join(variantDir, "traces"), { recursive: true });

  const done = new Set(
    (await readJsonl(resultsPath)).map((r) => `${r.prompt_id}#${r.rep}`),
  );
  const work = options.cases.flatMap((c) =>
    Array.from({ length: options.reps }, (_, rep) => ({ c, rep })),
  );
  const todo = work.filter(({ c, rep }) => !done.has(`${c.id}#${rep}`));
  const summary = { scored: 0, skipped: work.length - todo.length, errors: 0 };
  const maxAttempts = options.maxAttempts ?? 3;

  await pool(todo, options.concurrency, async ({ c, rep }) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await withTimeout(
          options.runCase(c, rep),
          options.timeoutMs,
        );
        const { trace, ...rest } = result;
        const tracePath = join(variantDir, "traces", `${c.id}_rep${rep}.json`);
        await writeFile(tracePath, JSON.stringify(trace, null, 2));
        await appendFile(
          resultsPath,
          JSON.stringify({
            prompt_id: c.id,
            prompt: c.prompt,
            tags: c.tags,
            rep,
            attempts: attempt,
            ...rest,
          }) + "\n",
        );
        summary.scored += 1;
        options.onProgress?.(`${c.id} rep ${rep}: ${result.status}`);
        return;
      } catch (error) {
        const retry = attempt < maxAttempts && options.isRetryable(error);
        const evalError = toEvalError(error);
        await appendFile(
          errorsPath,
          JSON.stringify({
            prompt_id: c.id,
            rep,
            attempt,
            failure_class: evalError.failureClass,
            message: evalError.message,
            will_retry: retry,
            ...evalError.details,
            time: new Date().toISOString(),
          }) + "\n",
        );
        if (!retry) {
          summary.errors += 1;
          options.onProgress?.(
            `${c.id} rep ${rep}: ${evalError.failureClass} (${evalError.message})`,
          );
          return;
        }
        await sleep(backoffMs(attempt));
      }
    }
  });

  return summary;
}

function toEvalError(error: unknown): EvalError {
  if (error instanceof EvalError) return error;
  return new EvalError(
    "api_error",
    error instanceof Error ? error.message : String(error),
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EvalError("timeout", `No result within ${ms / 1000}s`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) await fn(items[next++]!);
    },
  );
  await Promise.all(workers);
}

function backoffMs(attempt: number): number {
  const ceiling = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
  return Math.round(ceiling * (0.5 + Math.random() / 2));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readJsonl(
  path: string,
): Promise<Record<string, unknown>[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Harness integrity: the eval code must be approved before it runs, and
// re-approved after any change, so a changed grader cannot silently shift
// scores between variants.
// ---------------------------------------------------------------------------

export class HarnessNotApprovedError extends Error {}

interface FlowState {
  metrics?: unknown;
  harness_paths?: string[];
  harness_sha?: string;
  [key: string]: unknown;
}

export async function harnessSha(
  root: string,
  paths: string[],
): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    const content = await readFile(join(root, path));
    hash.update(
      `${path}\0${createHash("sha256").update(content).digest("hex")}\n`,
    );
  }
  return hash.digest("hex");
}

/**
 * Verify the harness matches the approved sha in `_state.json`. With
 * `approve`, record the current sha (and the given state fields) instead.
 */
export async function checkHarness(options: {
  flowDir: string;
  root: string;
  paths: string[];
  approve: boolean;
  state: Omit<FlowState, "harness_paths" | "harness_sha">;
}): Promise<void> {
  const statePath = join(options.flowDir, "_state.json");
  const current = await harnessSha(options.root, options.paths);
  let state: FlowState = {};
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as FlowState;
  } catch {
    // First run.
  }

  if (options.approve) {
    await mkdir(dirname(statePath), { recursive: true });
    const next: FlowState = {
      ...state,
      ...options.state,
      harness_paths: options.paths,
      harness_sha: current,
    };
    await writeFile(statePath, JSON.stringify(next, null, 2) + "\n");
    return;
  }
  if (state.harness_sha !== current) {
    throw new HarnessNotApprovedError(
      state.harness_sha
        ? `The eval harness changed since it was approved (${relative(options.root, statePath)}). Review the change, then rerun with --approve-harness.`
        : "The eval harness has not been approved yet. Review it, then run with --approve-harness.",
    );
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface MetricSummary {
  id: string;
  label: string;
  n: number;
  mean: number;
  /** 95% Wilson interval for a pass rate. */
  low: number;
  high: number;
}

export async function summarize(
  variantDir: string,
  metricList: readonly { id: string; label: string }[],
): Promise<{
  metrics: MetricSummary[];
  rows: number;
  byStatus: Record<string, number>;
  errors: number;
  usage: { model: Usage; judge: Usage; models: Set<string> };
}> {
  const rows = await readJsonl(join(variantDir, "results.jsonl"));
  const errorRows = await readJsonl(join(variantDir, "errors.jsonl"));
  const ok = rows.filter((r) => r.status === "ok");
  const byStatus: Record<string, number> = {};
  const usage = {
    model: { input_tokens: 0, output_tokens: 0 },
    judge: { input_tokens: 0, output_tokens: 0 },
    models: new Set<string>(),
  };
  for (const row of rows) {
    byStatus[row.status as string] = (byStatus[row.status as string] ?? 0) + 1;
    addUsage(usage.model, row.usage as Usage | undefined);
    addUsage(usage.judge, row.judge_usage as Usage | undefined);
    usage.models.add(row.model as string);
  }
  // Failed attempts still cost money when the call completed.
  for (const row of errorRows)
    addUsage(usage.model, row.usage as Usage | undefined);

  const metrics = metricList.map(({ id, label }) => {
    const values = ok
      .map((r) => (r.grade as Record<string, number>)[id])
      .filter((v): v is number => typeof v === "number");
    const n = values.length;
    const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
    return { id, label, n, mean, ...wilson(mean, n) };
  });

  const finalErrors = new Set(
    errorRows
      .filter((r) => r.will_retry === false)
      .map((r) => `${r.prompt_id}#${r.rep}`),
  );
  for (const row of rows) finalErrors.delete(`${row.prompt_id}#${row.rep}`);

  return {
    metrics,
    rows: rows.length,
    byStatus,
    errors: finalErrors.size,
    usage,
  };
}

function addUsage(total: Usage, usage: Usage | undefined) {
  if (!usage) return;
  total.input_tokens += usage.input_tokens;
  total.output_tokens += usage.output_tokens;
}

function wilson(p: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}
