import type { AnswerView } from '../../../shared/api'
import { hideDelayMs, isFinished, spokenRange, statusLine, subtitleRuns } from './bubble-view'

const api = window.professor.bubble

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

const bubble = element<HTMLElement>('bubble')
const teacher = element<HTMLElement>('teacher')
const question = element<HTMLParagraphElement>('question')
const text = element<HTMLDivElement>('text')
const status = element<HTMLParagraphElement>('status')
const stop = element<HTMLButtonElement>('stop')
const pin = element<HTMLButtonElement>('pin')
const close = element<HTMLButtonElement>('close')

let current: AnswerView | null = null
let pinned = false
let hovered = false
let hideTimer: ReturnType<typeof setTimeout> | undefined

/** A finished answer hides after a while, unless it is pinned or under the mouse. */
function scheduleHide(): void {
  clearTimeout(hideTimer)
  if (!current || pinned || hovered || !isFinished(current.answer)) return
  hideTimer = setTimeout(() => api.dismiss(), hideDelayMs(current.answer))
}

function render({ teacherName, answer }: AnswerView): void {
  teacher.textContent = teacherName
  // A spoken question has no text until the core has heard it.
  question.hidden = !answer.question
  question.textContent = answer.question
  question.title = answer.question

  const followingEnd = text.scrollHeight - text.scrollTop - text.clientHeight < 8
  let spokenSpan: HTMLSpanElement | null = null
  // Text only, never HTML: the answer comes from an AI provider.
  text.replaceChildren(
    ...subtitleRuns(answer.segments, spokenRange(answer)).map((run) => {
      if (!run.lang && !run.spoken) return document.createTextNode(run.text)
      const span = document.createElement('span')
      if (run.lang) span.lang = run.lang
      if (run.spoken) {
        span.className = 'spoken'
        spokenSpan ??= span
      }
      span.textContent = run.text
      return span
    })
  )
  // The subtitles follow the teacher's voice, unless the student is reading with the mouse.
  if (spokenSpan && !hovered) (spokenSpan as HTMLSpanElement).scrollIntoView({ block: 'nearest' })
  else if (followingEnd) text.scrollTop = text.scrollHeight

  const line = statusLine(answer)
  status.hidden = line === null
  status.textContent = line?.text ?? ''
  status.className = line ? `status ${line.kind}` : 'status'
  stop.hidden = isFinished(answer)
  bubble.hidden = false
}

api.onAnswer((view) => {
  current = view
  render(view)
  scheduleHide()
})

stop.addEventListener('click', () => api.cancel())
close.addEventListener('click', () => {
  clearTimeout(hideTimer)
  api.dismiss()
})
pin.addEventListener('click', () => {
  pinned = !pinned
  pin.setAttribute('aria-pressed', String(pinned))
  scheduleHide()
})
bubble.addEventListener('mouseenter', () => {
  hovered = true
  clearTimeout(hideTimer)
})
bubble.addEventListener('mouseleave', () => {
  hovered = false
  scheduleHide()
})

// The window takes the height of the bubble, so the rest of the screen stays clickable.
new ResizeObserver(() => api.resize(Math.ceil(bubble.getBoundingClientRect().height))).observe(
  bubble
)
