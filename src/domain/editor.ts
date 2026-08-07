import type { PageHistory, Placement } from "@/domain/model"

export function appendHistory(history: PageHistory, placements: Placement[], limit = 30): PageHistory {
  const entries = history.entries.slice(0, history.index + 1)
  entries.push(placements)
  if (entries.length > limit) entries.splice(0, entries.length - limit)
  return { entries, index: entries.length - 1 }
}

export function moveHistory(
  history: PageHistory,
  direction: -1 | 1,
): { history: PageHistory; placements: Placement[] } | null {
  const index = history.index + direction
  const placements = history.entries[index]
  if (!placements) return null
  return { history: { ...history, index }, placements }
}
