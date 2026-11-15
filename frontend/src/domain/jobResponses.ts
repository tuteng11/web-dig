import type { JobEnvelope, JobKind } from "../contracts/http";

export interface ExpectedJobResponse {
  kind: JobKind;
  jobId?: string;
  researchId?: string;
  requestId?: string;
}

/**
 * Check that a job envelope echoes the identity of the request it answers.
 *
 * The gateway is authoritative for job identity, so a mismatch means the
 * response cannot safely be installed, settled, or treated as a successful
 * cancellation. Omitted optional fields are intentionally not checked.
 */
export function jobResponseMismatch(
  job: JobEnvelope,
  expected: ExpectedJobResponse,
): string | null {
  if (job.kind !== expected.kind) {
    return `Expected a ${expected.kind} job but received ${job.kind}.`;
  }
  if (expected.jobId !== undefined && job.job_id !== expected.jobId) {
    return `Expected job ${expected.jobId} but received ${job.job_id}.`;
  }
  if (
    expected.researchId !== undefined &&
    job.research_id !== expected.researchId
  ) {
    return `Expected research ${expected.researchId} but received ${job.research_id}.`;
  }
  if (
    expected.requestId !== undefined &&
    job.request_id !== expected.requestId
  ) {
    return `Expected request ${expected.requestId} but received ${job.request_id}.`;
  }
  return null;
}
