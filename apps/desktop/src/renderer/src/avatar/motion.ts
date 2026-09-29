// Small, pure building blocks for idle animation, shared by every avatar renderer.

export interface BlinkOptions {
  /** Shortest and longest pause between blinks, in seconds. */
  minGap?: number
  maxGap?: number
  /** How long one blink takes, in seconds. */
  duration?: number
  random?: () => number
}

/** Returns a function that advances time and tells how closed the eyes are: 0 open, 1 closed. */
export function createBlinker(options: BlinkOptions = {}): (deltaSeconds: number) => number {
  const { minGap = 2, maxGap = 6, duration = 0.16, random = Math.random } = options
  const nextGap = (): number => minGap + random() * (maxGap - minGap)

  let untilNextBlink = nextGap()
  let blinkTime: number | null = null

  return (deltaSeconds) => {
    if (blinkTime === null) {
      untilNextBlink -= deltaSeconds
      if (untilNextBlink > 0) return 0
      blinkTime = 0
    }
    blinkTime += deltaSeconds
    if (blinkTime >= duration) {
      blinkTime = null
      untilNextBlink = nextGap()
      return 0
    }
    const progress = blinkTime / duration
    return progress < 0.5 ? progress * 2 : (1 - progress) * 2
  }
}

/** A slow breathing wave between -1 and 1. */
export function breathing(timeSeconds: number, periodSeconds = 4.2): number {
  return Math.sin((2 * Math.PI * timeSeconds) / periodSeconds)
}

/** Moves `current` toward `target` smoothly, independent of the frame rate. */
export function approach(
  current: number,
  target: number,
  rate: number,
  deltaSeconds: number
): number {
  return current + (target - current) * (1 - Math.exp(-rate * deltaSeconds))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A mouth movement that looks like speech: quick syllables inside slower phrases. */
export function talkingMouth(timeSeconds: number): number {
  const syllables = Math.abs(Math.sin(timeSeconds * 11))
  const phrases = 0.5 + 0.5 * Math.sin(timeSeconds * 1.7)
  return clamp(syllables * (0.35 + 0.65 * phrases), 0, 1)
}
