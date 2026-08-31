import { describe, expect, it } from 'vitest'
import { rateLimitHeld } from '@/components/SkillTranscript/rateLimitHeld'

describe('rateLimitHeld', () => {
  it('treats a warning as still serving, since the run keeps going', () => {
    expect(rateLimitHeld('allowed_warning')).toBe(false)
  })

  it('treats a rejection as held', () => {
    expect(rateLimitHeld('rejected')).toBe(true)
  })

  it('treats an unknown status as held, so a real stall is never shown as a warning', () => {
    expect(rateLimitHeld('throttled')).toBe(true)
  })
})
