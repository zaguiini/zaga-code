# Next Issue Workflow

## Objective
Automate the complete workflow of picking the next issue, working on it, testing it, closing it, and committing changes.

## Workflow Steps

### 1. Pick the Next Issue
Run `bd ready` to find the next available issue. This command will list issues that are ready to be worked on.

**Action:** Execute `bd ready` and parse the output to identify the issue ID. The output format is:
```
1. [● P0] [epic] zc-xxx: Title
2. [● P1] [task] zc-xxx.y: Title
```
Extract the issue ID from the first item (e.g., "zc-z7f" or "zc-z7f.2"). The issue ID is the part after the brackets and before the colon.

### 2. Move Issue to In Progress
Once you have the issue ID, update its status to `in_progress`:

**Action:** Run `bd update <issue-id> --status in_progress`

**Epic Handling:** If the issue has a parent epic, check if the epic needs to be moved to `in_progress`:
- Run `bd show <issue-id>` to check if there's a parent epic listed under "DEPENDS ON"
- If there's a parent epic with status `open` (shown as "○"), update it: `bd update <epic-id> --status in_progress`

### 3. Get Issue Details
Retrieve the full issue details to understand what needs to be done:

**Action:** Run `bd show <issue-id>` to get the complete issue description, requirements, and any context.

### 4. Work on the Issue
Based on the issue details, implement the required changes:

**Action:**
- Read and understand the issue requirements
- Make the necessary code changes
- Ensure the implementation matches the issue description
- Follow the project's coding standards and patterns

### 5. Test the Changes (if test instructions provided)
If the user has provided test instructions (either in the issue description or separately), run the tests:

**Action:**
- Check if test instructions are mentioned in the issue or provided by the user
- If tests exist, run them using the appropriate test command (e.g., `npm test`, `bun test`, or `vitest run`)
- If tests fail, fix the issues and re-run until they pass
- If no test instructions are provided, skip this step

### 6. Close the Issue
Once the work is complete and tests pass (if applicable), close the issue:

**Action:** Run `bd close <issue-id>`

**Epic Handling:** After closing the issue, check if any epics can be automatically closed:
- Run `bd epic close-eligible` to close any epics where all children are now complete
- This command is safe to run - it only closes epics that are fully done

### 7. Commit the Changes
Commit all changes with a descriptive commit message that references the issue:

**Action:**
- Stage all changes: `git add -A`
- Commit with message: `git commit -m "Fix: <issue-id> - <brief description of changes>"`
- The commit message should reference the issue ID and describe what was fixed

## Important Notes

- **Issue ID Extraction:** The issue ID from `bd ready` output follows the format "zc-xxx" or "zc-xxx.y" (e.g., "zc-z7f" or "zc-z7f.2"). Extract it from the first line of the output, between the brackets and the colon.
- **Error Handling:** If `bd ready` returns no issues, inform the user that there are no available issues to work on.
- **Test Instructions:** Only run tests if explicitly mentioned in the issue description or provided by the user. Don't assume tests are required.
- **Commit Message:** Make the commit message clear and reference the issue ID for traceability.
- **No Push:** This command does NOT push to remote. The user can push manually or use a separate workflow.
- **Epic Status Management:** Epics are automatically moved to `in_progress` when starting work on their first child, and automatically closed when all children are complete using `bd epic close-eligible`.

## Expected Output

After completing the workflow, provide a summary:
- Issue ID that was worked on
- Brief description of changes made
- Test results (if tests were run)
- Commit hash and message
- Epic status updates (if any epics were moved to in_progress or closed)
- Any follow-up actions needed
