# 01 — Core Tools

Three tools need to change before anything else. These affect every single interaction.

---

## 1. `file-edit` Tool (highest priority)

### The Problem

`file-write` replaces the entire file. To fix one line in a 400-line file:

1. Model reads the full file (400 lines of tokens)
2. Model outputs the full file with one line changed (400 lines of tokens)
3. Tool writes it back

That's ~800 lines of tokens per edit. On large files it hits context limits. It also introduces bugs — the model occasionally drops or reorders unrelated code during reconstruction.

### Solution

A patch-based edit tool. Give it `old_string` and `new_string`, find the exact match, replace it. The model only needs to output the changed lines.

```typescript
// apps/api/src/tools/file-edit.ts
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'
import { validatePath } from '@/utils/validate-path'

const fileEditSchema = z.object({
  path: z.string().describe('Relative path to the file to edit'),
  old_string: z
    .string()
    .describe('Exact string to replace. Must match exactly, including whitespace and indentation.'),
  new_string: z.string().describe('Replacement string'),
})

const contextSchema = z.object({ project_path: z.string() })

export const fileEditTool = tool(
  async (
    input,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    const validatedPath = validatePath(input.path, project_path)
    const content = await readFile(validatedPath, 'utf-8')

    const occurrences = content.split(input.old_string).length - 1
    if (occurrences === 0) {
      return `Error: old_string not found in ${input.path}. Check for exact whitespace/indentation match.`
    }
    if (occurrences > 1) {
      return `Error: old_string appears ${occurrences} times in ${input.path}. Provide more context to make it unique.`
    }

    const updated = content.replace(input.old_string, input.new_string)
    await writeFile(validatedPath, updated, 'utf-8')
    return `Edited ${input.path}`
  },
  {
    name: 'file_edit',
    description:
      'Make a surgical edit to a file by replacing an exact string. Use this instead of file_write when modifying existing files. old_string must match exactly — include surrounding lines for uniqueness if needed.',
    schema: fileEditSchema,
  }
)
```

### Usage Guidance in System Prompt

Add to `BASE_SYSTEM_PROMPT` in `nodes/system-prompt.ts`:

```
- Prefer file_edit over file_write for modifying existing files.
- Use file_write only for creating new files or complete rewrites.
- When using file_edit, include 2-3 lines of surrounding context in old_string to ensure uniqueness.
```

---

## 2. `grep` Tool

### The Problem

Finding all usages of a function, all imports of a module, or all occurrences of an error string requires shelling out to `grep` or `rg`. This works but:

- Returns unstructured text the model has to parse
- No glob filtering
- The model tends to write fragile grep invocations

### Solution

A first-class grep tool with structured output.

```typescript
// apps/api/src/tools/grep.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'

const execFileAsync = promisify(execFile)

const grepSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  glob: z.string().optional().describe('File glob to limit search, e.g. "**/*.ts" or "src/**"'),
  case_insensitive: z.boolean().optional().default(false),
})

const contextSchema = z.object({ project_path: z.string() })

export const grepTool = tool(
  async (
    input,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    const args = [
      '--line-number',
      '--with-filename',
      '--max-count',
      '50', // cap results
      '--max-filesize',
      '1M', // skip binaries
      input.case_insensitive ? '--ignore-case' : null,
      '--glob',
      '!node_modules',
      '--glob',
      '!.git',
      '--glob',
      '!dist',
      '--glob',
      '!build',
      input.glob ? ['--glob', input.glob] : null,
      input.pattern,
      '.',
    ]
      .flat()
      .filter(Boolean) as string[]

    try {
      const { stdout } = await execFileAsync('rg', args, {
        cwd: project_path,
        maxBuffer: 2 * 1024 * 1024,
      })
      const lines = stdout.trim().split('\n').filter(Boolean)
      if (lines.length === 0) return `No matches for "${input.pattern}"`
      const capped = lines.length === 50 ? `\n(limited to 50 results)` : ''
      return lines.join('\n') + capped
    } catch (err: any) {
      if (err.code === 1) return `No matches for "${input.pattern}"` // rg exits 1 on no match
      return `Search error: ${err.message}`
    }
  },
  {
    name: 'grep',
    description:
      'Search file contents using a regex pattern. Returns filename:line:match format. Use glob to limit to specific file types (e.g. "**/*.ts"). Prefer this over shell+grep for structured results.',
    schema: grepSchema,
  }
)
```

Note: assumes `rg` (ripgrep) is installed. Add a fallback to `grep -r` if not present, or document it as a dependency.

---

## 3. Shell Confirmation for Destructive Commands

### The Problem

`shell` runs any command with `exec`. `rm -rf ./src`, `git reset --hard`, `DROP TABLE` — all execute silently. This will eventually cause a painful accident.

### Solution

Intercept before execution. Match against a list of destructive patterns and require confirmation (or block outright for the worst offenders).

```typescript
// apps/api/src/utils/shell-safety.ts

// Patterns that require user confirmation before running
const CONFIRM_PATTERNS = [
  /\brm\s+(-\w*\s+)*-r/, // rm -r, rm -rf, rm -Rf etc
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-f/,
  /\bgit\s+push\s+.*--force/,
  /\bdrop\s+table/i,
  /\btruncate\s+table/i,
  /\bdelete\s+from\b/i, // SQL DELETE without WHERE is common mistake
  /\bnpm\s+publish\b/,
  /\bpnpm\s+publish\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
]

// Patterns that are always blocked regardless of confirmation
const BLOCK_PATTERNS = [
  /rm\s+(-\w*\s+)*-rf\s+\/(?:\s|$)/, // rm -rf /
  /:\(\)\s*\{.*\}/, // fork bomb
]

export function checkShellSafety(command: string): 'allow' | 'confirm' | 'block' {
  if (BLOCK_PATTERNS.some(p => p.test(command))) return 'block'
  if (CONFIRM_PATTERNS.some(p => p.test(command))) return 'confirm'
  return 'allow'
}
```

In the terminal CLI (see doc 05), a `confirm` result prompts the user before proceeding. In the graph context, `confirm` blocks and returns a message asking for confirmation before re-running.

Update `tools/shell.ts`:

```typescript
const safety = checkShellSafety(input.command)

if (safety === 'block') {
  return `Blocked: "${input.command}" matches a permanently blocked pattern.`
}

if (safety === 'confirm') {
  // In terminal mode: prompt user (see doc 05)
  // In graph mode: return confirmation request
  return `CONFIRMATION_REQUIRED: "${input.command}" is a destructive command. Re-run with confirmed: true to execute.`
}
```

Add `confirmed: z.boolean().optional()` to the shell schema so the model can re-call with explicit confirmation after the user approves.

---

## Tool Registration

Add the new tools to the existing flat tools array in `graphs/agent.ts`:

```typescript
import { fileEditTool } from '@/tools/file-edit'
import { grepTool } from '@/tools/grep'

const tools = [
  fileSearchTool,
  fileReadTool,
  grepTool,
  fileEditTool,
  fileWriteTool,
  shellTool,
  ...(await client.getTools()),
]
```

The split into `readOnlyTools` / `allTools` (for explore subgraph vs executor) happens later in doc 04 (Graph Architecture).
