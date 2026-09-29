import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { parseSettings, type Settings } from './settings'

const SAVE_DELAY_MS = 500

/** Keeps the settings in memory and saves them to a JSON file shortly after each change. */
export class SettingsStore {
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private pendingSave: Promise<void> = Promise.resolve()

  private constructor(
    private readonly file: string,
    private settings: Settings
  ) {}

  /** Missing or corrupt files give the default settings. */
  static async load(file: string): Promise<SettingsStore> {
    let raw: unknown = null
    try {
      raw = JSON.parse(await readFile(file, 'utf-8'))
    } catch {
      // First run, or a file we cannot read: start from the defaults.
    }
    return new SettingsStore(file, parseSettings(raw))
  }

  get(): Settings {
    return structuredClone(this.settings)
  }

  update(changes: Partial<Omit<Settings, 'version'>>): void {
    this.settings = { ...this.settings, ...structuredClone(changes) }
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  /** Writes pending changes now. Call it before the app quits. */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const snapshot = JSON.stringify(this.settings, null, 2)
    this.pendingSave = this.pendingSave.then(() => this.write(snapshot))
    return this.pendingSave
  }

  private async write(contents: string): Promise<void> {
    // Write to a temporary file first, so a crash never leaves a half-written settings file.
    const temporary = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(temporary, contents, 'utf-8')
    await rename(temporary, this.file)
  }
}
