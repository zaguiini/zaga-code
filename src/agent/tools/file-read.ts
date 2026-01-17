import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "fs/promises";
import { resolve } from "path";

/**
 * Validates that a file path is within the project directory
 * to prevent directory traversal attacks.
 * 
 * Handles Windows cross-drive paths by checking if the resolved path
 * actually starts with the project path, rather than relying solely
 * on path.relative() which returns absolute paths for cross-drive comparisons.
 */
function validatePath(filePath: string, projectPath: string): string {
  const resolvedProjectPath = resolve(projectPath);
  const resolvedFilePath = resolve(projectPath, filePath);
  
  // Normalize paths for comparison (handle trailing slashes)
  const normalizedProjectPath = resolvedProjectPath.replace(/[/\\]$/, '') + '/';
  const normalizedFilePath = resolvedFilePath.replace(/[/\\]$/, '') + '/';
  
  // Check if the resolved file path is actually within the project directory
  // This handles Windows cross-drive paths where path.relative() returns
  // an absolute path instead of a relative one
  if (!normalizedFilePath.startsWith(normalizedProjectPath)) {
    throw new Error(`Path "${filePath}" is outside the project directory`);
  }
  
  return resolvedFilePath;
}

/**
 * Creates a LangGraph tool for reading file contents with path validation.
 * 
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that reads files within the project directory
 */
export function fileReadTool(projectPath: string) {
  const fileReadSchema = z.object({
    path: z.string().describe("Relative path to the file to read, must be within the project directory"),
  });

  type FileReadInput = z.infer<typeof fileReadSchema>;

  return tool(
    async (input: FileReadInput) => {
      try {
        const validatedPath = validatePath(input.path, projectPath);
        const content = await readFile(validatedPath, "utf-8");
        return content;
      } catch (error) {
        if (error instanceof Error) {
          return `Error reading file: ${error.message}`;
        }
        return `Error reading file: ${String(error)}`;
      }
    },
    {
      name: "file_read",
      description: "Reads the contents of a file within the project directory. The path must be relative to the project root.",
      schema: fileReadSchema,
    }
  );
}
