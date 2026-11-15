import { describe, expect, it } from 'vitest'
import type { JobEnvelope, JobEvent } from '../contracts/http'
import { advanceEventCursor, highestEventSeq } from './useJobPolling'

function event(seq: number): JobEvent {
  return {
    seq,
    at: '2026-01-01T00:00:00.000Z',
    stage: 'running',
    message: `event ${seq}`,
  }
}

function events(...seqs: number[]): JobEvent[] {
  return seqs.map(event)
}

function job(envelopeEvents: JobEvent[], nextEventSeq: number): JobEnvelope {
  return {
    schema_version: 1,
    job_id: 'job-1',
    research_id: 'research-1',
    request_id: 'request-1',
    kind: 'discovery',
    status: 'running',
    stage: 'running',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:01.000Z',
    cancel_requested: false,
    result: null,
    error: null,
    events: envelopeEvents,
    next_event_seq: nextEventSeq,
  }
}

describe('job event cursor', () => {
  it('advances to the highest received event, not next_event_seq', () => {
    const envelope = job(events(1, 2, 3, 4), 5)
    expect(envelope.next_event_seq).toBe(5)
    expect(highestEventSeq(envelope.events)).toBe(4)
    expect(advanceEventCursor(0, envelope.events)).toBe(4)
  })

  it('starts at zero for an empty event list', () => {
    expect(highestEventSeq([])).toBe(0)
    expect(advanceEventCursor(0, [])).toBe(0)
  })

  it('advances from 4 to 5 when event seq 5 arrives', () => {
    const envelope = job(events(5), 6)
    expect(advanceEventCursor(4, envelope.events)).toBe(5)
  })

  it('does not move backwards for empty or stale responses', () => {
    expect(advanceEventCursor(4, [])).toBe(4)
    expect(advanceEventCursor(4, events(2, 3))).toBe(4)
  })

  it('ignores a higher next_event_seq when no new events were returned', () => {
    const envelope = job([], 9)
    expect(envelope.next_event_seq).toBe(9)
    expect(advanceEventCursor(4, envelope.events)).toBe(4)
  })
})
