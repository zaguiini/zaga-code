import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { resolve, relative, dirname } from "path";

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
 * Creates a LangGraph tool for writing/creating files with path validation.
 * Automatically creates parent directories if they don't exist.
 * 
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that writes files within the project directory
 */
export function fileWriteTool(projectPath: string) {
  const fileWriteSchema = z.object({
    path: z.string().describe("Relative path to the file to write, must be within the project directory"),
    content: z.string().describe("Content to write to the file"),
  });

  return tool(
    async (input: z.infer<typeof fileWriteSchema>) => {
      try {
        const validatedPath = validatePath(input.path, projectPath);
        const directory = dirname(validatedPath);
        
        // Create parent directories if they don't exist
        await mkdir(directory, { recursive: true });
        
        // Write the file
        await writeFile(validatedPath, input.content, "utf-8");
        
        return `Successfully wrote file: ${input.path}`;
      } catch (error) {
        if (error instanceof Error) {
          return `Error writing file: ${error.message}`;
        }
        return `Error writing file: ${String(error)}`;
      }
    },
    {
      name: "file_write",
      description: "Writes or creates a file within the project directory. Automatically creates parent directories if needed. The path must be relative to the project root.",
      schema: fileWriteSchema,
    }
  );
}
