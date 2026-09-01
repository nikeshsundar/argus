import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { bestAppMatch, type AppEntry } from '../shared/appMatch'

/**
 * Windows ships these without Start menu shortcuts, so a shortcut scan alone
 * can't find them - "open notepad" would fail on a stock machine.
 * The path is a command rather than a .lnk, which `launchApp` handles.
 */
const BUILT_INS: AppEntry[] = [
  { name: 'Notepad', path: 'notepad.exe' },
  { name: 'Calculator', path: 'calc.exe' },
  { name: 'Paint', path: 'mspaint.exe' },
  { name: 'File Explorer', path: 'explorer.exe' },
  { name: 'Task Manager', path: 'taskmgr.exe' },
  { name: 'Windows Terminal', path: 'wt.exe' },
  { name: 'Command Prompt', path: 'cmd.exe' },
  { name: 'PowerShell', path: 'powershell.exe' },
  { name: 'Registry Editor', path: 'regedit.exe' },
  { name: 'Snipping Tool', path: 'snippingtool.exe' },
  { name: 'Settings', path: 'ms-settings:' }
]

/**
 * Where Windows keeps Start menu shortcuts. Reading these gives us the same
 * list of programs the Start menu shows, without parsing the registry.
 */
const START_MENU_DIRS = [
  join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Microsoft/Windows/Start Menu/Programs'),
  join(process.env['APPDATA'] ?? '', 'Microsoft/Windows/Start Menu/Programs')
]

/** Shortcuts that are never what someone means by "open X". */
const IGNORED = /uninstall|readme|documentation|release notes|website|help|manual/i

let cache: AppEntry[] | null = null

async function collectShortcuts(dir: string, depth = 0): Promise<AppEntry[]> {
  if (depth > 4) return []

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // Directory missing or unreadable - just contributes nothing.
  }

  const found: AppEntry[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await collectShortcuts(path, depth + 1)))
      continue
    }
    if (!entry.name.toLowerCase().endsWith('.lnk')) continue
    const name = basename(entry.name, '.lnk')
    if (IGNORED.test(name)) continue
    found.push({ name, path })
  }
  return found
}

/**
 * All installed programs, keyed by their Start menu name.
 *
 * The shortcut itself is launched rather than the executable behind it, so
 * there is no .lnk parsing and the app starts exactly as it would from the
 * Start menu - working directory, arguments and all.
 */
export async function loadAppIndex(refresh = false): Promise<AppEntry[]> {
  if (cache && !refresh) return cache

  const all = (await Promise.all(START_MENU_DIRS.map((dir) => collectShortcuts(dir)))).flat()

  // Same program often appears in both the machine and user Start menus.
  // Real shortcuts win over built-ins, which are only a safety net.
  const unique = new Map<string, AppEntry>()
  for (const entry of [...all, ...BUILT_INS]) {
    const key = entry.name.toLowerCase()
    if (!unique.has(key)) unique.set(key, entry)
  }

  cache = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name))
  return cache
}

/**
 * Opens an installed program by name.
 * Returns the name actually launched, or null when nothing matched.
 */
export async function launchApp(query: string): Promise<string | null> {
  const match = bestAppMatch(query, await loadAppIndex())
  if (!match) return null

  if (match.path.endsWith('.lnk')) {
    const error = await shell.openPath(match.path)
    if (error) throw new Error(`Could not start ${match.name}: ${error}`)
    return match.name
  }

  if (match.path.includes(':') && !match.path.includes('\\')) {
    await shell.openExternal(match.path) // protocol handler, e.g. ms-settings:
    return match.name
  }

  // A bare executable on PATH. Detached so it outlives Argus.
  const child = spawn(match.path, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
  return match.name
}
