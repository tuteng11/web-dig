/* eslint-disable */
/*
 * Generated from contracts/generated/news_graph.schema.json.
 * Do not edit by hand: run `npm run generate:types` from apps/web.
 */

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SOURCE_URL_BLOCKED'
  | 'SOURCE_ACCESS_DENIED'
  | 'SOURCE_FETCH_FAILED'
  | 'UNSUPPORTED_CONTENT'
  | 'EXTRACTION_FAILED'
  | 'SEARCH_NOT_CONFIGURED'
  | 'SEARCH_UNAVAILABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_MODEL_OUTPUT'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'JOB_TIMEOUT'
  | 'MCP_UNAVAILABLE'
  | 'INTERNAL_ERROR';
export type ContentKind = 'post' | 'news' | 'webpage';
export type ContentStatus = 'full_text' | 'excerpt' | 'snippet_only' | 'unavailable';
export type PublicationPrecision = 'timestamp' | 'date' | 'unknown';
export type TimezoneStatus = 'known' | 'unknown';
export type OriginStatus = 'resolved_within_results' | 'provisional' | 'unresolved';
export type RelationshipKind =
  'links_to' | 'references' | 'replies_to' | 'reposts' | 'same_event' | 'follows_up' | 'related_topic';
export type RelationshipMethod = 'source_link' | 'platform_metadata' | 'llm_inference';
export type RelationshipStatus = 'validated' | 'provisional';
export type TreePlacementKind = 'traced_relationship' | 'chronological_only';
export type EvidenceKind = 'text_quote' | 'link' | 'metadata' | 'snippet' | 'search_result';

/**
 * Root type used only to generate the committed shared JSON Schema.
 */
export interface NewsTraceContracts {
  error_envelope: ErrorEnvelope;
  graph: GraphResult;
  node_details: NodeDetails;
}
export interface ErrorEnvelope {
  error: ErrorDetail;
  request_id?: string | null;
}
export interface ErrorDetail {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
}
export interface GraphResult {
  cross_link_ids?: string[];
  graph_revision: number;
  limits?: GraphLimits;
  nodes: SourceNode[];
  omitted_count?: number | null;
  origin_assessment: OriginAssessment;
  relationships: Relationship[];
  research_id: string;
  root_node_id: string | null;
  seed_node_id: string;
  tree_edges: TreeEdge[];
  truncated?: boolean;
  undated_node_ids?: string[];
  warnings?: string[];
}
export interface GraphLimits {
  max_nodes?: number;
  max_relationships?: number;
}
export interface SourceNode {
  author?: string | null;
  canonical_url: string;
  content_hash?: string | null;
  content_kind: ContentKind;
  content_status: ContentStatus;
  discovered_at: string;
  excerpt?: string | null;
  id: string;
  publication: Publication;
  requested_url: string;
  research_id: string;
  retrieved_at: string;
  snapshot_id?: string | null;
  source: SourceInfo;
  title?: string | null;
  updated_at?: string | null;
  warnings?: string[];
}
/**
 * Publication metadata with explicit precision and timezone uncertainty.
 */
export interface Publication {
  date?: string | null;
  evidence_id?: string | null;
  precision: PublicationPrecision;
  raw?: string | null;
  timestamp?: string | null;
  timezone_status: TimezoneStatus;
}
export interface SourceInfo {
  domain: string;
  name?: string | null;
  platform?: string | null;
}
export interface OriginAssessment {
  coverage_notes?: string[];
  earliest_candidate_ids?: string[];
  rationale: string;
  searched_at: string;
  status: OriginStatus;
  timestamp_evidence_ids?: string[];
}
export interface Relationship {
  created_at: string;
  directed: boolean;
  evidence_ids?: string[];
  explanation: string;
  from_node_id: string;
  id: string;
  kind: RelationshipKind;
  method: RelationshipMethod;
  score?: number | null;
  status: RelationshipStatus;
  to_node_id: string;
}
export interface TreeEdge {
  child_id: string;
  discovery_depth: number;
  parent_id: string;
  placement_kind: TreePlacementKind;
  relationship_id?: string | null;
}
export interface NodeDetails {
  coverage_notes?: string[];
  evidence?: Evidence[];
  node: SourceNode;
  relationships?: Relationship[];
  research_id: string;
  snapshot?: SnapshotInfo | null;
  warnings?: string[];
}
export interface Evidence {
  end?: number | null;
  id: string;
  kind: EvidenceKind;
  link_target?: string | null;
  metadata_field?: string | null;
  metadata_value?: string | null;
  node_id: string;
  quote?: string | null;
  retrieved_at: string;
  snapshot_id: string;
  start?: number | null;
}
export interface SnapshotInfo {
  captured_at: string;
  content_hash: string;
  content_status: ContentStatus;
  excerpt?: string | null;
  id: string;
}
