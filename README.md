# Zaga Code

## TODO

- [ ] Tool call correction - some models, especially Qwen, output tool calls within reasoning blocks. Example below
- [ ] Skills (compact conversation, setup project, custom skills) with slash execution
- [ ] Permission management (approval modes: read-only, ask before changes, allow all; save in global settings)
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

## Incorrect tool call within reasoning block

```
Let me look at one of the existing tool files to understand the structure and pattern used for defining tools. <tool_call> <function=file_read> <parameter=path> src/tools/shell.ts </parameter> </function> </tool_call> <tool_call> <function=file_read> <parameter=path> src/tools/file-read.ts </parameter> </function> </tool_call>
```

### Web Search

- Tavily MCP
