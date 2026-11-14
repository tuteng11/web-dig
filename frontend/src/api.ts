export type Stance = 'Supports' | 'Adds context' | 'Contradicts' | 'Repeats claim' | 'Unclear'
export type Verdict = 'Supported' | 'Partially Supported' | 'Overstated' | 'Contradicted' | 'Insufficient Evidence'

export interface Source {
  id: string
  title: string
  publisher: string
  domain: string
  url: string
  published: string | null
  retrieved_at: string | null
  date_basis: string | null
  kind: 'Primary evidence' | 'Press release' | 'Reporting' | 'Fact check' | 'Other'
  excerpt: string
  excerpt_type: 'Extracted passage' | 'Verified quotation'
  stance: Stance
  interpretation: string
  wording: string
}

export interface Trace {
  mode: 'demo' | 'live'
  claim: string
  input_url: string | null
  verdict: Verdict
  summary: string
  citations: string[]
  earliest_id: string | null
  original_id: string | null
  sources: Source[]
  relationships: { source: string; target: string; proof: string }[]
  warnings: string[]
  retrieval: string
  stored_sources: number
  stored_passages: number
  evidence_cutoff: string | null
  trace_id: string | null
}

export interface Health {
  status: string
  live_configured: boolean
  missing: string[]
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'The API could not complete this request. Try again.')
  }
  return response.json() as Promise<T>
}

export const getHealth = () => request<Health>('/api/health')
export const getSource = (id: string, traceId?: string | null) =>
  request<Source>(`/api/sources/${encodeURIComponent(id)}${traceId ? `?trace_id=${encodeURIComponent(traceId)}` : ''}`)
export const submitTrace = (claim: string, mode: Trace['mode'], signal: AbortSignal) =>
  request<Trace>('/api/trace', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim, mode }), signal,
  })

export function formatDate(value: string | null, short = false) {
  if (!value) return 'Date unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: short ? undefined : 'numeric', timeZone: 'UTC',
  }).format(new Date(value))
}
