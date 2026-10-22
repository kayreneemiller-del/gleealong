import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftSyncer, PermanentSyncError, type SyncStatus } from '../src/lib/draftSync'
import { emptyContent, type ReviewContent } from '../src/lib/types'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}
const withNotes = (notes: string): ReviewContent => ({ ...emptyContent(), notes })

describe('DraftSyncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(send: (c: ReviewContent) => Promise<void>) {
    const storage = new MemStorage()
    const statuses: SyncStatus[] = []
    const s = new DraftSyncer({ key: 'k', send, onStatus: (st) => statuses.push(st), storage, debounceMs: 100 })
    return { s, storage, statuses }
  }

  it('persists locally right away and sends one debounced snapshot', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const { s, storage, statuses } = setup(send)
    s.update(withNotes('a')); s.update(withNotes('ab')); s.update(withNotes('abc'))
    expect(JSON.parse(storage.getItem('k')!).content.notes).toBe('abc')
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].notes).toBe('abc')
    expect(statuses.at(-1)).toBe('saved')
    expect(storage.getItem('k')).toBeNull() // synced => local copy dropped
  })

  it('keeps the draft through network failures and retries with backoff', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { s, storage, statuses } = setup(send)
    s.update(withNotes('hello'))
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses.at(-1)).toBe('offline')
    expect(storage.getItem('k')).not.toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    expect(send).toHaveBeenCalledTimes(3)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('kick() retries immediately when the connection returns', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { s, statuses } = setup(send)
    s.update(withNotes('x'))
    await vi.advanceTimersByTimeAsync(100)
    s.kick()
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('an edit made while a send is in flight is not lost', async () => {
    let release!: () => void
    const send = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { release = r }))
      .mockResolvedValue(undefined)
    const { s, storage } = setup(send)
    s.update(withNotes('one'))
    await vi.advanceTimersByTimeAsync(100)
    s.update(withNotes('two'))
    release()
    await vi.advanceTimersByTimeAsync(500)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].notes).toBe('two')
    expect(storage.getItem('k')).toBeNull()
  })

  it('stops retrying on permanent (server-side) errors', async () => {
    const send = vi.fn().mockRejectedValue(new PermanentSyncError('final'))
    const { s, statuses } = setup(send)
    s.update(withNotes('x'))
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe('error')
  })

  it('a fresh instance finds and resumes an unsynced draft after a reload', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    const a = setup(send)
    a.s.update(withNotes('survive me'))
    a.s.dispose()
    const send2 = vi.fn().mockResolvedValue(undefined)
    const s2 = new DraftSyncer({ key: 'k', send: send2, onStatus: () => {}, storage: a.storage, debounceMs: 100 })
    const stored = s2.loadLocal()!
    expect(stored.dirty).toBe(true)
    s2.resume(stored.content)
    await vi.advanceTimersByTimeAsync(0)
    expect(send2).toHaveBeenCalledWith(expect.objectContaining({ notes: 'survive me' }))
  })
})
