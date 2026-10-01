import { useEffect, useState } from 'react'
import type { CoreStatus, SettingsView, VoiceStatusView } from '../../shared/api'
import { SettingsForm } from './SettingsForm'

function describe(core: CoreStatus): string {
  switch (core.connection) {
    case 'online':
      return core.version ? `Core online (v${core.version})` : 'Core online'
    case 'connecting':
      return 'Connecting to the core...'
    case 'offline':
      return 'Core offline. Start it with "uv run professor-core" in the core folder.'
  }
}

function App(): React.JSX.Element {
  const [view, setView] = useState<SettingsView | null>(null)
  const [core, setCore] = useState<CoreStatus>({ connection: 'connecting', version: null })
  const [voice, setVoice] = useState<VoiceStatusView>({
    state: 'off',
    progress: null,
    message: null
  })

  useEffect(() => {
    let active = true
    const stopFollowingCore = window.professor.settings.onCoreStatus(setCore)
    const stopFollowingVoice = window.professor.settings.onVoiceStatus(setVoice)
    window.professor.settings.getCoreStatus().then((status) => {
      if (active) setCore(status)
    })
    window.professor.settings.getVoiceStatus().then((status) => {
      if (active) setVoice(status)
    })
    window.professor.settings.get().then((settings) => {
      if (active) setView(settings)
    })
    return () => {
      active = false
      stopFollowingCore()
      stopFollowingVoice()
    }
  }, [])

  return (
    <main className="app">
      <header>
        <h1>Professor Agent</h1>
        <p className="status" role="status">
          <span className={`dot dot-${core.connection}`} aria-hidden="true" />
          {describe(core)}
        </p>
      </header>

      {view ? (
        <SettingsForm
          view={view}
          voiceStatus={voice}
          coreOnline={core.connection === 'online'}
          onSaved={setView}
        />
      ) : (
        <p>Loading the settings...</p>
      )}

      <footer className="credits">
        3D avatar: Seed-san model by VirtualCast, Inc. (
        <a href="https://vrm.dev/licenses/1.0/" target="_blank" rel="noreferrer">
          VRM Public License 1.0
        </a>
        )
      </footer>
    </main>
  )
}

export default App
