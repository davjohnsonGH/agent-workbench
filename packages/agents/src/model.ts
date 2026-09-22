import type { z } from "zod";

/**
 * Provider-neutral interface for model calls. Agents depend on this, not on a
 * vendor SDK, so tests can use a fake and providers can be swapped.
 */
export interface ModelProvider {
  /** Model requested by default; the response reports the model that served it. */
  readonly model: string;
  generateStructured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResponse<z.infer<S>>>;
}

export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  prompt: string;
  /** Output is constrained to, and validated against, this schema. */
  schema: S;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResponse<T> {
  output: T;
  model: string;
  usage: ModelUsage;
}

/** The model declined the request (after any fallbacks). */
export class ModelRefusalError extends Error {
  constructor(
    readonly category: string | null,
    readonly usage?: ModelUsage,
  ) {
    super(`Model refused the request${category ? ` (${category})` : ""}`);
    this.name = "ModelRefusalError";
  }
}

/** The model responded, but the output was truncated or failed validation. */
export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly usage?: ModelUsage,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelOutputError";
  }
}
