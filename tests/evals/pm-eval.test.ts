import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ModelProvider,
  ModelRefusalError,
  type StructuredRequest,
} from "@repo/agents";
import type { Requirements } from "@repo/artifacts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  checkHarness,
  HarnessNotApprovedError,
  readJsonl,
  runEval,
  summarize,
} from "../../evals/lib/runner";
import type { PmCase } from "../../evals/pm/cases";
import { createPmCaseRunner, toEvalCases } from "../../evals/pm/eval";
import {
  codeGrades,
  judge,
  metrics,
  unsourcedNumbers,
} from "../../evals/pm/graders";
import { sampleRequirements } from "../fixtures/artifacts";
import { FakeProvider } from "../fixtures/fake-provider";

const mealCase: PmCase = {
  id: "meal-planner",
  idea: "A meal planner that picks dinners for 7 days and builds a shopping list",
  tags: ["specific"],
  expected: { maxStories: 4, minOpenQuestions: 1 },
};

/** A document with the failure modes the eval targets. */
const badRequirements: Requirements = {
  ...sampleRequirements,
  userStories: Array.from({ length: 12 }, (_, i) => ({
    ...sampleRequirements.userStories[0]!,
    id: `US-${i + 1}`,
    acceptanceCriteria: [
      "Search returns results within 300ms for 1000 recipes",
    ],
  })),
  openQuestions: [],
};

const verdictProvider = (verdict: "pass" | "fail") =>
  new FakeProvider(() => ({
    reasoning: `Judged ${verdict}`,
    evidence: [],
    verdict,
  }));

describe("programmatic graders", () => {
  it("passes a grounded, scoped document (oracle)", () => {
    expect(codeGrades(sampleRequirements, mealCase)).toEqual({
      no_unsourced_numbers: 1,
      story_budget: 1,
      asks_questions: 1,
    });
  });

  it("fails a document with the known failure modes (null)", () => {
    expect(codeGrades(badRequirements, mealCase)).toEqual({
      no_unsourced_numbers: 0,
      story_budget: 0,
      asks_questions: 0,
    });
  });

  it("flags only numbers the idea does not state, ignoring story ids", () => {
    const doc = {
      ...sampleRequirements,
      goals: ["Plan 7 days of dinners", "Load in under 2.5 seconds"],
      constraints: ["See US-12"],
    };
    expect(unsourcedNumbers(doc, mealCase.idea)).toEqual(["2.5"]);
  });
});

describe("judge", () => {
  it("scores each criterion with its own call and keeps the reasoning", async () => {
    const provider = verdictProvider("pass");
    const result = await judge(provider, mealCase.idea, sampleRequirements);

    expect(result.grades).toEqual({ grounded: 1, testable: 1, scoped: 1 });
    expect(result.explanation.grounded).toBe("Judged pass");
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[0]?.system).toContain("data to evaluate");
    expect(provider.requests[0]?.prompt).toContain("<requirements_document>");
  });

  it("maps a fail verdict to 0", async () => {
    const result = await judge(verdictProvider("fail"), "x", badRequirements);
    expect(result.grades).toEqual({ grounded: 0, testable: 0, scoped: 0 });
  });
});

