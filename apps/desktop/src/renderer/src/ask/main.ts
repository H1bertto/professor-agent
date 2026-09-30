const api = window.professor.ask

const form = document.getElementById('ask') as HTMLFormElement
const input = document.getElementById('question') as HTMLInputElement
const hint = document.getElementById('hint') as HTMLParagraphElement

const DEFAULT_HINT = 'Enter to ask. Esc to close.'

function showHint(text: string, isError = false): void {
  hint.textContent = text
  hint.classList.toggle('error', isError)
}

api.onOpened(({ teacherName }) => {
  input.placeholder = `Ask ${teacherName} anything...`
  showHint(DEFAULT_HINT)
  input.focus()
  input.select()
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!input.value.trim()) return
  const result = await api.ask(input.value)
  if (result.ok) input.value = ''
  else showHint(result.message, true)
})

input.addEventListener('input', () => {
  if (hint.classList.contains('error')) showHint(DEFAULT_HINT)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.close()
})

showHint(DEFAULT_HINT)
