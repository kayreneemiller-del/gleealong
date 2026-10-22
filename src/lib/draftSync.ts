import type { ReviewContent } from './types'

export type SyncStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'offline' | 'error'

/** Thrown by `send` when retrying cannot help (the server said no, not the network). */
export class PermanentSyncError extends Error {}

interface Stored {
  content: ReviewContent
  dirty: boolean
}

export interface DraftSyncerOptions {
  key: string
  send: (content: ReviewContent) => Promise<void>
  onStatus: (status: SyncStatus, detail?: string) => void
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  debounceMs?: number
}

/**
 * Local-first draft autosave.
 *  - Every change is written to local storage immediately (survives reloads, offline, dead tabs).
 *  - A debounced flush sends the FULL latest snapshot (idempotent; retries can't double-count taps).
 *  - Network failures retry with backoff; `kick()` retries now (call on 'online' / tab visible).
 *  - A change made while a send is in flight is never lost: we only clear `dirty` if nothing changed since.
 */
export class DraftSyncer {
  private version = 0
  private latest: ReviewContent | null = null
  private dirty = false
  private inflight = false
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private dead = false
  private readonly storage: DraftSyncerOptions['storage']
  private readonly debounceMs: number

  constructor(private readonly o: DraftSyncerOptions) {
    this.storage = o.storage ?? safeLocalStorage()
    this.debounceMs = o.debounceMs ?? 800
  }

  /** Returns an unsynced local draft, if one exists. */
  loadLocal(): Stored | null {
    try {
      const raw = this.storage?.getItem(this.o.key)
      return raw ? (JSON.parse(raw) as Stored) : null
    } catch {
      return null
    }
  }

  /** Adopt an unsynced local draft found at startup and try to push it. */
  resume(content: ReviewContent) {
    this.latest = content
    this.dirty = true
    this.o.onStatus('dirty')
    this.kick()
  }

  update(content: ReviewContent) {
    this.latest = content
    this.dirty = true
    this.version++
    this.persist()
    if (this.failures === 0) this.o.onStatus('dirty')
    this.schedule(this.debounceMs)
  }

  /** Retry immediately (connection came back, tab refocused, user hit "save now"). */
  kick() {
    if (!this.dirty || this.dead) return
    this.failures = 0
    this.schedule(0)
  }

  /** After a successful submit: drop the local copy. */
  clear() {
    this.dead = true
    clearTimeout(this.timer)
    try { this.storage?.removeItem(this.o.key) } catch { /* ignore */ }
  }

  dispose() {
    this.dead = true
    clearTimeout(this.timer)
  }

  hasUnsynced() { return this.dirty }

  private persist() {
    try {
      this.storage?.setItem(this.o.key, JSON.stringify({ content: this.latest!, dirty: this.dirty } satisfies Stored))
    } catch { /* storage full/blocked: the in-memory copy + network still work */ }
  }

  private schedule(ms: number) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), ms)
  }

  async flush() {
    if (this.dead || this.inflight || !this.dirty || !this.latest) return
    this.inflight = true
    const sentVersion = this.version
    this.o.onStatus('saving')
    try {
      await this.o.send(this.latest)
      this.failures = 0
      if (this.version === sentVersion) {
        this.dirty = false
        try { this.storage?.removeItem(this.o.key) } catch { /* ignore */ }
        this.o.onStatus('saved')
      } else {
        this.schedule(0) // edited mid-flight: send the newer snapshot
      }
    } catch (e) {
      if (e instanceof PermanentSyncError) {
        this.o.onStatus('error', e.message)
      } else {
        this.failures++
        this.o.onStatus('offline')
        this.schedule(Math.min(30_000, 1000 * 2 ** this.failures))
      }
    } finally {
      this.inflight = false
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}
