# Zaga Code

## TODO

- [ ] Permission management (approval modes: read-only, ask before changes, allow all; save in global settings)
- [ ] Skills (compact conversation, setup project, custom skills) with slash execution
- [ ] Checkpoint restoration (from user message; either as fork to new chat or rewind the current chat, possible to edit message in both cases)
- [ ] Execution hooks
- [ ] Safe editing UX (diff preview, rollback changes)
- [ ] Planning mode (with UX)
- [ ] Worktree/branch setup when creating new thread if git project
- [ ] Langfuse tracing (agent, tool calls, reasoning - under a single trace per session if possible)
- [ ] Deslopify the project: Review implementation, both frontend and backend
- [ ] Document the project
- [ ] CI on commit/push (lint, build, tests)
- [ ] Add evals

## Known issues

Qwen models running on LM Studio often introduce tool calls within reasoning blocks, which breaks the parser and stops execution. I've tried fixing that within the harness through XML parsing but it doesn't seem to work. Switched to `zai-org/glm-4.7-flash` as the default model for this reason. Will revert back once it's fixed in LM Studio.

## Recipes

### Web Search

- Tavily MCP
