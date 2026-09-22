# Agent Workbench

A human-supervised AI software team that takes a product idea and coordinates
specialized agents to turn it into structured requirements, designs,
engineering work, and eventually working software.

## What it does

You give the system a product or feature idea. Instead of separately prompting
a chatbot for requirements, designs, architecture, tasks, and code, the
workbench coordinates role-based agents (PM and Designer first, then Engineer)
that share project context and produce persistent, structured artifacts:
requirements, technical decisions, tasks, design specs, and eventually code and
pull requests.

Agents do bounded work autonomously and pass artifacts to one another, but
consequential steps pass through human approval gates. For example: the PM
drafts requirements, you review and approve them, and only then does the
Designer proceed. Autonomy can expand for low-risk actions over time;
changing approved requirements, modifying code, opening PRs, and deploying
stay gated.

## Goals

- **Learning and portfolio first:** a vehicle for building and explaining the
  systems behind modern AI applications: agent orchestration, tool use,
  structured outputs, state and memory, queues and workers, retries and
  idempotency, observability, evals, provider abstraction, and deployment.
- **Real-product architecture underneath:** genuinely usable, not a throwaway
  demo.
- **Single user for V1:** one developer or technical product builder. The
  architecture leaves room for teams later.

See [docs/roadmap](docs/roadmap/README.md) for the staged roadmap and
[docs/architecture/decisions](docs/architecture/decisions) for architecture
decision records.

## Status

Early development.

## Development

### Requirements

- Node.js 24+
- npm 11+

### Setup

npm install
npm run dev

### Quality Checks

npm run format:check
npm run lint
npm run check-types
npm run test:run
npm run build
