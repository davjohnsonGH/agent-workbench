import {
  artifactJsonSchema,
  artifactTypes,
  findUnknownStoryRefs,
  parseArtifactContent,
} from "@repo/artifacts";
import { describe, expect, it } from "vitest";

import { sampleDesignSpec, sampleRequirements } from "../fixtures/artifacts";

describe("parseArtifactContent", () => {
  it("accepts valid requirements", () => {
    const result = parseArtifactContent("requirements", sampleRequirements);
    expect(result.success).toBe(true);
  });

  it("accepts a valid design spec", () => {
    const result = parseArtifactContent("design_spec", sampleDesignSpec);
    expect(result.success).toBe(true);
  });

  it("rejects a user story without acceptance criteria", () => {
    const [story] = sampleRequirements.userStories;
    const result = parseArtifactContent("requirements", {
      ...sampleRequirements,
      userStories: [{ ...story, acceptanceCriteria: [] }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      "userStories",
      0,
      "acceptanceCriteria",
    ]);
  });

  it("rejects an unknown priority", () => {
    const [story] = sampleRequirements.userStories;
    const result = parseArtifactContent("requirements", {
      ...sampleRequirements,
      userStories: [{ ...story, priority: "urgent" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects content for the wrong artifact type", () => {
    const result = parseArtifactContent("design_spec", sampleRequirements);
    expect(result.success).toBe(false);
  });
});

describe("findUnknownStoryRefs", () => {
  it("returns nothing when all references exist", () => {
    expect(findUnknownStoryRefs(sampleDesignSpec, sampleRequirements)).toEqual(
      [],
    );
  });

  it("returns each unknown story id once", () => {
    const spec = {
      ...sampleDesignSpec,
      screens: sampleDesignSpec.screens.map((s) => ({
        ...s,
        userStoryIds: [...s.userStoryIds, "US-99"],
      })),
    };
    expect(findUnknownStoryRefs(spec, sampleRequirements)).toEqual(["US-99"]);
  });
});

describe("artifactJsonSchema", () => {
  it.each(artifactTypes)("produces an object schema for %s", (type) => {
    const schema = artifactJsonSchema(type);
    expect(schema.type).toBe("object");
    expect(schema.required?.length).toBeGreaterThan(0);
  });
});
