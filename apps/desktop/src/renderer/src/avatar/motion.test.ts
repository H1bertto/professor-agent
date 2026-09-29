import { describe, expect, it } from 'vitest'

import { approach, breathing, clamp, createBlinker, mix, talkingMouth } from './motion'

describe('mix', () => {
  it('blends between two values and stays within them', () => {
    expect(mix(0, 10, 0)).toBe(0)
    expect(mix(0, 10, 0.25)).toBe(2.5)
    expect(mix(0, 10, 1)).toBe(10)
    expect(mix(0, 10, 2)).toBe(10)
    expect(mix(0, 10, -1)).toBe(0)
  })
})

function run(blink: (delta: number) => number, seconds: number, step = 0.01): number[] {
  const values: number[] = []
  for (let t = 0; t < seconds; t += step) values.push(blink(step))
  return values
}

describe('createBlinker', () => {
  it('keeps the eyes open until the first gap passes', () => {
    const blink = createBlinker({ minGap: 2, maxGap: 2, random: () => 0 })
    expect(run(blink, 1.9).every((value) => value === 0)).toBe(true)
  })

  it('closes and reopens the eyes within the blink duration', () => {
    const blink = createBlinker({ minGap: 1, maxGap: 1, duration: 0.2, random: () => 0 })
    const values = run(blink, 1.5)
    const closed = values.filter((value) => value > 0)

    expect(Math.max(...values)).toBeGreaterThan(0.8)
    expect(closed.length).toBeLessThanOrEqual(20)
    expect(values.at(-1)).toBe(0)
  })

  it('blinks again after a new random gap', () => {
    const blink = createBlinker({ minGap: 1, maxGap: 3, duration: 0.1, random: () => 0.5 })
    const values = run(blink, 6.5)
    const starts = values.filter((value, i) => value > 0 && (values[i - 1] ?? 0) === 0)
    expect(starts).toHaveLength(3)
  })
})

describe('breathing', () => {
  it('is a wave between -1 and 1 with the given period', () => {
    expect(breathing(0)).toBeCloseTo(0)
    expect(breathing(1, 4)).toBeCloseTo(1)
    expect(breathing(3, 4)).toBeCloseTo(-1)
  })
})

describe('approach', () => {
  it('moves toward the target without passing it', () => {
    const value = approach(0, 1, 10, 0.1)
    expect(value).toBeGreaterThan(0.5)
    expect(value).toBeLessThan(1)
  })

  it('gives the same result for one big step or many small ones', () => {
    let small = 0
    for (let i = 0; i < 10; i++) small = approach(small, 1, 5, 0.01)
    expect(small).toBeCloseTo(approach(0, 1, 5, 0.1))
  })
})

describe('talkingMouth', () => {
  it('opens and closes the mouth within 0 and 1', () => {
    const values = Array.from({ length: 300 }, (_, i) => talkingMouth(i * 0.01))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThanOrEqual(1)
    expect(Math.max(...values)).toBeGreaterThan(0.6)
    expect(Math.min(...values)).toBeLessThan(0.1)
  })
})

describe('clamp', () => {
  it('limits a value to a range', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
