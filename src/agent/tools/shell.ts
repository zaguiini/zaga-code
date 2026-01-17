import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);

/**
 * Creates a LangGraph tool for executing shell commands.
 * Commands are executed in the project directory context.
 * 
 * @param projectPath - The root path of the project directory (used as cwd)
 * @returns A LangGraph tool that executes shell commands
 */
export function shellTool(projectPath: string) {
  const shellSchema = z.object({
    command: z.string().describe("Shell command to execute"),
  });

  return tool(
    async (input: z.infer<typeof shellSchema>) => {
      try {
        const resolvedProjectPath = resolve(projectPath);
        const { stdout, stderr } = await execAsync(input.command, {
          cwd: resolvedProjectPath,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        // Combine stdout and stderr, indicating which is which
        let output = "";
        if (stdout) {
          output += `STDOUT:\n${stdout}`;
        }
        if (stderr) {
          output += output ? `\n\nSTDERR:\n${stderr}` : `STDERR:\n${stderr}`;
        }
        
        return output || "Command executed successfully (no output)";
      } catch (error: any) {
        // execAsync throws an error with stdout/stderr properties
        let errorMessage = `Command failed: ${error.message}`;
        if (error.stdout) {
          errorMessage += `\n\nSTDOUT:\n${error.stdout}`;
        }
        if (error.stderr) {
          errorMessage += `\n\nSTDERR:\n${error.stderr}`;
        }
        return errorMessage;
      }
    },
    {
      name: "shell",
      description: "Execute a shell command in the project directory. Captures both stdout and stderr. No command restrictions for MVP.",
      schema: shellSchema,
    }
  );
}
