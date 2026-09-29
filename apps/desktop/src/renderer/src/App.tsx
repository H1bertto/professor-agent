import { useEffect, useState } from 'react'
import type { CoreHealth } from '../../shared/api'

type CoreStatus = CoreHealth | { status: 'checking' }

function describe(core: CoreStatus): string {
  switch (core.status) {
    case 'checking':
      return 'Checking the core...'
    case 'online':
      return `Core online (v${core.version})`
    case 'offline':
      return `Core offline: ${core.reason}`
  }
}

function App(): React.JSX.Element {
  const [core, setCore] = useState<CoreStatus>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    window.professor.getCoreHealth().then((health) => {
      if (!cancelled) setCore(health)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const checkAgain = async (): Promise<void> => {
    setCore({ status: 'checking' })
    setCore(await window.professor.getCoreHealth())
  }

  return (
    <main className="app">
      <h1>Professor Agent</h1>
      <p className="subtitle">Early development build</p>
      <p className="status" role="status">
        <span className={`dot dot-${core.status}`} aria-hidden="true" />
        {describe(core)}
      </p>
      <button type="button" onClick={checkAgain} disabled={core.status === 'checking'}>
        Check again
      </button>
      <p className="credits">
        3D avatar: Seed-san model by VirtualCast, Inc. (
        <a href="https://vrm.dev/licenses/1.0/" target="_blank" rel="noreferrer">
          VRM Public License 1.0
        </a>
        )
      </p>
    </main>
  )
}

export default App
