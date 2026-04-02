# Zaga Code Improvement Plan

## Goal

Transform zaga-code from a functional web-based coding assistant into a reliable, terminal-native coding agent suitable for daily use. The web UI goes away. A fast, opinionated CLI takes its place.

## Current State

```
User → Web UI → LangGraph API server → agent graph → tools
```

The graph is: `title-generator → system-prompt → executor ⇄ tools`

What's missing:

- No exploration phase before acting (agent guesses at file structure)
- No planning phase (dives straight into implementation)
- No verification (reports done without checking)
- ~~`file-write` overwrites entire files~~ → `file-edit` tool added
- ~~No content search tool~~ → `grep` tool added
- ~~`shell` runs any command with no confirmation~~ → shell-safety checks added
- No context window management (long sessions silently degrade)
- Web interface adds latency, complexity, and a separate server process

## Target State

```
User → Terminal CLI → agent graph (in-process) → tools
```

Graph:

```
command (/compact, /help, etc.)
  ↓ not a command        ↓ handled → END
maybe-compact
  ↓
should-plan (yes/no)
  ↓ yes         ↓ no
explore       system-prompt
subgraph        ↓
  ↓           executor (skips explore/plan)
plan node
  ↓
system-prompt (injects plan + critique feedback)
  ↓
executor ←──────────────────────┐
  ↓                             │
tools ──────────────────────────┘
  ↓ (no more tool calls)
verify subgraph
  ↓ PASS           ↓ FAIL / PARTIAL (attempts < 2)
END         system-prompt (injects failure output)
                    ↓
                executor loop again
```

Two models running simultaneously:

- **Coding model** — executor, verify subgraph
- **Fast model** — explore subgraph, plan node

## Why Each Change Matters

| Change             | Why                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `file-edit` tool   | Full rewrites are token-heavy and break on large files. Surgical edits are safer and cheaper.                         |
| `grep` tool        | Content search is the most common operation during exploration. Shell grep works but returns unstructured text.       |
| Shell confirmation | One bad `rm -rf` ends the session. Confirm destructive patterns before running.                                       |
| Explore subgraph   | Without it, the agent guesses at file locations and makes wrong assumptions.                                          |
| Plan node          | Prevents the agent from diving into implementation before understanding the task.                                     |
| Verify subgraph    | Reports done without checking is the biggest trust problem. PASS/FAIL/PARTIAL verdict with evidence.                  |
| Terminal refactor  | Drops the web server, enables Ctrl+C interruption, inline confirmations, and direct process control.                  |
| Two-model setup    | Fast model handles cheap reasoning (explore, plan). Coding model handles what matters (implementation, verification). |
| Context management | Without it, long sessions silently hit token limits and quality drops.                                                |

## Document Index — Execution Order

Execute in order: **04 → 05 → 06**. Docs 01 (Core Tools), 02 (LLM Setup), and 03 (Context Management) are done.

| Order | Document                                                | Contents                                                     | Est. Time    | Depends On |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------ | ------------ | ---------- |
| ~~1~~ | ~~01 — Core Tools~~                                     | ~~file-edit, grep, shell-safety utility~~                    | ~~2–3h~~     | **DONE**   |
| ~~2~~ | ~~02 — LLM Setup~~                                      | ~~Env config, setup.ts two-model download, model instances~~ | ~~1–2h~~     | **DONE**   |
| ~~3~~ | ~~03 — Context Management~~                             | ~~Token counting utils, summarize util, maybe-compact node~~ | ~~2h~~       | **DONE**   |
| 4     | [04 — Graph Architecture](./04-graph-architecture.md)   | State schema, should-plan, explore/plan/verify, full wiring  | 4–5h         | 02, 03     |
| 5     | [05 — Terminal Refactor](./05-terminal-refactor.md)     | Drop web layer, CLI, REPL, streaming, /compact command       | 3–4h         | 03, 04     |
| 6     | [06 — Enter Planning Mode](./06-enter-planning-mode.md) | Future: model-driven planning trigger, migration from gate   | post-weekend | all        |

**Total: ~12–14h** — a full weekend with buffer.

### Scoping notes (what each doc should NOT do)

- **Doc 02**: Create tool files and the shell-safety utility. Register tools in the existing flat array. Do NOT split into `readOnlyTools` / `allTools` — that happens in 04.
- **Doc 03**: Create utility functions and the `maybe-compact` node function. Do NOT wire it into the graph — that happens in 04.
- **Doc 04**: This is the integration point. Wire all models (01), tools (02), and nodes (03) into the full graph. Remove `title-generator` here. Add the `command` node that handles `/compact`, `/help`, etc. inside the graph. `createAgent()` returns just the compiled graph — all models stay internal.
- **Doc 05**: Drop the web layer, create the CLI app, rename `apps/api/` → `apps/agent/`. No `commands/` directory — the REPL sends everything into the graph. Only `/exit` is handled locally (kills the process).

## Suggested Weekend Schedule

### Saturday

- Morning: Core tools (02) + LLM setup (01)
- Afternoon: Context management (03) + graph architecture (04)

### Sunday

- Morning: Terminal refactor (05) — drop web, CLI with readline
- Afternoon: End-to-end testing on a real task
- Evening: Update AGENTS.md, cleanup

## Constraints

- Keep the LangGraph graph as the core — don't rewrite the execution engine
- Keep Langfuse observability — it's useful for debugging local models
- The `project_path` context pattern works well — keep it
- AGENTS.md injection in system-prompt is worth keeping
