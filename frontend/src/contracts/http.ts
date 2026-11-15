import type {
  ContentStatus,
  ErrorCode,
  Publication,
  RelationshipKind,
  SourceInfo,
} from "./newsTrace";

export type JobKind =
  | "discovery"
  | "expansion"
  | "question"
  | "add_discoveries";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobEvent {
  seq: number;
  at: string;
  stage: string;
  message: string;
}

export interface JobError {
  code: ErrorCode | string;
  message: string;
  retryable: boolean;
}

export interface GraphMutationResult {
  graph_revision: number;
  added_node_ids: string[];
  warnings: string[];
}

export interface SelectedNodePin {
  node_id: string;
  snapshot_id: string | null;
}

export interface AnswerCitation {
  id: string;
  node_id: string;
  snapshot_id: string;
  evidence_id: string;
  quote: string | null;
  start: number | null;
  end: number | null;
  metadata_field?: string | null;
  metadata_value?: string | null;
}

export interface AnswerStatement {
  text: string;
  citation_ids: string[];
}

export interface AdditionalCandidate {
  candidate_id: string;
  url: string;
  title: string | null;
  source: SourceInfo;
  publication: Publication;
  content_status: ContentStatus;
  snippet: string | null;
  relationship_hypothesis: RelationshipKind | null;
}

export interface AnswerResult {
  answer_id: string;
  research_id: string;
  selected_nodes: SelectedNodePin[];
  graph_revision: number;
  question: string;
  outcome: "answered" | "partial" | "insufficient_evidence";
  statements: AnswerStatement[];
  citations: AnswerCitation[];
  limitations: string[];
  additional_candidate_ids: string[];
  additional_candidates?: AdditionalCandidate[];
  model_identity?: string | null;
  completed_at: string;
}

export interface JobEnvelope<T = unknown> {
  schema_version: number;
  job_id: string;
  research_id: string;
  request_id: string;
  kind: JobKind;
  status: JobStatus;
  stage?: string | null;
  created_at: string;
  updated_at: string;
  cancel_requested: boolean;
  result: T | null;
  error: JobError | null;
  events: JobEvent[];
  /**
   * Sequence number the server will assign to the next event
   * (highest existing seq + 1).
   *
   * This is not a valid `after_event_seq` cursor: that parameter is exclusive
   * (`seq > cursor`), so clients must send the highest sequence actually
   * received. See `NewsTraceClient.getJob`.
   */
  next_event_seq: number;
}

export interface StartResearchInput {
  question: string;
  source_url: string;
  request_id: string;
}

export interface ExpandNodeInput {
  node_id: string;
  graph_revision: number;
  request_id: string;
}

export interface AskQuestionInput {
  node_ids: [string, string];
  graph_revision: number;
  question: string;
  request_id: string;
}

export interface AddDiscoveriesInput {
  answer_id: string;
  candidate_ids: string[];
  graph_revision: number;
  request_id: string;
}

export function isTerminalJob(job: JobEnvelope): boolean {
  return (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  );
}
