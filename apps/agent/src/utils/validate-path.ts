import { resolve } from 'node:path'
/**
 * Validates that a file path is within the project directory
 * to prevent directory traversal attacks.
 *
 * Handles Windows cross-drive paths by checking if the resolved path
 * actually starts with the project path, rather than relying solely
 * on path.relative() which returns absolute paths for cross-drive comparisons.
 */
export function validatePath(filePath: string, projectPath: string): string {
  const resolvedProjectPath = resolve(projectPath)
  const resolvedFilePath = resolve(projectPath, filePath)

  // Normalize paths for comparison (handle trailing slashes)
  const normalizedProjectPath = resolvedProjectPath.replace(/[/\\]$/, '') + '/'
  const normalizedFilePath = resolvedFilePath.replace(/[/\\]$/, '') + '/'

  // Check if the resolved file path is actually within the project directory
  // This handles Windows cross-drive paths where path.relative() returns
  // an absolute path instead of a relative one
  if (!normalizedFilePath.startsWith(normalizedProjectPath)) {
    throw new Error(`Path "${filePath}" is outside the project directory`)
  }

  return resolvedFilePath
}
