export type ValidatedFileReference = {
  id: string
  path: string
  mentionText: string
  start: number
  end: number
}

export type ActiveFileReferenceQuery = {
  query: string
  start: number
  end: number
}

function isFileReferenceChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9._/$-]/.test(char)
}

export function getActiveFileReferenceQuery(
  text: string,
  selectionStart: number,
  selectionEnd: number
): ActiveFileReferenceQuery | null {
  if (selectionStart !== selectionEnd) return null

  const previousChar = text[selectionStart - 1]
  if (previousChar && previousChar !== '@' && !isFileReferenceChar(previousChar)) return null

  let tokenStart = selectionStart - 1
  while (tokenStart >= 0 && isFileReferenceChar(text[tokenStart])) {
    tokenStart--
  }

  if (text[tokenStart] !== '@') return null

  const query = text.slice(tokenStart + 1, selectionStart)
  return {
    query,
    start: tokenStart,
    end: selectionStart,
  }
}

export function replaceRange(
  text: string,
  start: number,
  end: number,
  replacement: string
): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`
}

function findAllIndices(haystack: string, needle: string): Array<number> {
  if (!needle) return []

  const indices: Array<number> = []
  let start = 0

  while (start <= haystack.length) {
    const index = haystack.indexOf(needle, start)
    if (index === -1) break
    indices.push(index)
    start = index + needle.length
  }

  return indices
}

export function syncValidatedFileReferences(
  text: string,
  references: Array<ValidatedFileReference>
): Array<ValidatedFileReference> {
  const groupedByMention = new Map<string, Array<ValidatedFileReference>>()

  for (const reference of references) {
    const group = groupedByMention.get(reference.mentionText)
    if (group) {
      group.push(reference)
      continue
    }

    groupedByMention.set(reference.mentionText, [reference])
  }

  const synced: Array<ValidatedFileReference> = []

  for (const [mentionText, group] of groupedByMention) {
    const occurrences = findAllIndices(text, mentionText)

    if (occurrences.length !== group.length) {
      continue
    }

    const orderedGroup = [...group].sort((a, b) => a.start - b.start)
    for (const [index, reference] of orderedGroup.entries()) {
      const start = occurrences[index]
      synced.push({
        ...reference,
        start,
        end: start + mentionText.length,
      })
    }
  }

  return synced.sort((a, b) => a.start - b.start)
}

export function removeReferenceText(text: string, reference: ValidatedFileReference): string {
  if (text.slice(reference.start, reference.end) !== reference.mentionText) {
    return text
  }

  return replaceRange(text, reference.start, reference.end, '')
}
