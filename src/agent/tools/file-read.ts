import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "fs/promises";
import { resolve, relative } from "path";

/**
 * Validates that a file path is within the project directory
 * to prevent directory traversal attacks.
 */
function validatePath(filePath: string, projectPath: string): string {
  const resolvedProjectPath = resolve(projectPath);
  const resolvedFilePath = resolve(projectPath, filePath);
  const relativePath = relative(resolvedProjectPath, resolvedFilePath);
  
  // Check if the resolved path is outside the project directory
  if (relativePath.startsWith("..") || relativePath.startsWith("/")) {
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

  return tool(
    async (input: z.infer<typeof fileReadSchema>) => {
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
