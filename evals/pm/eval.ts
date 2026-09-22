import {
  buildAgentRequest,
  ModelOutputError,
  type ModelProvider,
  ModelRefusalError,
  pmAgent,
} from "@repo/agents";

import { type CaseResult, EvalError, type TraceTurn } from "../lib/runner";
import type { PmCase } from "./cases";
import { codeGrades, type Grade, judge, metrics } from "./graders";

export interface PmEvalCase extends PmCase {
  prompt: string;
}

/** Eval cases in the runner's shape: the idea is the prompt shown in reports. */
export function toEvalCases(cases: PmCase[]): PmEvalCase[] {
  return cases.map((c) => ({ ...c, prompt: c.idea }));
}

const zeroGrade = () =>
  Object.fromEntries(metrics.map((m) => [m.id, 0])) as Grade;

/**
 * Run one case through the PM agent's real request builder and provider
 * (the same code path as production, minus the database), then grade it.
 */
export function createPmCaseRunner(options: {
  provider: ModelProvider;
  judgeProvider: ModelProvider;
}) {
  const { provider, judgeProvider } = options;

  return async function runCase(testCase: PmEvalCase): Promise<CaseResult> {
    const request = buildAgentRequest(pmAgent, {
      idea: testCase.idea,
      inputs: {},
    });
    const trace: TraceTurn[] = [
      { role: "system", content: request.system },
      { role: "user", content: request.prompt },
    ];
    const started = performance.now();
    const elapsed = () => (performance.now() - started) / 1000;

    let response;
    try {
      response = await provider.generateStructured(request);
    } catch (error) {
      const usage = (
        error as { usage?: { inputTokens: number; outputTokens: number } }
      ).usage;
      const recorded = {
        model: provider.model,
        usage: {
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
        },
        grade: zeroGrade(),
        latency_s: elapsed(),
        trace,
      };
      // Graded outcomes that are not quality results: kept out of the means
      // and counted separately.
      if (error instanceof ModelRefusalError) {
        return {
          ...recorded,
          status: "refused",
          stop_reason: "refusal",
          meta: { category: error.category },
        };
      }
      if (
        error instanceof ModelOutputError &&
        error.message.includes("truncated")
      ) {
        return { ...recorded, status: "truncated", stop_reason: "max_tokens" };
      }
      if (error instanceof ModelOutputError) {
        throw new EvalError("invalid_output", error.message, {
          model: recorded.model,
          usage: recorded.usage,
        });
      }
      throw error;
    }
    const latency = elapsed();
    const usage = {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
    };

    // A score from a different model (e.g. a refusal fallback) measures
    // nothing about the model under test.
    if (!response.model.startsWith(provider.model)) {
      throw new EvalError(
        "served_model_mismatch",
        `Requested ${provider.model}, served by ${response.model}`,
        { model: response.model, usage },
      );
    }

    trace.push({
      role: "assistant",
      content: JSON.stringify(response.output, null, 2),
    });

    let judged;
    try {
      judged = await judge(judgeProvider, testCase.idea, response.output);
    } catch (error) {
      throw new EvalError(
        "grader_error",
        `Judge failed: ${error instanceof Error ? error.message : String(error)}`,
        { model: response.model, usage },
      );
    }

    return {
      status: "ok",
      stop_reason: "end_turn",
      grade: { ...judged.grades, ...codeGrades(response.output, testCase) },
      explanation: judged.explanation,
      model: response.model,
      usage,
      judge_model: judged.model,
      judge_usage: {
        input_tokens: judged.usage.inputTokens,
        output_tokens: judged.usage.outputTokens,
      },
      latency_s: latency,
      meta: {
        stories: response.output.userStories.length,
        openQuestions: response.output.openQuestions.length,
        requestId: response.requestId ?? null,
      },
      trace,
    };
  };
}
