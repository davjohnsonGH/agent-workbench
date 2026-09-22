# Evals

Offline evaluations of agent quality. Each eval runs an agent's real prompt
and provider code over a fixed case set and grades the outputs, so changes to
prompts, models, or settings can be compared on numbers rather than
impressions.

Evals make **paid API calls** and are never run in CI. The harness itself is
tested with fake providers in `tests/evals/`.

## PM requirements (`pm/`)

Measures the PM agent (idea → requirements) on the failure modes seen in real
runs: invented specifics presented as requirements, scope larger than the idea
supports, and assuming answers instead of asking.

### Cases: `pm/cases.ts`

16 ideas in four groups (`tags[0]`): **vague** (4, including the real input
"a todo app"), **specific** (4), **feature** additions to an existing product
(4), and **constrained** ideas with explicit limits (4). Each case has
human-set expectations, which need review before the first run:

- `maxStories`: more user stories than this suggests scope creep.
- `minOpenQuestions`: fewer than this suggests the agent assumed rather than
  asked.

### Metrics: `pm/graders.ts`

Scored independently. The first metric is the headline.

| Metric                 | Grader    | Passes when                                                                                                                           |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `grounded`             | LLM judge | No invented specifics (limits, targets, platforms, integrations, rules) presented as requirements; stated constraints carried through |
| `testable`             | LLM judge | Every story's acceptance criteria are verifiable                                                                                      |
| `scoped`               | LLM judge | "Must" scope is proportionate to the idea; unrequested features are absent or lower priority                                          |
| `no_unsourced_numbers` | code      | No number in goals, constraints, or criteria that the idea doesn't contain (proxy for `grounded`)                                     |
| `story_budget`         | code      | Story count ≤ the case's `maxStories`                                                                                                 |
| `asks_questions`       | code      | Open questions ≥ the case's `minOpenQuestions`                                                                                        |

The judge makes one structured-output call per criterion. It treats the idea
and the document as data rather than instructions, is told not to reward
length, and defaults to `claude-sonnet-5`, which differs from the model under
test.

**Considered and left out:** overall "quality" (a blend that can't be
calibrated); story-id format (the schema covers it); comparing against
reference documents (there is no single correct PRD, and gold text written by
a model would reward imitating that model); a pairwise judge (add it when
comparing two prompt variants).

### Running it

```sh
# 1. Review cases.ts and graders.ts, then approve the harness. Records a hash
#    of the eval code; any later change requires re-approval.
npm run eval:pm -- --approve-harness

# 2. Pilot on one or two cases and read the output and traces.
npm run eval:pm -- --only todo-app,feature-dark-mode

# 3. Full baseline run; add reps to shrink the confidence intervals.
npm run eval:pm -- --reps 2

# 4. A variant (e.g. after editing the PM prompt or switching models).
npm run eval:pm -- --variant v1 --model claude-sonnet-5
```

Output goes to `.claude/hillclimb/pm-requirements/<variant>/`:
`results.jsonl` (one graded row per case and rep, with the judge's reasoning),
`errors.jsonl` (attempts with no scorable output, such as API errors,
timeouts, a served-model mismatch, or invalid output, which are never scored
as model failures), and `traces/` (full prompt and response per case). The run
prints each metric with a 95% confidence interval and an estimated cost.

Before trusting a judge metric, check it against your own judgment. Read the
judge's reasoning on a few pilot cases, especially failures, and adjust the
criteria in `graders.ts` until you would have graded the same way. Note the
noise floor: with 16 cases × 1 rep, a pass rate is only precise to roughly
±25 points, so use `--reps 2` or more before acting on small differences.

For an HTML report of a run, use the Claude Code `/claude-api` skill's report
builder on `.claude/hillclimb/pm-requirements/`.
