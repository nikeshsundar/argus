import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Thread, ThreadSummary, Turn } from '../shared/types'

/** Threads older than this many are dropped when a new one is saved. */
const MAX_THREADS = 50

let cache: Thread[] | null = null

function historyPath(): string {
  return join(app.getPath('userData'), 'history.json')
}

function load(): Thread[] {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(historyPath(), 'utf8')) as Thread[]
  } catch {
    cache = [] // No history yet, or the file is unreadable.
  }
  return cache
}

function persist(threads: Thread[]): void {
  cache = threads
  const file = historyPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(threads), 'utf8')
}

/** A thread's name is just its opening question, trimmed to fit a list row. */
function titleFor(turns: Turn[]): string {
  const first = turns.find((turn) => turn.role === 'user')?.text ?? 'Untitled'
  return first.length > 60 ? `${first.slice(0, 57)}…` : first
}

export function createThread(): Thread {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: []
  }
}

/**
 * Writes a thread to disk, newest first.
 *
 * Only the text of a conversation is stored - never the screenshot it was
 * about. Resuming a thread pairs its text with whatever is on screen then.
 */
export function saveThread(thread: Thread): void {
  if (thread.turns.length === 0) return

  const updated: Thread = {
    ...thread,
    title: titleFor(thread.turns),
    updatedAt: Date.now()
  }

  const others = load().filter((existing) => existing.id !== thread.id)
  persist([updated, ...others].slice(0, MAX_THREADS))
}

export function listThreads(limit = 20): ThreadSummary[] {
  return load()
    .slice(0, limit)
    .map(({ id, title, updatedAt, turns }) => ({
      id,
      title,
      updatedAt,
      questions: turns.filter((turn) => turn.role === 'user').length
    }))
}

export function getThread(id: string): Thread | null {
  return load().find((thread) => thread.id === id) ?? null
}

export function clearThreads(): void {
  persist([])
}
