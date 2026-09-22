import {
  findTaskListProblems,
  parseArtifactContent,
  type TaskList,
} from "@repo/artifacts";
import { describe, expect, it } from "vitest";

import {
  sampleDesignSpec,
  sampleRequirements,
  sampleTaskList,
} from "../fixtures/artifacts";

function problems(taskList: TaskList) {
  return findTaskListProblems(taskList, sampleRequirements, sampleDesignSpec);
}

function withTasks(edit: (tasks: TaskList["tasks"]) => TaskList["tasks"]) {
  return {
    ...sampleTaskList,
    tasks: edit(structuredClone(sampleTaskList.tasks)),
  };
}

describe("task list", () => {
  it("accepts the sample task list", () => {
    expect(parseArtifactContent("task_list", sampleTaskList).success).toBe(
      true,
    );
    expect(problems(sampleTaskList)).toEqual([]);
  });

  it("rejects an unknown estimate", () => {
    const result = parseArtifactContent(
      "task_list",
      withTasks((t) => [{ ...t[0]!, estimate: "XL" as "L" }]),
    );
    expect(result.success).toBe(false);
  });

  it("flags references to unknown stories, screens, and tasks", () => {
    const taskList = withTasks((t) => {
      t[1]!.userStoryIds.push("US-9");
      t[1]!.screenIds.push("SCR-9");
      t[2]!.dependsOn.push("T-9");
      return t;
    });
    expect(problems(taskList)).toEqual([
      "References unknown user stories: US-9",
      "References unknown screens: SCR-9",
      "Depends on unknown tasks: T-9",
    ]);
  });

  it("flags duplicate task ids", () => {
    const taskList = withTasks((t) => [...t, { ...t[0]! }]);
    expect(problems(taskList)).toContain("Duplicate task ids: T-1");
  });

  it("flags dependency cycles", () => {
    const taskList = withTasks((t) => {
      t[0]!.dependsOn.push("T-3");
      return t;
    });
    expect(problems(taskList)).toEqual([
      "Dependency cycle: T-1 → T-3 → T-2 → T-1",
    ]);
  });

  it("flags a task that depends on itself", () => {
    const taskList = withTasks((t) => {
      t[0]!.dependsOn.push("T-1");
      return t;
    });
    expect(problems(taskList)).toEqual(["Dependency cycle: T-1 → T-1"]);
  });
});
