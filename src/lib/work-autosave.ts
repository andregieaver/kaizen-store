/**
 * The invoice editor's autosave (docs/work.md 7.2 WP6, from Life's 600 ms save with an in-flight queue),
 * without React so it can be tested with fake timers.
 *
 * Nothing is remembered about *what* to save: the queue asks `read()` for the editor's current value when
 * the pause after the last change is over. That is what makes it safe: a row added while a save is on its
 * way is not sent twice (the save that finishes has already given the first row its id, and the next save
 * reads it with that id). Changes made during a save queue exactly one more save behind it. A value is only
 * saved when its `key` differs from the last one saved, so a save that changed nothing is never made, and an
 * invalid form (`read()` returns null) saves nothing and says so.
 */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "invalid" | "error";

export type SaveResult = { ok: true } | { ok: false; message: string };

export type AutosaveOptions<T> = {
  /** The pause after the last change before it is written. */
  delayMs: number;
  /** The value as the editor has it now, with the key that identifies its content; null while the form is not valid. */
  read: () => { value: T; key: string } | null;
  /** Writes the value. Resolves to what happened; a rejection counts as a failed save. */
  save: (value: T) => Promise<SaveResult>;
  onState: (state: SaveState, message?: string) => void;
  /** The key of what the server has when the editor starts. */
  savedKey?: string | null;
};

export const NETWORK_MESSAGE = "The invoice could not be saved. Check your connection and try again.";

export class AutosaveQueue<T> {
  private savedKey: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly options: AutosaveOptions<T>) {
    this.savedKey = options.savedKey ?? null;
  }

  /** Something changed: write it after the pause. Changes made before then share one save. */
  touch(): void {
    if (this.stopped) return;
    if (this.timer !== null) clearTimeout(this.timer);
    const current = this.options.read();
    if (current === null) {
      this.timer = null;
      this.options.onState("invalid");
      return;
    }
    if (current.key === this.savedKey && this.inFlight === null) {
      this.timer = null;
      this.options.onState("saved");
      return;
    }
    if (this.inFlight === null) this.options.onState("pending");
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.options.delayMs);
  }

  /** The editor took in what the server has (it was clean, so nothing is to be saved for it). */
  markSaved(key: string): void {
    this.savedKey = key;
  }

  /** Writes what is waiting now, and resolves to whether everything is saved. */
  async flush(): Promise<boolean> {
    if (this.stopped) return true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (let round = 0; round < 20; round += 1) {
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      const current = this.options.read();
      if (current === null) return false;
      if (current.key === this.savedKey) return true;
      await this.run();
      if (this.failed) return false;
    }
    return false;
  }

  /** After a failure: tries the same thing again at once. */
  retry(): Promise<boolean> {
    return this.flush();
  }

  /** Nothing more is saved (the invoice was deleted or issued). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private failed = false;

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const current = this.options.read();
    if (current === null) {
      this.options.onState("invalid");
      return Promise.resolve();
    }
    if (current.key === this.savedKey) {
      this.options.onState("saved");
      return Promise.resolve();
    }
    this.failed = false;
    this.options.onState("saving");
    const attempt = (async () => {
      let result: SaveResult;
      try {
        result = await this.options.save(current.value);
      } catch {
        result = { ok: false, message: NETWORK_MESSAGE };
      }
      this.inFlight = null;
      if (this.stopped) return;
      if (!result.ok) {
        this.failed = true;
        this.options.onState("error", result.message);
        return;
      }
      this.savedKey = current.key;
      const next = this.options.read();
      if (next === null) {
        this.options.onState("invalid");
      } else if (next.key === this.savedKey) {
        this.options.onState("saved");
      } else if (this.timer === null) {
        // Changed while it was being saved and no pause is running: the one queued save goes now.
        await this.run();
      } else {
        this.options.onState("pending");
      }
    })();
    this.inFlight = attempt;
    return attempt;
  }
}
