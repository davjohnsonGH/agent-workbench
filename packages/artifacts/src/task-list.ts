import { z } from "zod";

import type { DesignSpec } from "./design-spec";
import type { Requirements } from "./requirements";

/** Engineering task list produced by the Engineer agent from the approved requirements and design. */

export const estimates = ["S", "M", "L"] as const;
export type Estimate = (typeof estimates)[number];

export const taskSchema = z.object({
  id: z.string().min(1).describe('Stable identifier, e.g. "T-1".'),
  title: z.string().min(1),
  description: z.string().min(1),
  userStoryIds: z
    .array(z.string().min(1))
    .describe(
      "Ids of the requirements user stories this task delivers; empty only for enabling work such as project setup.",
    ),
  screenIds: z
    .array(z.string().min(1))
    .describe("Ids of the design spec screens this task implements, if any."),
  dependsOn: z
    .array(z.string().min(1))
    .describe("Ids of tasks that must be completed before this one."),
  estimate: z
    .enum(estimates)
    .describe(
      "S: under half a day. M: one to two days. L: three to five days.",
    ),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});
export type Task = z.infer<typeof taskSchema>;

export const taskListSchema = z.object({
  overview: z
    .string()
    .min(1)
    .describe("The implementation approach and how the work is sequenced."),
  tasks: z.array(taskSchema).min(1),
  risks: z.array(
    z.object({
      risk: z.string().min(1),
      mitigation: z.string().min(1),
    }),
  ),
  openQuestions: z.array(z.string().min(1)),
});
export type TaskList = z.infer<typeof taskListSchema>;

/**
 * Problems the schema cannot catch: duplicate task ids, references to user
 * stories, screens, or tasks that do not exist, and dependency cycles (which
 * make the plan impossible to execute).
 */
export function findTaskListProblems(
  taskList: TaskList,
  requirements: Requirements,
  designSpec: DesignSpec,
): string[] {
  const problems: string[] = [];
  const stories = new Set(requirements.userStories.map((s) => s.id));
  const screens = new Set(designSpec.screens.map((s) => s.id));
  const taskIds = taskList.tasks.map((t) => t.id);
  const tasks = new Set(taskIds);

  const duplicates = taskIds.filter((id, i) => taskIds.indexOf(id) !== i);
  if (duplicates.length > 0) {
    problems.push(`Duplicate task ids: ${unique(duplicates).join(", ")}`);
  }

  const unknown = (ids: string[], known: Set<string>) =>
    unique(ids.filter((id) => !known.has(id)));
  const all = (pick: (t: Task) => string[]) => taskList.tasks.flatMap(pick);

  const unknownStories = unknown(
    all((t) => t.userStoryIds),
    stories,
  );
  if (unknownStories.length > 0) {
    problems.push(
      `References unknown user stories: ${unknownStories.join(", ")}`,
    );
  }
  const unknownScreens = unknown(
    all((t) => t.screenIds),
    screens,
  );
  if (unknownScreens.length > 0) {
    problems.push(`References unknown screens: ${unknownScreens.join(", ")}`);
  }
  const unknownTasks = unknown(
    all((t) => t.dependsOn),
    tasks,
  );
  if (unknownTasks.length > 0) {
    problems.push(`Depends on unknown tasks: ${unknownTasks.join(", ")}`);
  }

  const cycle = findCycle(taskList.tasks);
  if (cycle) problems.push(`Dependency cycle: ${cycle.join(" → ")}`);

  return problems;
}

/** A dependency cycle as a path of task ids (first id repeated at the end), if any. */
function findCycle(tasks: Task[]): string[] | null {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  function visit(id: string): string[] | null {
    if (state.get(id) === "done" || !deps.has(id)) return null;
    if (state.get(id) === "visiting") {
      return [...path.slice(path.indexOf(id)), id];
    }
    state.set(id, "visiting");
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  }

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) return cycle;
  }
  return null;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
