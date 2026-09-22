import type { DesignSpec, Requirements, TaskList } from "@repo/artifacts";

/** Valid sample artifacts, reusable across tests. */

export const sampleRequirements: Requirements = {
  summary:
    "Busy home cooks struggle to plan weekly meals. A meal planner helps them pick recipes and produce a shopping list.",
  goals: ["Plan a week of dinners in under five minutes"],
  nonGoals: ["Grocery delivery integration"],
  targetUsers: [
    { name: "Home cook", description: "Cooks dinner for a household of 2-5." },
  ],
  userStories: [
    {
      id: "US-1",
      asA: "home cook",
      iWant: "to pick recipes for each day of the week",
      soThat: "I know what to cook",
      acceptanceCriteria: ["Can assign one recipe to each of 7 days"],
      priority: "must",
    },
    {
      id: "US-2",
      asA: "home cook",
      iWant: "a combined shopping list for my plan",
      soThat: "I can shop once",
      acceptanceCriteria: ["Ingredients across recipes are merged"],
      priority: "should",
    },
  ],
  constraints: ["Web only for V1"],
  openQuestions: ["Should plans support lunches?"],
};

export const sampleDesignSpec: DesignSpec = {
  overview: "A single weekly calendar view with a recipe picker drawer.",
  screens: [
    {
      id: "SCR-1",
      name: "Week planner",
      purpose: "Assign recipes to days",
      keyElements: ["7-day grid", "Recipe picker drawer"],
      userStoryIds: ["US-1"],
    },
    {
      id: "SCR-2",
      name: "Shopping list",
      purpose: "Show merged ingredients",
      keyElements: ["Grouped ingredient checklist"],
      userStoryIds: ["US-2"],
    },
  ],
  userFlows: [
    {
      id: "FLOW-1",
      name: "Plan the week",
      steps: ["Open week planner", "Pick a recipe per day", "View list"],
      userStoryIds: ["US-1", "US-2"],
    },
  ],
  designDecisions: [
    {
      decision: "Use a drawer for recipe selection",
      rationale: "Keeps the week visible while choosing",
    },
  ],
  openQuestions: [],
};

export const sampleTaskList: TaskList = {
  overview: "Build the data model first, then the planner, then the list.",
  tasks: [
    {
      id: "T-1",
      title: "Recipe and plan data model",
      description: "Store recipes and a weekly plan of day-to-recipe entries.",
      userStoryIds: [],
      screenIds: [],
      dependsOn: [],
      estimate: "S",
      acceptanceCriteria: ["A plan stores one recipe per day"],
    },
    {
      id: "T-2",
      title: "Week planner screen",
      description: "7-day grid with a recipe picker drawer.",
      userStoryIds: ["US-1"],
      screenIds: ["SCR-1"],
      dependsOn: ["T-1"],
      estimate: "M",
      acceptanceCriteria: ["Can assign a recipe to each day"],
    },
    {
      id: "T-3",
      title: "Shopping list",
      description: "Merge ingredients across the planned recipes.",
      userStoryIds: ["US-2"],
      screenIds: ["SCR-2"],
      dependsOn: ["T-2"],
      estimate: "M",
      acceptanceCriteria: ["Duplicate ingredients are merged"],
    },
  ],
  risks: [
    {
      risk: "Ingredient units vary between recipes",
      mitigation: "Merge only identical units in V1",
    },
  ],
  openQuestions: [],
};
