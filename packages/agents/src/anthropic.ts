import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

import {
  type ModelProvider,
  ModelOutputError,
  ModelRefusalError,
  type ModelUsage,
  type StructuredRequest,
  type StructuredResponse,
} from "./model";

export const DEFAULT_MODEL = "claude-opus-5";

export interface AnthropicProviderOptions {
  /** Defaults to a client that resolves credentials from the environment. */
  client?: Anthropic;
  model?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async generateStructured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResponse<z.infer<S>>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        // On a safety decline, re-run server-side on Anthropic's recommended
        // fallback model instead of returning the refusal.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: { format: betaZodOutputFormat(request.schema) },
      });
    } catch (error) {
      // API errors (rate limits, auth, 5xx) propagate as-is; the SDK already
      // retries the transient ones. Anything else is an output parse failure.
      if (error instanceof Anthropic.APIError) throw error;
      throw new ModelOutputError("Failed to parse model output", undefined, {
        cause: error,
      });
    }

    const usage: ModelUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === "refusal") {
      throw new ModelRefusalError(
        response.stop_details?.category ?? null,
        usage,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelOutputError("Model output was truncated", usage);
    }
    if (response.parsed_output == null) {
      throw new ModelOutputError("Model output did not match schema", usage);
    }

    return { output: response.parsed_output, model: response.model, usage };
  }
}