describe("runner", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pm-eval-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseOptions = {
    variant: "baseline",
    cases: toEvalCases([mealCase]),
    reps: 1,
    concurrency: 2,
    timeoutMs: 5_000,
    isRetryable: () => false,
  };

  it("writes a graded row and trace, and resumes without redoing it", async () => {
    const provider = new FakeProvider(() => sampleRequirements);
    const runCase = createPmCaseRunner({
      provider,
      judgeProvider: verdictProvider("pass"),
    });

    const first = await runEval({ ...baseOptions, flowDir: dir, runCase });
    const second = await runEval({ ...baseOptions, flowDir: dir, runCase });

    expect(first).toEqual({ scored: 1, skipped: 0, errors: 0 });
    expect(second).toEqual({ scored: 0, skipped: 1, errors: 0 });
    expect(provider.requests).toHaveLength(1);

    const [row] = await readJsonl(join(dir, "baseline/results.jsonl"));
    expect(row).toMatchObject({
      prompt_id: "meal-planner",
      rep: 0,
      attempts: 1,
      status: "ok",
      model: "fake-model",
      judge_model: "fake-model",
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    // Every declared metric is present on the row.
    expect(Object.keys(row!.grade as object).sort()).toEqual(
      metrics.map((m) => m.id).sort(),
    );
    const trace = JSON.parse(
      await readFile(
        join(dir, "baseline/traces/meal-planner_rep0.json"),
        "utf8",
      ),
    );
    expect(trace.map((t: { role: string }) => t.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);

    const summary = await summarize(join(dir, "baseline"), metrics);
    expect(summary.metrics[0]).toMatchObject({ id: "grounded", mean: 1, n: 1 });
  });

  it("records a refusal as its own outcome, outside the means", async () => {
    const runCase = createPmCaseRunner({
      provider: new FakeProvider(() => {
        throw new ModelRefusalError("cyber");
      }),
      judgeProvider: verdictProvider("pass"),
    });

    await runEval({ ...baseOptions, flowDir: dir, runCase });

    const summary = await summarize(join(dir, "baseline"), metrics);
    expect(summary.byStatus).toEqual({ refused: 1 });
    expect(summary.metrics[0]).toMatchObject({ n: 0 });
  });

  it("sends a response from a different model to errors, not results", async () => {
    const substituted: ModelProvider = {
      model: "claude-opus-5",
      async generateStructured<S extends z.ZodType>(req: StructuredRequest<S>) {
        return {
          output: req.schema.parse(sampleRequirements),
          model: "claude-opus-4-8",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const runCase = createPmCaseRunner({
      provider: substituted,
      judgeProvider: verdictProvider("pass"),
    });

    const result = await runEval({ ...baseOptions, flowDir: dir, runCase });

    expect(result.errors).toBe(1);
    expect(await readJsonl(join(dir, "baseline/results.jsonl"))).toEqual([]);
    const [error] = await readJsonl(join(dir, "baseline/errors.jsonl"));
    expect(error).toMatchObject({
      failure_class: "served_model_mismatch",
      model: "claude-opus-4-8",
      will_retry: false,
    });
  });

  it("retries transient errors and records the attempts", async () => {
    let calls = 0;
    const flaky = new FakeProvider(() => {
      calls += 1;
      if (calls === 1) throw new Error("overloaded");
      return sampleRequirements;
    });
    const runCase = createPmCaseRunner({
      provider: flaky,
      judgeProvider: verdictProvider("pass"),
    });

    await runEval({
      ...baseOptions,
      flowDir: dir,
      runCase,
      isRetryable: (e) => (e as Error).message === "overloaded",
    });

    const [row] = await readJsonl(join(dir, "baseline/results.jsonl"));
    expect(row).toMatchObject({ status: "ok", attempts: 2 });
    const errors = await readJsonl(join(dir, "baseline/errors.jsonl"));
    expect(errors).toMatchObject([
      { failure_class: "api_error", will_retry: true, attempt: 1 },
    ]);
    expect((await summarize(join(dir, "baseline"), metrics)).errors).toBe(0);
  }, 15_000);

  it("times out a hung case as an error", async () => {
    await runEval({
      ...baseOptions,
      flowDir: dir,
      timeoutMs: 20,
      runCase: () => new Promise(() => {}),
    });
    const [error] = await readJsonl(join(dir, "baseline/errors.jsonl"));
    expect(error).toMatchObject({ failure_class: "timeout" });
  });

  it("rejects variant names the report would ignore", async () => {
    await expect(
      runEval({
        ...baseOptions,
        flowDir: dir,
        variant: "better-prompt",
        runCase: async () => {
          throw new Error("unreachable");
        },
      }),
    ).rejects.toThrow("baseline");
  });
});

describe("harness gate", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pm-harness-"));
    await writeFile(join(dir, "grader.ts"), "v1");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const gate = (approve: boolean) =>
    checkHarness({
      flowDir: join(dir, "flow"),
      root: dir,
      paths: ["grader.ts"],
      approve,
      state: { metrics: [] },
    });

  it("refuses to run until approved, and again after the harness changes", async () => {
    await expect(gate(false)).rejects.toBeInstanceOf(HarnessNotApprovedError);
    await gate(true);
    await expect(gate(false)).resolves.toBeUndefined();

    await writeFile(join(dir, "grader.ts"), "v2");
    await expect(gate(false)).rejects.toThrow("changed");
  });
});
