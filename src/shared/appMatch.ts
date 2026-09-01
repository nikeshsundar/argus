/** Strips case, spaces, and punctuation so "VS Code" and "vscode" compare equal. */
export function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * How well an installed app's name answers a query, 0 (no match) to 100.
 *
 * Deliberately simple and explainable: users say "vscode" or "vs code" for
 * "Visual Studio Code", and a shortcut name often carries extra words
 * ("Google Chrome", "Visual Studio Code (User)").
 */
/** Splits an app name into its lowercase words. */
function wordsOf(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * True when the query is built from prefixes of the name's words, in order.
 * This is what makes "vscode" find "Visual Studio Code": v + s + code.
 */
function matchesWordPrefixes(query: string, appName: string): boolean {
  let consumed = 0
  for (const word of wordsOf(appName)) {
    if (consumed >= query.length) break
    let length = 0
    while (
      length < word.length &&
      consumed + length < query.length &&
      query[consumed + length] === word[length]
    ) {
      length++
    }
    consumed += length
  }
  return consumed === query.length
}

export function scoreAppMatch(query: string, appName: string): number {
  const q = normalise(query)
  const name = normalise(appName)
  if (!q || !name) return 0

  if (q === name) return 100

  // A whole-word hit beats a prefix one: "chrome" should mean Google Chrome,
  // not Chrome Remote Desktop, and both are then separated by name length.
  const nameWords = wordsOf(appName)
  const queryWords = wordsOf(query)
  if (queryWords.length > 0) {
    const joined = nameWords.join(' ')
    if (nameWords.includes(q) || joined.includes(queryWords.join(' '))) return 90
  }

  if (matchesWordPrefixes(q, appName)) return 80
  if (name.startsWith(q)) return 75
  if (name.includes(q)) return 70
  if (queryWords.length > 1 && queryWords.every((word) => name.includes(normalise(word)))) return 60

  return 0
}

export interface AppEntry {
  name: string
  path: string
}

/** Best match for a query, or null when nothing scores above the floor. */
export function bestAppMatch(query: string, entries: AppEntry[]): AppEntry | null {
  let best: AppEntry | null = null
  let bestScore = 0

  for (const entry of entries) {
    const score = scoreAppMatch(query, entry.name)
    // Ties go to the shorter name: "Chrome" beats "Chrome Remote Desktop".
    if (score > bestScore || (score === bestScore && best && entry.name.length < best.name.length)) {
      if (score === 0) continue
      best = entry
      bestScore = score
    }
  }

  return bestScore >= 55 ? best : null
}
