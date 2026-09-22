# ADR-0003: Thin model-provider interface with schema-constrained output

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Agents must produce artifacts that pass their Zod schemas (ADR-0001). Agent
logic should be testable without network calls or API spend, and the project
wants room to compare models or providers later without building a framework
up front.

## Decision

- **A `ModelProvider` interface** in `@repo/agents` with one method,
  `generateStructured({ system, prompt, schema })`, which returns the validated
  output, the model that served it, and token usage. Agents depend only on this
  interface.
- **One implementation, `AnthropicProvider`,** built on the official
  `@anthropic-ai/sdk`. It uses structured outputs (`output_config.format`
  generated from the artifact's Zod schema), so the API constrains the response
  to the schema, and the SDK parses and validates it.
- **Default model `claude-opus-5`**, overridable per provider instance (the
  `AGENT_MODEL` env var in scripts). Adaptive thinking is on.
- **Server-side refusal fallbacks (`fallbacks: "default"`).** If the model
  declines on safety grounds, the API re-runs the request on Anthropic's
  recommended fallback model. The model that actually served the request is
  recorded on the run.
- **Typed failure modes:** `ModelRefusalError` (declined even after fallback)
  and `ModelOutputError` (truncated or invalid output) carry token usage so
  failed runs still record cost. SDK API errors (rate limits, 5xx) propagate
  unchanged after the SDK's built-in retries.
- **Tests use a `FakeProvider`** that returns canned output through the same
  schema validation, so CI needs no API key.

## Consequences

- Swapping or A/B-testing models is a constructor argument. Adding another
  provider means implementing a single method.
- The interface covers only single-shot structured generation. Tool use,
  streaming, and multi-turn conversations will extend it when an agent needs
  them, not before.
- Artifact schemas must stay within what structured outputs support. See the
  note in `@repo/artifacts`.
- Agent runs are synchronous in the request path for now. Moving them to a
  queue is a later, separately recorded decision.

## Alternatives considered

- **Vercel AI SDK / LangChain-style multi-provider abstraction:** adds a
  dependency and hides the API features this project wants to learn and use
  directly (fallbacks, thinking, caching).
- **Prompting for JSON and parsing it by hand:** less reliable than
  schema-constrained decoding, and it needs retry logic for malformed output.
