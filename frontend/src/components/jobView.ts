import type { JobEvent, JobKind, JobStatus } from '../contracts/http'

/**
 * Display-only snapshot of a research job.
 *
 * The raw JobEnvelope contains transport bookkeeping that the workspace does not
 * need. Keep the UI representation explicit so components never invent progress
 * or treat an absent field as a completed stage.
 */
export interface JobView {
  id: string
  kind: JobKind
  status: JobStatus
  stage: string | null
  events: JobEvent[]
  error: string | null
}

export function jobIsActive(job: JobView | null): boolean {
  return job !== null && (job.status === 'queued' || job.status === 'running')
}
