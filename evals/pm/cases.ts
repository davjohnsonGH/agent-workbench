/**
 * Eval cases for the PM agent (idea → requirements).
 *
 * Provenance: "a todo app" is a real input from the first live run, whose
 * output showed the failure modes this eval targets: invented numeric limits
 * presented as requirements, and scope larger than the idea supports. The
 * other cases are synthesized variations spanning how specific an idea is.
 * The `expected` values are human judgments, proposed here for review
 * (not derived from any model's output).
 *
 * tags[0] is the primary grouping:
 *   vague       - a few words; the agent should ask, not assume
 *   specific    - a paragraph with clear users and scope
 *   feature     - an addition to an existing product
 *   constrained - states explicit limits (numbers, platforms) that the
 *                 requirements should carry through, not contradict
 */
export interface PmCase {
  id: string;
  idea: string;
  tags: string[];
  expected: {
    /** More user stories than this suggests scope creep for this idea. */
    maxStories: number;
    /** Fewer open questions than this means ambiguity was assumed away. */
    minOpenQuestions: number;
  };
}

export const pmCases: PmCase[] = [
  // vague
  {
    id: "todo-app",
    idea: "a todo app",
    tags: ["vague", "real-input"],
    expected: { maxStories: 8, minOpenQuestions: 3 },
  },
  {
    id: "habit-tracker",
    idea: "a habit tracker",
    tags: ["vague"],
    expected: { maxStories: 8, minOpenQuestions: 3 },
  },
  {
    id: "recipe-sharing",
    idea: "an app for sharing recipes with friends",
    tags: ["vague"],
    expected: { maxStories: 8, minOpenQuestions: 3 },
  },
  {
    id: "budget-tool",
    idea: "help me budget better",
    tags: ["vague"],
    expected: { maxStories: 8, minOpenQuestions: 3 },
  },
  // specific
  {
    id: "dog-walker-booking",
    idea: "A booking page for my dog-walking business. Clients pick a 30- or 60-minute walk, choose an open slot from my weekly availability, and pay a deposit online. I get an email for each booking and can cancel a booking from an admin page.",
    tags: ["specific"],
    expected: { maxStories: 9, minOpenQuestions: 1 },
  },
  {
    id: "classroom-quiz",
    idea: "A quiz tool for high-school teachers: a teacher writes multiple-choice questions, shares a link, students answer without accounts by entering their name, and the teacher sees each student's score and which questions most students got wrong.",
    tags: ["specific"],
    expected: { maxStories: 9, minOpenQuestions: 1 },
  },
  {
    id: "book-club",
    idea: "A private site for our 12-person book club to vote on the next book from a shortlist, see the meeting date and host, and keep a list of every book we've read with the date we discussed it.",
    tags: ["specific"],
    expected: { maxStories: 8, minOpenQuestions: 1 },
  },
  {
    id: "equipment-checkout",
    idea: "Our university lab needs a way for students to check out shared equipment (cameras, laptops, tripods). Students reserve an item for up to 3 days, lab staff mark items as picked up and returned, and overdue items are listed for staff.",
    tags: ["specific"],
    expected: { maxStories: 9, minOpenQuestions: 1 },
  },
  // feature
  {
    id: "feature-dark-mode",
    idea: "Add a dark mode to our existing web app. It should follow the operating system setting by default and let users override it.",
    tags: ["feature"],
    expected: { maxStories: 4, minOpenQuestions: 1 },
  },
  {
    id: "feature-csv-export",
    idea: "Let users of our invoicing app export their invoices to CSV so they can import them into their accounting software.",
    tags: ["feature"],
    expected: { maxStories: 4, minOpenQuestions: 1 },
  },
  {
    id: "feature-comment-mentions",
    idea: "In our project management tool, let people @mention teammates in task comments and notify the mentioned person.",
    tags: ["feature"],
    expected: { maxStories: 5, minOpenQuestions: 2 },
  },
  {
    id: "feature-password-reset",
    idea: "Our app has email/password login but no way to reset a forgotten password. Add one.",
    tags: ["feature"],
    expected: { maxStories: 4, minOpenQuestions: 1 },
  },
  // constrained
  {
    id: "constrained-offline-notes",
    idea: "A note-taking app for field researchers that must work fully offline on Android tablets and sync to a server when a connection is available. Notes can include up to 10 photos.",
    tags: ["constrained"],
    expected: { maxStories: 9, minOpenQuestions: 1 },
  },
  {
    id: "constrained-kiosk",
    idea: "A check-in kiosk for a small clinic running on a single iPad at the front desk. Patients check in with their last name and date of birth; no patient data may be stored on the device after check-in.",
    tags: ["constrained"],
    expected: { maxStories: 7, minOpenQuestions: 1 },
  },
  {
    id: "constrained-budget-mvp",
    idea: "An MVP for a neighborhood tool-lending library that one developer can build in two weeks. Members list tools they can lend and request to borrow others' tools; no payments.",
    tags: ["constrained"],
    expected: { maxStories: 6, minOpenQuestions: 1 },
  },
  {
    id: "constrained-accessibility",
    idea: "A public-facing appointment request form for a city council office. It must meet WCAG 2.2 AA, be available in English and Spanish, and send requests to the existing shared inbox.",
    tags: ["constrained"],
    expected: { maxStories: 6, minOpenQuestions: 1 },
  },
];
