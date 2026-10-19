import { useEffect, useState } from 'react'
import type { AvatarPickerView } from '../../shared/api'
import type { AvatarKind } from '../../shared/avatar'

const KIND_LABEL: Record<AvatarKind, string> = { vrm: '3D', pngtuber: '2D' }

/** The avatar choice. It applies at once, without the Save button. */
export function AvatarPicker(): React.JSX.Element {
  const [view, setView] = useState<AvatarPickerView | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let active = true
    const stop = window.professor.settings.onAvatars(setView)
    window.professor.settings.getAvatars().then((avatars) => {
      if (active) setView(avatars)
    })
    return () => {
      active = false
      stop()
    }
  }, [])

  const choose = (id: string): void => {
    setView((current) => current && { ...current, currentId: id })
    // If the avatar is gone, show the avatars as they are.
    window.professor.settings
      .selectAvatar(id)
      .catch(() => window.professor.settings.getAvatars().then(setView))
  }

  const importAvatar = async (kind: AvatarKind): Promise<void> => {
    setImporting(true)
    try {
      await window.professor.settings.importAvatar(kind)
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="avatars">
      <h2>Avatar</h2>
      {view ? (
        <div className="avatar-grid" role="radiogroup" aria-label="Avatar">
          {view.avatars.map((avatar) => (
            <label key={avatar.id} className="avatar-card">
              <input
                type="radio"
                name="avatar"
                value={avatar.id}
                checked={avatar.id === view.currentId}
                onChange={() => choose(avatar.id)}
              />
              {avatar.thumbnail ? (
                <img src={avatar.thumbnail} alt="" draggable={false} />
              ) : (
                <span className="avatar-placeholder" aria-hidden="true">
                  {avatar.name.slice(0, 1)}
                </span>
              )}
              <span className="avatar-name">{avatar.name}</span>
              <span className="avatar-kind">{KIND_LABEL[avatar.kind]}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="hint">Loading the avatars...</p>
      )}
      <div className="row">
        <button type="button" disabled={importing} onClick={() => void importAvatar('vrm')}>
          Import a VRM file...
        </button>
        <button type="button" disabled={importing} onClick={() => void importAvatar('pngtuber')}>
          Import a PNGTuber folder...
        </button>
      </div>
    </section>
  )
}
