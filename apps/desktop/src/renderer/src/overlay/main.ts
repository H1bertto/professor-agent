// Temporary test pattern for the overlay window. The avatar renderers replace it.

const canvas = document.getElementById('stage') as HTMLCanvasElement
const context = canvas.getContext('2d')!

function draw(): void {
  const ratio = window.devicePixelRatio
  canvas.width = Math.round(canvas.clientWidth * ratio)
  canvas.height = Math.round(canvas.clientHeight * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

  const size = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.6
  const x = (canvas.clientWidth - size) / 2
  const y = (canvas.clientHeight - size) / 2
  context.fillStyle = 'rgba(47, 111, 219, 0.85)'
  context.beginPath()
  context.roundRect(x, y, size, size, 24)
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = '600 18px system-ui, sans-serif'
  context.textAlign = 'center'
  context.fillText('Professor Agent', canvas.clientWidth / 2, canvas.clientHeight / 2)
}

draw()
window.addEventListener('resize', draw)
window.professor.overlay.ready()
