import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile, readdir } from "fs/promises";
import { resolve, relative, join } from "path";
import { stat } from "fs/promises";

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
 * Recursively finds files matching a glob pattern within the project directory.
 * Supports simple patterns like "*.ts" or "**\/*.ts" or specific file paths.
 */
async function findFiles(
    pattern: string,
    projectPath: string,
    maxFiles: number = 100
): Promise<string[]> {
    const resolvedProjectPath = resolve(projectPath);
    const files: string[] = [];
  
    // If pattern doesn't contain wildcards, treat it as a direct file path
    if (!pattern.includes('*') && !pattern.includes('?')) {
        try {
            const validatedPath = validatePath(pattern, projectPath);
            const stats = await stat(validatedPath);
            if (stats.isFile()) {
                files.push(validatedPath);
            }
            return files;
        } catch {
            return files; // File doesn't exist or is invalid
        }
    }
  
    // Simple recursive file finder
    async function searchDirectory(dir: string, relativePattern: string): Promise<void> {
        if (files.length >= maxFiles) return;
    
        try {
            const entries = await readdir(dir, { withFileTypes: true });
      
            for (const entry of entries) {
                if (files.length >= maxFiles) return;
        
                const fullPath = join(dir, entry.name);
                const relPath = relative(resolvedProjectPath, fullPath);
        
                // Skip node_modules, .git, and other common directories
                if (entry.isDirectory()) {
                    if (entry.name.startsWith('.') && entry.name !== '.') continue;
                    if (entry.name === 'node_modules') continue;
                    await searchDirectory(fullPath, relativePattern);
                } else if (entry.isFile()) {
                    // Simple glob matching: convert pattern to regex
                    const regexPattern = relativePattern
                        .replace(/\*\*/g, '.*')
                        .replace(/\*/g, '[^/]*')
                        .replace(/\?/g, '.');
                    const regex = new RegExp(`^${regexPattern}$`);
          
                    if (regex.test(relPath)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch {
            // Ignore permission errors or other issues
        }
    }
  
    await searchDirectory(resolvedProjectPath, pattern);
    return files;
}

/**
 * Creates a LangGraph tool for searching text patterns in files with path validation.
 * 
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that searches for patterns in files within the project directory
 */
export function grepTool(projectPath: string) {
    const grepSchema = z.object({
        pattern: z.string().describe("The text pattern or regular expression to search for"),
        filePattern: z.string().optional().describe("Optional file pattern to search in (e.g., '*.ts', '**/*.ts', or a specific file path). If not provided, searches all files recursively."),
        caseSensitive: z.boolean().optional().default(false).describe("Whether the search should be case-sensitive"),
        maxResults: z.number().optional().default(50).describe("Maximum number of matching lines to return"),
    });

    type GrepInput = z.infer<typeof grepSchema>;

    return tool(
        async (input: GrepInput) => {
            try {
                const searchPattern = input.pattern;
                const filePattern = input.filePattern || "**/*";
                const caseSensitive = input.caseSensitive ?? false;
                const maxResults = input.maxResults ?? 50;
        
                // Find files to search
                const files = await findFiles(filePattern, projectPath);
        
                if (files.length === 0) {
                    return `No files found matching pattern: ${filePattern}`;
                }
        
                // Create regex from search pattern
                let regex: RegExp;
                try {
                    // Try to use as regex first
                    regex = new RegExp(searchPattern, caseSensitive ? 'g' : 'gi');
                } catch {
                    // If not valid regex, escape special characters and use as literal string
                    const escaped = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
                }
        
                const results: Array<{ file: string; line: number; content: string }> = [];
                const resolvedProjectPath = resolve(projectPath);
        
                // Search in each file
                for (const filePath of files) {
                    if (results.length >= maxResults) break;
          
                    try {
                        const content = await readFile(filePath, "utf-8");
                        const lines = content.split('\n');
                        const relativePath = relative(resolvedProjectPath, filePath);
            
                        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                            const line = lines[i];
                            if (regex.test(line)) {
                                results.push({
                                    file: relativePath,
                                    line: i + 1,
                                    content: line.trim(),
                                });
                                // Reset regex lastIndex for next test
                                regex.lastIndex = 0;
                            }
                        }
                    } catch {
                        // Skip files that can't be read
                        continue;
                    }
                }
        
                if (results.length === 0) {
                    return `No matches found for pattern "${searchPattern}" in ${files.length} file(s)`;
                }
        
                // Format results
                const formattedResults = results.map(r => 
                    `${r.file}:${r.line}: ${r.content}`
                ).join('\n');
        
                return `Found ${results.length} match(es) in ${new Set(results.map(r => r.file)).size} file(s):\n\n${formattedResults}`;
            } catch (error) {
                if (error instanceof Error) {
                    return `Error searching files: ${error.message}`;
                }
                return `Error searching files: ${String(error)}`;
            }
        },
        {
            name: "grep",
            description: "Searches for text patterns in files within the project directory. Supports regex patterns and file glob patterns. Returns matching lines with file paths and line numbers.",
            schema: grepSchema,
        }
    );
}
