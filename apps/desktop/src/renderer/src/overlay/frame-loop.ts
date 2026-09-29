/**
 * Calls `onFrame` at most `framesPerSecond` times per second. The overlay stays on screen all
 * day, so it draws at a modest rate to save battery and GPU time. Returns a stop function.
 */
export function startFrameLoop(
  framesPerSecond: number,
  onFrame: (deltaSeconds: number) => void
): () => void {
  const minimumGapMs = 1000 / framesPerSecond - 1
  let last = performance.now()
  let handle = requestAnimationFrame(tick)

  function tick(now: number): void {
    handle = requestAnimationFrame(tick)
    const elapsed = now - last
    if (elapsed < minimumGapMs) return
    last = now
    // After a long pause (a hidden window, a busy machine), do not jump the animation forward.
    onFrame(Math.min(elapsed / 1000, 0.1))
  }

  return () => cancelAnimationFrame(handle)
}
