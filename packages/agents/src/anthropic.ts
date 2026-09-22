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
  /**
   * Workspace to bill, sent as `anthropic-workspace-id`. Required when the API
   * key is not scoped to a workspace. Ignored when `client` is given.
   */
  workspaceId?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client =
      options.client ??
      new Anthropic(
        options.workspaceId
          ? {
              defaultHeaders: { "anthropic-workspace-id": options.workspaceId },
            }
          : {},
      );
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

    const requestId = response._request_id;

    if (response.stop_reason === "refusal") {
      throw new ModelRefusalError(
        response.stop_details?.category ?? null,
        usage,
        requestId,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelOutputError("Model output was truncated", usage, {
        requestId,
      });
    }
    if (response.parsed_output == null) {
      throw new ModelOutputError("Model output did not match schema", usage, {
        requestId,
      });
    }

    return {
      output: response.parsed_output,
      model: response.model,
      usage,
      requestId,
    };
  }
}

/**
 * Whether a failed model call is worth retrying: transient API failures
 * (timeouts, rate limits, overload, 5xx, connection errors) and bad output,
 * which a fresh sample may fix. Refusals and other client errors are not.
 */
export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelOutputError) return true;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return false;
}
