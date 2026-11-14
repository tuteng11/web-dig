import type {
  JobEnvelope,
  JobError,
  JobEvent,
  JobKind,
  JobStatus,
} from '../contracts/http'

type Obj = Record<string, unknown>

const JOB_KINDS: readonly JobKind[] = [
  'discovery',
  'expansion',
  'question',
  'add_discoveries',
]
const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]

export type JobValidationResult =
  | { ok: true; value: JobEnvelope }
  | { ok: false; errors: string[] }

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    /(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value)
  )
}

function validateEvent(value: unknown, index: number, errors: string[]): void {
  const path = `events[${index}]`
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`)
    return
  }
  if (
    typeof value.seq !== 'number' ||
    !Number.isInteger(value.seq) ||
    value.seq < 0
  ) {
    errors.push(`${path}.seq: must be a non-negative integer`)
  }
  if (!isTimestamp(value.at)) {
    errors.push(`${path}.at: must be an RFC 3339 timestamp`)
  }
  if (typeof value.stage !== 'string') {
    errors.push(`${path}.stage: must be a string`)
  }
  if (typeof value.message !== 'string') {
    errors.push(`${path}.message: must be a string`)
  }
}

function validateJobError(value: unknown, errors: string[]): void {
  if (value === null) {
    return
  }
  if (!isRecord(value)) {
    errors.push('error: must be an object or null')
    return
  }
  if (!isNonEmptyString(value.code)) {
    errors.push('error.code: must be a non-empty string')
  }
  if (!isNonEmptyString(value.message)) {
    errors.push('error.message: must be a non-empty string')
  }
  if (typeof value.retryable !== 'boolean') {
    errors.push('error.retryable: must be a boolean')
  }
}

/**
 * Defensive job-envelope validation. The raw result stays `unknown` until the
 * App validates it for the specific job kind; this only guards the transport
 * fields polling depends on.
 */
export function validateJobEnvelope(input: unknown): JobValidationResult {
  const errors: string[] = []
  if (!isRecord(input)) {
    return { ok: false, errors: ['response: must be a JSON object'] }
  }

  for (const field of [
    'job_id',
    'research_id',
    'request_id',
  ] as const) {
    if (!isNonEmptyString(input[field])) {
      errors.push(`${field}: must be a non-empty string`)
    }
  }
  if (
    typeof input.schema_version !== 'number' ||
    !Number.isInteger(input.schema_version) ||
    input.schema_version < 1
  ) {
    errors.push('schema_version: must be a positive integer')
  }
  if (
    typeof input.kind !== 'string' ||
    !JOB_KINDS.includes(input.kind as JobKind)
  ) {
    errors.push('kind: must be a supported job kind')
  }
  if (
    typeof input.status !== 'string' ||
    !JOB_STATUSES.includes(input.status as JobStatus)
  ) {
    errors.push('status: must be a supported job status')
  }
  if (!isTimestamp(input.created_at)) {
    errors.push('created_at: must be an RFC 3339 timestamp')
  }
  if (!isTimestamp(input.updated_at)) {
    errors.push('updated_at: must be an RFC 3339 timestamp')
  }
  if (typeof input.cancel_requested !== 'boolean') {
    errors.push('cancel_requested: must be a boolean')
  }
  if (input.stage !== undefined && input.stage !== null) {
    if (typeof input.stage !== 'string') {
      errors.push('stage: must be a string or null')
    }
  }
  if (!Array.isArray(input.events)) {
    errors.push('events: must be an array')
  } else {
    input.events.forEach((event, index) =>
      validateEvent(event as JobEvent, index, errors),
    )
  }
  if (
    typeof input.next_event_seq !== 'number' ||
    !Number.isInteger(input.next_event_seq) ||
    input.next_event_seq < 0
  ) {
    errors.push('next_event_seq: must be a non-negative integer')
  }
  validateJobError(input.error as JobError | null, errors)
  if (input.status === 'failed' && input.error === null) {
    errors.push('error: must be supplied for a failed job')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: input as unknown as JobEnvelope }
}
