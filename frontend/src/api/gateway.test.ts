import { describe, expect, it, vi } from 'vitest'
import { GatewayError, createGatewayClient } from './gateway'

const job = {
  schema_version: 1,
  job_id: 'job-1',
  research_id: 'research-1',
  request_id: 'request-1',
  kind: 'discovery',
  status: 'queued',
  stage: 'queued',
  created_at: '2026-07-12T10:00:00-04:00',
  updated_at: '2026-07-12T10:00:00-04:00',
  cancel_requested: false,
  result: null,
  error: null,
  events: [],
  next_event_seq: 0,
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('gateway client', () => {
  it('posts the research payload to the contract route', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(job, 202))
    const client = createGatewayClient({
      base: '/api/v1',
      fetchImpl: fetchImpl as typeof fetch,
    })
    const result = await client.startResearch({
      question: 'Who reported this first?',
      source_url: 'https://example.com/article',
      request_id: 'request-1',
    })
    expect(result.job_id).toBe('job-1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/v1/research')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(String(init.body))).toMatchObject({
      question: 'Who reported this first?',
      source_url: 'https://example.com/article',
      request_id: 'request-1',
    })
  })

  it('passes the event cursor when polling a job', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(job))
    const client = createGatewayClient({
      base: '/api/v1',
      fetchImpl: fetchImpl as typeof fetch,
    })
    await client.getJob('job 1', 4)
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, RequestInit]
    >
    expect(calls[0]?.[0]).toBe(
      '/api/v1/jobs/job%201?after_event_seq=4',
    )
  })

  it('surfaces a typed safe error envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'VERSION_CONFLICT',
            message: 'The graph revision is stale.',
            retryable: false,
          },
          request_id: 'request-9',
        },
        409,
      ),
    )
    const client = createGatewayClient({
      base: '/api/v1',
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(
      client.expandNode('research-1', {
        node_id: 'a',
        graph_revision: 1,
        request_id: 'request-9',
      }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      retryable: false,
      status: 409,
      requestId: 'request-9',
    })
  })

  it('rejects a malformed job response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...job, status: 'nope' }))
    const client = createGatewayClient({
      base: '/api/v1',
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(
      client.getJob('job-1'),
    ).rejects.toBeInstanceOf(GatewayError)
  })

  it('rejects a malformed error response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: {} }, 503))
    const client = createGatewayClient({
      base: '/api/v1',
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(client.getJob('job-1')).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
      status: 503,
    })
  })
})
