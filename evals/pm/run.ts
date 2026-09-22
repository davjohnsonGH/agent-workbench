/**
 * PM requirements eval. Makes paid API calls: the PM agent on each case, plus
 * three judge calls per case.
 *
 *   npm run eval:pm -- --approve-harness        # once, after reviewing the eval code
 *   npm run eval:pm -- --only todo-app          # pilot on one case
 *   npm run eval:pm -- --reps 2                 # full run
 *   npm run eval:pm -- --variant v1 --model claude-sonnet-5
 *
 * Output goes to .claude/hillclimb/pm-requirements/<variant>/. See
 * evals/README.md.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicProvider,
  DEFAULT_MODEL,
  isRetryableModelError,
  ModelOutputError,
} from "@repo/agents";

import {
  checkHarness,
  HarnessNotApprovedError,
  runEval,
  summarize,
} from "../lib/runner";
import { pmCases } from "./cases";
import { createPmCaseRunner, toEvalCases } from "./eval";
import { metrics } from "./graders";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const flowDir = join(root, ".claude/hillclimb/pm-requirements");
/** The eval's own code. The PM prompt is what variants change, so it is not part of the harness. */
const harnessPaths = [
  "evals/lib/runner.ts",
  "evals/pm/cases.ts",
  "evals/pm/eval.ts",
  "evals/pm/graders.ts",
  "evals/pm/run.ts",
];

/** First-party $/MTok (input, output), for the cost printout only. */
const prices: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

const { values: args } = parseArgs({
  options: {
    variant: { type: "string", default: "baseline" },
    model: { type: "string", default: DEFAULT_MODEL },
    "judge-model": { type: "string", default: "claude-sonnet-5" },
    reps: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    "timeout-s": { type: "string", default: "300" },
    only: { type: "string" },
    "approve-harness": { type: "boolean", default: false },
  },
});

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  // Variables come from the environment.
}

try {
  await checkHarness({
    flowDir,
    root,
    paths: harnessPaths,
    approve: args["approve-harness"],
    state: {
      metrics: metrics.map(({ id, label, kind }) => ({ id, label, kind })),
      perf_fields: ["latency_s", "usage"],
    },
  });
} catch (error) {
  if (error instanceof HarnessNotApprovedError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}
if (args["approve-harness"]) {
  console.log("Harness approved.");
  process.exit(0);
}

if (args["judge-model"] === args.model) {
  console.error("Use a different judge model from the model under test.");
  process.exit(1);
}

// Retries are the runner's job (so they are counted), not the SDK's.
const client = new Anthropic({
  maxRetries: 0,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});
const provider = new AnthropicProvider({ client, model: args.model });
const judgeProvider = new AnthropicProvider({
  client,
  model: args["judge-model"],
});

const only = args.only?.split(",");
const cases = toEvalCases(
  only ? pmCases.filter((c) => only.includes(c.id)) : pmCases,
);
const reps = Number(args.reps);
console.log(
  `PM eval: ${cases.length} cases × ${reps} reps on ${args.model} (judge ${args["judge-model"]}) → ${args.variant}`,
);

const startedAt = Date.now();
const run = await runEval({
  flowDir,
  variant: args.variant,
  cases,
  reps,
  concurrency: Number(args.concurrency),
  timeoutMs: Number(args["timeout-s"]) * 1000,
  // Transient API failures only; bad output is a model result, not retried.
  isRetryable: (error) =>
    !(error instanceof ModelOutputError) && isRetryableModelError(error),
  runCase: createPmCaseRunner({ provider, judgeProvider }),
  onProgress: (message) => console.log(`  ${message}`),
});

const summary = await summarize(join(flowDir, args.variant), metrics);
console.log(
  `\n${run.scored} scored, ${run.skipped} already done, ${summary.errors} errors · ` +
    `statuses ${JSON.stringify(summary.byStatus)} · ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
);
for (const m of summary.metrics) {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  console.log(
    `  ${m.label.padEnd(16)} ${pct(m.mean).padStart(4)}  (95% CI ${pct(m.low)}–${pct(m.high)}, n=${m.n})`,
  );
}
const cost = (
  usage: { input_tokens: number; output_tokens: number },
  model: string,
) => {
  const [inPrice, outPrice] = prices[model] ?? [0, 0];
  return (usage.input_tokens * inPrice + usage.output_tokens * outPrice) / 1e6;
};
console.log(
  `  cost ≈ $${(cost(summary.usage.model, args.model) + cost(summary.usage.judge, args["judge-model"])).toFixed(2)} ` +
    `(model ${summary.usage.model.input_tokens}/${summary.usage.model.output_tokens} tok, ` +
    `judge ${summary.usage.judge.input_tokens}/${summary.usage.judge.output_tokens} tok)`,
);
