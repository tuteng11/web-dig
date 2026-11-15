import { describe, expect, it } from 'vitest'
import type { JobEnvelope } from '../contracts/http'
import { jobResponseMismatch } from './jobResponses'

function envelope(overrides: Partial<JobEnvelope> = {}): JobEnvelope {
  return {
    schema_version: 1,
    job_id: 'job-1',
    research_id: 'research-1',
    request_id: 'request-1',
    kind: 'question',
    status: 'queued',
    created_at: '2026-07-12T10:00:00-04:00',
    updated_at: '2026-07-12T10:00:00-04:00',
    cancel_requested: false,
    result: null,
    error: null,
    events: [],
    next_event_seq: 1,
    ...overrides,
  }
}

describe('job response identity', () => {
  it('accepts an exact match', () => {
    expect(
      jobResponseMismatch(envelope(), {
        kind: 'question',
        jobId: 'job-1',
        researchId: 'research-1',
        requestId: 'request-1',
      }),
    ).toBeNull()
  })

  it('rejects a wrong kind', () => {
    const mismatch = jobResponseMismatch(envelope(), {
      kind: 'discovery',
      requestId: 'request-1',
    })

    expect(mismatch).not.toBeNull()
    expect(mismatch).toContain('discovery')
    expect(mismatch).toContain('question')
  })

  it('rejects a wrong research id', () => {
    const mismatch = jobResponseMismatch(envelope(), {
      kind: 'question',
      researchId: 'research-2',
    })

    expect(mismatch).not.toBeNull()
    expect(mismatch).toContain('research-2')
  })

  it('rejects a wrong request id', () => {
    const mismatch = jobResponseMismatch(envelope(), {
      kind: 'question',
      requestId: 'request-2',
    })

    expect(mismatch).not.toBeNull()
    expect(mismatch).toContain('request-2')
  })

  it('rejects a wrong job id', () => {
    const mismatch = jobResponseMismatch(envelope(), {
      kind: 'question',
      jobId: 'job-2',
    })

    expect(mismatch).not.toBeNull()
    expect(mismatch).toContain('job-2')
  })

  it('ignores omitted optional fields', () => {
    expect(
      jobResponseMismatch(
        envelope({
          job_id: 'other-job',
          research_id: 'other-research',
          request_id: 'other-request',
        }),
        { kind: 'question' },
      ),
    ).toBeNull()
  })
})
