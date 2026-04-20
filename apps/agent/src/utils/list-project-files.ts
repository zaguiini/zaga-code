import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { glob } from 'glob'
import { validatePath } from './validate-path'

const PROJECT_FILE_IGNORES = ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**']

function normalizeIgnorePattern(pattern: string): Array<string> {
  const normalized = pattern.replaceAll('\\', '/')
  const isRooted = normalized.startsWith('/')
  const withoutLeadingSlash = isRooted ? normalized.slice(1) : normalized
  const isNegated = withoutLeadingSlash.startsWith('!')
  if (isNegated || !withoutLeadingSlash) return []

  const isDirPattern = withoutLeadingSlash.endsWith('/')
  const withoutTrailingSlash = isDirPattern ? withoutLeadingSlash.slice(0, -1) : withoutLeadingSlash
  if (!withoutTrailingSlash) return []

  if (isRooted) {
    return [isDirPattern ? `${withoutTrailingSlash}/**` : withoutTrailingSlash]
  }

  if (withoutTrailingSlash.includes('/')) {
    return [isDirPattern ? `${withoutTrailingSlash}/**` : withoutTrailingSlash]
  }

  return isDirPattern
    ? [`${withoutTrailingSlash}/**`, `**/${withoutTrailingSlash}/**`]
    : [withoutTrailingSlash, `**/${withoutTrailingSlash}`]
}

async function loadIgnoreFilePatterns(
  projectPath: string,
  ignoreFileName: '.gitignore' | '.zagaignore'
): Promise<Array<string>> {
  try {
    const ignoreFilePath = path.join(projectPath, ignoreFileName)
    const content = await readFile(ignoreFilePath, 'utf8')

    return content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .flatMap(normalizeIgnorePattern)
  } catch {
    return []
  }
}

export async function listProjectFiles(projectPath: string): Promise<Array<string>> {
  const [gitignorePatterns, zagaignorePatterns] = await Promise.all([
    loadIgnoreFilePatterns(projectPath, '.gitignore'),
    loadIgnoreFilePatterns(projectPath, '.zagaignore'),
  ])

  const ignore = Array.from(
    new Set([...PROJECT_FILE_IGNORES, ...gitignorePatterns, ...zagaignorePatterns])
  )

  const filePaths = await glob('**/*', {
    cwd: projectPath,
    nodir: true,
    ignore,
  })

  return filePaths
    .map(filePath => {
      const absolutePath = validatePath(filePath, projectPath)
      return path.relative(projectPath, absolutePath).split(path.sep).join('/')
    })
    .sort((a, b) => a.localeCompare(b))
}
