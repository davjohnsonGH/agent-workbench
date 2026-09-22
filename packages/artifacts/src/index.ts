import { z } from "zod";

import { type DesignSpec, designSpecSchema } from "./design-spec";
import { type Requirements, requirementsSchema } from "./requirements";

export * from "./design-spec";
export * from "./requirements";

/**
 * Registry of artifact types. This is the source of truth for which artifact
 * types exist; `@repo/db` derives its `artifact.type` column from it.
 *
 * Bump `schemaVersion` whenever a schema changes incompatibly. Stored versions
 * record the schema version they were validated against.
 */
export const artifactRegistry = {
  requirements: { schemaVersion: 1, schema: requirementsSchema },
  design_spec: { schemaVersion: 1, schema: designSpecSchema },
} as const;

export type ArtifactType = keyof typeof artifactRegistry;
export const artifactTypes = Object.keys(artifactRegistry) as [
  ArtifactType,
  ...ArtifactType[],
];

export type ArtifactContent = {
  requirements: Requirements;
  design_spec: DesignSpec;
};

export function parseArtifactContent<T extends ArtifactType>(
  type: T,
  content: unknown,
): z.ZodSafeParseResult<ArtifactContent[T]> {
  return artifactRegistry[type].schema.safeParse(
    content,
  ) as z.ZodSafeParseResult<ArtifactContent[T]>;
}

/** JSON Schema for an artifact type, for LLM structured output. */
export function artifactJsonSchema(type: ArtifactType) {
  return z.toJSONSchema(artifactRegistry[type].schema);
}
