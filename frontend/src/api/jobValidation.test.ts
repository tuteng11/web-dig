import { describe, expect, it } from 'vitest'
import { validateJobEnvelope } from './jobValidation'

const base = {
  schema_version: 1,
  job_id: 'job-1',
  research_id: 'research-1',
  request_id: '3a1f4d3e-8f64-4fd5-a20f-9e6a4c4c9d5b',
  kind: 'question',
  status: 'running',
  stage: 'answering',
  created_at: '2026-07-12T10:00:00-04:00',
  updated_at: '2026-07-12T10:00:02-04:00',
  cancel_requested: false,
  result: null,
  error: null,
  events: [
    {
      seq: 1,
      at: '2026-07-12T10:00:01-04:00',
      stage: 'answering',
      message: 'Reading selected sources',
    },
  ],
  next_event_seq: 2,
}

describe('job envelope validation', () => {
  it('accepts a well-formed job', () => {
    expect(validateJobEnvelope(base).ok).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(
      validateJobEnvelope({ ...base, status: 'thinking' }).ok,
    ).toBe(false)
  })

  it('rejects malformed events and cursors', () => {
    const result = validateJobEnvelope({
      ...base,
      events: [{ seq: -1, at: 'not-a-time', stage: 2, message: null }],
      next_event_seq: -1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(2)
  })

  it('rejects a failed job without a typed error', () => {
    expect(
      validateJobEnvelope({ ...base, status: 'failed', error: {} }).ok,
    ).toBe(false)
  })
})
