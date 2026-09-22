import type {
  ModelProvider,
  StructuredRequest,
  StructuredResponse,
} from "@repo/agents";
import { designSpecSchema } from "@repo/artifacts";
import type { z } from "zod";

import { sampleDesignSpec, sampleRequirements } from "./artifacts";

/**
 * A ModelProvider that returns canned output (validated against the request
 * schema, like a real provider) and records every request it receives.
 */
export class FakeProvider implements ModelProvider {
  readonly model = "fake-model";
  readonly requests: StructuredRequest<z.ZodType>[] = [];

  constructor(
    private readonly respond: (
      request: StructuredRequest<z.ZodType>,
    ) => unknown,
  ) {}

  async generateStructured<S extends z.ZodType>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResponse<z.infer<S>>> {
    this.requests.push(request);
    const output = request.schema.parse(this.respond(request));
    return {
      output,
      model: this.model,
      usage: { inputTokens: 100, outputTokens: 200 },
      requestId: "fake-request",
    };
  }
}

/** Responds with the sample artifact matching each request's schema. */
export function sampleTeamProvider(overrides: { designSpec?: unknown } = {}) {
  return new FakeProvider((request) =>
    request.schema === designSpecSchema
      ? (overrides.designSpec ?? sampleDesignSpec)
      : sampleRequirements,
  );
}
