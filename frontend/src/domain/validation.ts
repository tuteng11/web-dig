import type {
  ContentKind,
  ContentStatus,
  ErrorCode,
  EvidenceKind,
  GraphResult,
  NodeDetails,
  OriginStatus,
  PublicationPrecision,
  RelationshipKind,
  RelationshipMethod,
  RelationshipStatus,
  TimezoneStatus,
  TreePlacementKind,
} from "../contracts/newsTrace";

type Obj = Record<string, unknown>;

const CONTENT_KINDS: readonly ContentKind[] = [
  "post",
  "news",
  "webpage",
];
const CONTENT_STATUSES: readonly ContentStatus[] = [
  "full_text",
  "excerpt",
  "snippet_only",
  "unavailable",
];
const PUBLICATION_PRECISIONS: readonly PublicationPrecision[] = [
  "timestamp",
  "date",
  "unknown",
];
const TIMEZONE_STATUSES: readonly TimezoneStatus[] = ["known", "unknown"];
const ORIGIN_STATUSES: readonly OriginStatus[] = [
  "resolved_within_results",
  "provisional",
  "unresolved",
];
const RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  "links_to",
  "references",
  "replies_to",
  "reposts",
  "same_event",
  "follows_up",
  "related_topic",
];
const RELATIONSHIP_METHODS: readonly RelationshipMethod[] = [
  "source_link",
  "platform_metadata",
  "llm_inference",
];
const RELATIONSHIP_STATUSES: readonly RelationshipStatus[] = [
  "validated",
  "provisional",
];
const PLACEMENT_KINDS: readonly TreePlacementKind[] = [
  "traced_relationship",
  "chronological_only",
];
const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "text_quote",
  "link",
  "metadata",
  "snippet",
  "search_result",
];
const ERROR_CODES: readonly ErrorCode[] = [
  "INVALID_REQUEST",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "SOURCE_URL_BLOCKED",
  "SOURCE_ACCESS_DENIED",
  "SOURCE_FETCH_FAILED",
  "UNSUPPORTED_CONTENT",
  "EXTRACTION_FAILED",
  "SEARCH_NOT_CONFIGURED",
  "SEARCH_UNAVAILABLE",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_MODEL_OUTPUT",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "JOB_TIMEOUT",
  "MCP_UNAVAILABLE",
  "INTERNAL_ERROR",
];
const DIRECTED_KINDS = new Set<RelationshipKind>([
  "links_to",
  "references",
  "replies_to",
  "reposts",
  "follows_up",
]);

const MAX_ERRORS = 40;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

function addError(errors: string[], path: string, message: string): void {
  if (errors.length < MAX_ERRORS) {
    errors.push(path.length > 0 ? `${path}: ${message}` : message);
  }
}

function isRecord(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalStringOrNull(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isAwareTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function validatePublication(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  if (!isEnumValue(value.precision, PUBLICATION_PRECISIONS)) {
    addError(errors, `${path}.precision`, "must be timestamp, date, or unknown");
  }
  if (!isEnumValue(value.timezone_status, TIMEZONE_STATUSES)) {
    addError(
      errors,
      `${path}.timezone_status`,
      "must be known or unknown",
    );
  }

  if (
    value.timestamp !== undefined &&
    value.timestamp !== null &&
    !isAwareTimestamp(value.timestamp)
  ) {
    addError(
      errors,
      `${path}.timestamp`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (
    value.date !== undefined &&
    value.date !== null &&
    !isCalendarDate(value.date)
  ) {
    addError(errors, `${path}.date`, "must be a valid YYYY-MM-DD date");
  }
  if (!isOptionalStringOrNull(value.raw)) {
    addError(errors, `${path}.raw`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.evidence_id)) {
    addError(errors, `${path}.evidence_id`, "must be a string or null");
  }

  if (value.precision === "timestamp") {
    if (!isAwareTimestamp(value.timestamp)) {
      addError(
        errors,
        `${path}.timestamp`,
        "is required when precision is timestamp",
      );
    }
    if (value.timezone_status !== "known") {
      addError(
        errors,
        `${path}.timezone_status`,
        "must be known when precision is timestamp",
      );
    }
  }

  if (value.precision === "date") {
    if (!isCalendarDate(value.date)) {
      addError(
        errors,
        `${path}.date`,
        "is required when precision is date",
      );
    }
    if (value.timestamp !== undefined && value.timestamp !== null) {
      addError(
        errors,
        `${path}.timestamp`,
        "must be null for a date-only publication",
      );
    }
    if (value.timezone_status !== "unknown") {
      addError(
        errors,
        `${path}.timezone_status`,
        "must be unknown for a date-only publication",
      );
    }
  }

  if (value.precision === "unknown") {
    if (value.timestamp !== undefined && value.timestamp !== null) {
      addError(
        errors,
        `${path}.timestamp`,
        "must be null when publication precision is unknown",
      );
    }
    if (value.date !== undefined && value.date !== null) {
      addError(
        errors,
        `${path}.date`,
        "must be null when publication precision is unknown",
      );
    }
    if (value.timezone_status !== "unknown") {
      addError(
        errors,
        `${path}.timezone_status`,
        "must be unknown when publication precision is unknown",
      );
    }
  }
}

function validateSourceNode(
  value: unknown,
  path: string,
  expectedResearchId: string | null,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  for (const key of [
    "id",
    "research_id",
    "requested_url",
    "canonical_url",
  ] as const) {
    if (!isNonEmptyString(value[key])) {
      addError(errors, `${path}.${key}`, "must be a non-empty string");
    }
  }

  if (
    expectedResearchId !== null &&
    isNonEmptyString(value.research_id) &&
    value.research_id !== expectedResearchId
  ) {
    addError(
      errors,
      `${path}.research_id`,
      "must match the enclosing research_id",
    );
  }

  if (!isEnumValue(value.content_kind, CONTENT_KINDS)) {
    addError(errors, `${path}.content_kind`, "is not a supported content kind");
  }
  if (!isEnumValue(value.content_status, CONTENT_STATUSES)) {
    addError(
      errors,
      `${path}.content_status`,
      "is not a supported content status",
    );
  }

  if (!isSafeHttpUrl(value.requested_url)) {
    addError(
      errors,
      `${path}.requested_url`,
      "must be an absolute HTTP(S) URL",
    );
  }
  if (!isSafeHttpUrl(value.canonical_url)) {
    addError(
      errors,
      `${path}.canonical_url`,
      "must be an absolute HTTP(S) URL",
    );
  }

  if (!isRecord(value.source)) {
    addError(errors, `${path}.source`, "must be an object");
  } else {
    if (!isNonEmptyString(value.source.domain)) {
      addError(
        errors,
        `${path}.source.domain`,
        "must be a non-empty string",
      );
    }
    if (!isOptionalStringOrNull(value.source.name)) {
      addError(errors, `${path}.source.name`, "must be a string or null");
    }
    if (!isOptionalStringOrNull(value.source.platform)) {
      addError(
        errors,
        `${path}.source.platform`,
        "must be a string or null",
      );
    }
  }

  validatePublication(value.publication, `${path}.publication`, errors);

  if (!isAwareTimestamp(value.retrieved_at)) {
    addError(
      errors,
      `${path}.retrieved_at`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (!isAwareTimestamp(value.discovered_at)) {
    addError(
      errors,
      `${path}.discovered_at`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (
    value.updated_at !== undefined &&
    value.updated_at !== null &&
    !isAwareTimestamp(value.updated_at)
  ) {
    addError(
      errors,
      `${path}.updated_at`,
      "must be an RFC 3339 timestamp with an explicit offset or null",
    );
  }

  if (!isOptionalStringOrNull(value.author)) {
    addError(errors, `${path}.author`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.title)) {
    addError(errors, `${path}.title`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.excerpt)) {
    addError(errors, `${path}.excerpt`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.snapshot_id)) {
    addError(errors, `${path}.snapshot_id`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.content_hash)) {
    addError(errors, `${path}.content_hash`, "must be a string or null");
  }
  if (!isOptionalStringArray(value.warnings)) {
    addError(errors, `${path}.warnings`, "must be an array of strings");
  }
}

function validateRelationship(
  value: unknown,
  path: string,
  knownNodeIds: ReadonlySet<string> | null,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  if (!isNonEmptyString(value.id)) {
    addError(errors, `${path}.id`, "must be a non-empty string");
  }
  if (!isNonEmptyString(value.from_node_id)) {
    addError(errors, `${path}.from_node_id`, "must be a non-empty string");
  }
  if (!isNonEmptyString(value.to_node_id)) {
    addError(errors, `${path}.to_node_id`, "must be a non-empty string");
  }
  if (!isEnumValue(value.kind, RELATIONSHIP_KINDS)) {
    addError(errors, `${path}.kind`, "is not a supported relationship kind");
  }
  if (!isEnumValue(value.method, RELATIONSHIP_METHODS)) {
    addError(
      errors,
      `${path}.method`,
      "is not a supported relationship method",
    );
  }
  if (!isEnumValue(value.status, RELATIONSHIP_STATUSES)) {
    addError(
      errors,
      `${path}.status`,
      "must be validated or provisional",
    );
  }
  if (typeof value.directed !== "boolean") {
    addError(errors, `${path}.directed`, "must be a boolean");
  }
  if (!isNonEmptyString(value.explanation)) {
    addError(
      errors,
      `${path}.explanation`,
      "must be a non-empty string",
    );
  }
  if (!isAwareTimestamp(value.created_at)) {
    addError(
      errors,
      `${path}.created_at`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (
    value.score !== undefined &&
    value.score !== null &&
    (typeof value.score !== "number" || !Number.isFinite(value.score))
  ) {
    addError(errors, `${path}.score`, "must be a finite number or null");
  }
  if (!isOptionalStringArray(value.evidence_ids)) {
    addError(errors, `${path}.evidence_ids`, "must be an array of strings");
  }

  if (
    isNonEmptyString(value.from_node_id) &&
    isNonEmptyString(value.to_node_id) &&
    value.from_node_id === value.to_node_id
  ) {
    addError(
      errors,
      path,
      "a relationship must connect two distinct nodes",
    );
  }

  if (
    knownNodeIds !== null &&
    isNonEmptyString(value.from_node_id) &&
    !knownNodeIds.has(value.from_node_id)
  ) {
    addError(
      errors,
      `${path}.from_node_id`,
      "must reference a node in this research",
    );
  }
  if (
    knownNodeIds !== null &&
    isNonEmptyString(value.to_node_id) &&
    !knownNodeIds.has(value.to_node_id)
  ) {
    addError(
      errors,
      `${path}.to_node_id`,
      "must reference a node in this research",
    );
  }

  if (isEnumValue(value.kind, RELATIONSHIP_KINDS)) {
    const expectedDirected = DIRECTED_KINDS.has(value.kind);
    if (
      typeof value.directed === "boolean" &&
      value.directed !== expectedDirected
    ) {
      addError(
        errors,
        `${path}.directed`,
        `must be ${String(expectedDirected)} for relationship kind ${value.kind}`,
      );
    }
  }
}

function validateTreeEdge(
  value: unknown,
  path: string,
  knownNodeIds: ReadonlySet<string>,
  relationshipById: ReadonlyMap<string, Obj>,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  if (!isNonEmptyString(value.parent_id)) {
    addError(errors, `${path}.parent_id`, "must be a non-empty string");
    return;
  }
  if (!isNonEmptyString(value.child_id)) {
    addError(errors, `${path}.child_id`, "must be a non-empty string");
    return;
  }
  if (!knownNodeIds.has(value.parent_id)) {
    addError(
      errors,
      `${path}.parent_id`,
      "must reference a node in this graph",
    );
  }
  if (!knownNodeIds.has(value.child_id)) {
    addError(
      errors,
      `${path}.child_id`,
      "must reference a node in this graph",
    );
  }
  if (value.parent_id === value.child_id) {
    addError(errors, path, "a tree edge must connect two distinct nodes");
  }

  if (!isEnumValue(value.placement_kind, PLACEMENT_KINDS)) {
    addError(
      errors,
      `${path}.placement_kind`,
      "must be traced_relationship or chronological_only",
    );
  }
  if (
    typeof value.discovery_depth !== "number" ||
    !Number.isInteger(value.discovery_depth) ||
    value.discovery_depth < 0
  ) {
    addError(
      errors,
      `${path}.discovery_depth`,
      "must be a non-negative integer",
    );
  }
  if (!isOptionalStringOrNull(value.relationship_id)) {
    addError(
      errors,
      `${path}.relationship_id`,
      "must be a string or null",
    );
  }
  const relationship =
    isNonEmptyString(value.relationship_id)
      ? relationshipById.get(value.relationship_id)
      : undefined;
  if (
    isNonEmptyString(value.relationship_id) &&
    relationship === undefined
  ) {
    addError(
      errors,
      `${path}.relationship_id`,
      "must reference a relationship in this graph",
    );
  }
  if (relationship !== undefined) {
    const endpoints = new Set<string>([
      String(relationship.from_node_id),
      String(relationship.to_node_id),
    ]);
    if (
      !endpoints.has(String(value.parent_id)) ||
      !endpoints.has(String(value.child_id))
    ) {
      addError(
        errors,
        `${path}.relationship_id`,
        "must connect this tree edge's parent and child",
      );
    }
    if (
      isEnumValue(relationship.kind, RELATIONSHIP_KINDS) &&
      !DIRECTED_KINDS.has(relationship.kind)
    ) {
      addError(
        errors,
        `${path}.relationship_id`,
        "traced tree edges require a trace relationship kind",
      );
    }
  }
  if (value.placement_kind === "traced_relationship") {
    if (!isNonEmptyString(value.relationship_id)) {
      addError(
        errors,
        `${path}.relationship_id`,
        "is required for traced_relationship placement",
      );
    }
  } else if (
    value.placement_kind === "chronological_only" &&
    value.relationship_id !== undefined &&
    value.relationship_id !== null
  ) {
    addError(
      errors,
      `${path}.relationship_id`,
      "must be null for chronological_only placement",
    );
  }
}

interface OriginShape {
  status: OriginStatus | null;
  candidateIds: string[];
}

function validateOriginAssessment(
  value: unknown,
  path: string,
  errors: string[],
): OriginShape {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return { status: null, candidateIds: [] };
  }

  const status = isEnumValue(value.status, ORIGIN_STATUSES)
    ? value.status
    : null;
  if (!status) {
    addError(
      errors,
      `${path}.status`,
      "must be resolved_within_results, provisional, or unresolved",
    );
  }
  if (!isNonEmptyString(value.rationale)) {
    addError(errors, `${path}.rationale`, "must be a non-empty string");
  }
  if (!isAwareTimestamp(value.searched_at)) {
    addError(
      errors,
      `${path}.searched_at`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }

  let candidateIds: string[] = [];
  if (value.earliest_candidate_ids !== undefined) {
    if (!isStringArray(value.earliest_candidate_ids)) {
      addError(
        errors,
        `${path}.earliest_candidate_ids`,
        "must be an array of strings",
      );
    } else {
      candidateIds = value.earliest_candidate_ids;
      if (new Set(candidateIds).size !== candidateIds.length) {
        addError(
          errors,
          `${path}.earliest_candidate_ids`,
          "must not contain duplicates",
        );
      }
    }
  }

  if (!isOptionalStringArray(value.coverage_notes)) {
    addError(
      errors,
      `${path}.coverage_notes`,
      "must be an array of strings",
    );
  }
  if (!isOptionalStringArray(value.timestamp_evidence_ids)) {
    addError(
      errors,
      `${path}.timestamp_evidence_ids`,
      "must be an array of strings",
    );
  }

  if (status === "unresolved" && candidateIds.length > 0) {
    addError(
      errors,
      `${path}.earliest_candidate_ids`,
      "must be empty when the origin is unresolved",
    );
  }
  if (status !== null && status !== "unresolved" && candidateIds.length === 0) {
    addError(
      errors,
      `${path}.earliest_candidate_ids`,
      "must name at least one candidate when the origin is resolved or provisional",
    );
  }

  return { status, candidateIds };
}

function findTreeCycle(
  parentByChild: ReadonlyMap<string, string>,
): boolean {
  for (const start of parentByChild.keys()) {
    const seen = new Set<string>([start]);
    let cursor: string | undefined = start;
    while (cursor !== undefined) {
      cursor = parentByChild.get(cursor);
      if (cursor === undefined) {
        break;
      }
      if (seen.has(cursor)) {
        return true;
      }
      seen.add(cursor);
    }
  }
  return false;
}

export function validateGraphResult(
  input: unknown,
  expectedResearchId?: string,
): ValidationResult<GraphResult> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return fail(["response: must be a JSON object"]);
  }

  if (!isNonEmptyString(input.research_id)) {
    addError(errors, "research_id", "must be a non-empty string");
  } else if (
    expectedResearchId !== undefined &&
    input.research_id !== expectedResearchId
  ) {
    addError(
      errors,
      "research_id",
      "must match the requested research session",
    );
  }
  if (
    typeof input.graph_revision !== "number" ||
    !Number.isInteger(input.graph_revision) ||
    input.graph_revision < 1
  ) {
    addError(errors, "graph_revision", "must be a positive integer");
  }
  if (!isNonEmptyString(input.seed_node_id)) {
    addError(errors, "seed_node_id", "must be a non-empty string");
  }
  if (
    input.root_node_id !== null &&
    !isNonEmptyString(input.root_node_id)
  ) {
    addError(errors, "root_node_id", "must be a string or null");
  }

  const origin = validateOriginAssessment(
    input.origin_assessment,
    "origin_assessment",
    errors,
  );

  const nodesRaw = input.nodes;
  if (!Array.isArray(nodesRaw)) {
    addError(errors, "nodes", "must be an array");
  }
  const nodes = Array.isArray(nodesRaw) ? nodesRaw : [];
  nodes.forEach((node, index) => {
    validateSourceNode(
      node,
      `nodes[${index}]`,
      isNonEmptyString(input.research_id) ? input.research_id : null,
      errors,
    );
  });

  const nodeIds: string[] = [];
  for (const node of nodes) {
    if (isRecord(node) && isNonEmptyString(node.id)) {
      nodeIds.push(node.id);
    }
  }
  const nodeIdSet = new Set(nodeIds);
  if (nodeIdSet.size !== nodeIds.length) {
    addError(errors, "nodes", "node ids must be unique");
  }

  if (isNonEmptyString(input.seed_node_id)) {
    const matches = nodeIds.filter(
      (id) => id === input.seed_node_id,
    ).length;
    if (matches !== 1) {
      addError(
        errors,
        "seed_node_id",
        "must match exactly one node in this graph",
      );
    }
  }

  const relationshipsRaw = input.relationships;
  if (!Array.isArray(relationshipsRaw)) {
    addError(errors, "relationships", "must be an array");
  }
  const relationships = Array.isArray(relationshipsRaw)
    ? relationshipsRaw
    : [];
  relationships.forEach((relationship, index) => {
    validateRelationship(
      relationship,
      `relationships[${index}]`,
      nodeIdSet,
      errors,
    );
  });

  const relationshipIds: string[] = [];
  const relationshipById = new Map<string, Obj>();
  for (const relationship of relationships) {
    if (isRecord(relationship) && isNonEmptyString(relationship.id)) {
      relationshipIds.push(relationship.id);
      relationshipById.set(relationship.id, relationship);
    }
  }
  const relationshipIdSet = new Set(relationshipIds);
  if (relationshipIdSet.size !== relationshipIds.length) {
    addError(errors, "relationships", "relationship ids must be unique");
  }

  const edgesRaw = input.tree_edges;
  if (!Array.isArray(edgesRaw)) {
    addError(errors, "tree_edges", "must be an array");
  }
  const treeEdges = Array.isArray(edgesRaw) ? edgesRaw : [];
  treeEdges.forEach((edge, index) => {
    validateTreeEdge(
      edge,
      `tree_edges[${index}]`,
      nodeIdSet,
      relationshipById,
      errors,
    );
  });
  const usedTreeRelationships = new Set<string>();
  for (const edge of treeEdges) {
    if (isRecord(edge) && isNonEmptyString(edge.relationship_id)) {
      if (usedTreeRelationships.has(edge.relationship_id)) {
        addError(
          errors,
          "tree_edges",
          `relationship ${edge.relationship_id} labels more than one tree edge`,
        );
      } else {
        usedTreeRelationships.add(edge.relationship_id);
      }
    }
  }

  const parentByChild = new Map<string, string>();
  for (const edge of treeEdges) {
    if (!isRecord(edge)) {
      continue;
    }
    if (
      isNonEmptyString(edge.parent_id) &&
      isNonEmptyString(edge.child_id)
    ) {
      if (parentByChild.has(edge.child_id)) {
        addError(
          errors,
          "tree_edges",
          `node ${edge.child_id} has more than one display parent`,
        );
      } else {
        parentByChild.set(edge.child_id, edge.parent_id);
      }
    }
  }
  if (findTreeCycle(parentByChild)) {
    addError(errors, "tree_edges", "tree edges must not contain a cycle");
  }

  const crossLinkIds = isStringArray(input.cross_link_ids)
    ? input.cross_link_ids
    : [];
  if (
    input.cross_link_ids !== undefined &&
    !isStringArray(input.cross_link_ids)
  ) {
    addError(errors, "cross_link_ids", "must be an array of strings");
  } else if (new Set(crossLinkIds).size !== crossLinkIds.length) {
    addError(errors, "cross_link_ids", "must not contain duplicates");
  }
  for (const relationshipId of crossLinkIds) {
    if (!relationshipIdSet.has(relationshipId)) {
      addError(
        errors,
        "cross_link_ids",
        `relationship ${relationshipId} does not exist`,
      );
    }
    if (usedTreeRelationships.has(relationshipId)) {
      addError(
        errors,
        "cross_link_ids",
        `relationship ${relationshipId} is already a tree edge`,
      );
    }
  }

  const undatedIds = isStringArray(input.undated_node_ids)
    ? input.undated_node_ids
    : [];
  if (
    input.undated_node_ids !== undefined &&
    !isStringArray(input.undated_node_ids)
  ) {
    addError(errors, "undated_node_ids", "must be an array of strings");
  } else if (new Set(undatedIds).size !== undatedIds.length) {
    addError(errors, "undated_node_ids", "must not contain duplicates");
  }

  const placedIds = new Set<string>();
  for (const edge of treeEdges) {
    if (isRecord(edge)) {
      if (isNonEmptyString(edge.child_id)) {
        placedIds.add(edge.child_id);
      }
      if (isNonEmptyString(edge.parent_id)) {
        placedIds.add(edge.parent_id);
      }
    }
  }

  for (const nodeId of undatedIds) {
    if (!nodeIdSet.has(nodeId)) {
      addError(
        errors,
        "undated_node_ids",
        `node ${nodeId} does not exist`,
      );
    }
    if (placedIds.has(nodeId)) {
      addError(
        errors,
        "undated_node_ids",
        `node ${nodeId} must not also appear in tree_edges`,
      );
    }
  }

  for (const candidateId of origin.candidateIds) {
    if (!nodeIdSet.has(candidateId)) {
      addError(
        errors,
        "origin_assessment.earliest_candidate_ids",
        `node ${candidateId} does not exist`,
      );
    }
  }

  if (origin.status === "unresolved") {
    if (input.root_node_id !== null) {
      addError(
        errors,
        "root_node_id",
        "must be null when the origin is unresolved",
      );
    }
  } else if (origin.status !== null) {
    if (!isNonEmptyString(input.root_node_id)) {
      addError(
        errors,
        "root_node_id",
        "must reference a candidate when the origin is resolved or provisional",
      );
    } else {
      if (!nodeIdSet.has(input.root_node_id)) {
        addError(
          errors,
          "root_node_id",
          "must reference a node in this graph",
        );
      }
      if (!origin.candidateIds.includes(input.root_node_id)) {
        addError(
          errors,
          "root_node_id",
          "must be one of the earliest origin candidates",
        );
      }
      if (parentByChild.has(input.root_node_id)) {
        addError(
          errors,
          "root_node_id",
          "must not be a child in the tree projection",
        );
      }
      // A provisional origin may be time-uncertain and therefore legitimately
      // absent from both the dated tree and the placed set. The UI shows it in
      // the time-uncertain lane with an explicit provisional-origin banner.
    }
  }

  if (
    input.truncated !== undefined &&
    typeof input.truncated !== "boolean"
  ) {
    addError(errors, "truncated", "must be a boolean");
  }
  const truncated = input.truncated === true;
  if (
    input.omitted_count !== undefined &&
    input.omitted_count !== null &&
    (typeof input.omitted_count !== "number" ||
      !Number.isInteger(input.omitted_count) ||
      input.omitted_count < 0)
  ) {
    addError(
      errors,
      "omitted_count",
      "must be a non-negative integer or null",
    );
  }
  const omittedCount =
    typeof input.omitted_count === "number" ? input.omitted_count : null;
  if (truncated && (omittedCount === null || omittedCount === 0)) {
    addError(
      errors,
      "omitted_count",
      "must be positive when truncated is true",
    );
  }
  if (!truncated && omittedCount !== null && omittedCount !== 0) {
    addError(
      errors,
      "omitted_count",
      "may only be set when truncated is true",
    );
  }
  if (input.warnings !== undefined && !isStringArray(input.warnings)) {
    addError(errors, "warnings", "must be an array of strings");
  }

  if (errors.length > 0) {
    return fail(errors);
  }

  return pass(input as unknown as GraphResult);
}

function validateEvidence(
  value: unknown,
  path: string,
  expectedNodeId: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  if (!isNonEmptyString(value.id)) {
    addError(errors, `${path}.id`, "must be a non-empty string");
  }
  if (!isNonEmptyString(value.node_id)) {
    addError(errors, `${path}.node_id`, "must be a non-empty string");
  } else if (value.node_id !== expectedNodeId) {
    addError(
      errors,
      `${path}.node_id`,
      "may only reference the inspected node",
    );
  }
  if (!isNonEmptyString(value.snapshot_id)) {
    addError(errors, `${path}.snapshot_id`, "must be a non-empty string");
  }
  if (!isEnumValue(value.kind, EVIDENCE_KINDS)) {
    addError(errors, `${path}.kind`, "is not a supported evidence kind");
  }
  if (!isAwareTimestamp(value.retrieved_at)) {
    addError(
      errors,
      `${path}.retrieved_at`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (!isOptionalStringOrNull(value.quote)) {
    addError(errors, `${path}.quote`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.link_target)) {
    addError(errors, `${path}.link_target`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.metadata_field)) {
    addError(
      errors,
      `${path}.metadata_field`,
      "must be a string or null",
    );
  }
  if (!isOptionalStringOrNull(value.metadata_value)) {
    addError(
      errors,
      `${path}.metadata_value`,
      "must be a string or null",
    );
  }

  for (const key of ["start", "end"] as const) {
    const field = value[key];
    if (
      field !== undefined &&
      field !== null &&
      (typeof field !== "number" ||
        !Number.isInteger(field) ||
        field < 0)
    ) {
      addError(
        errors,
        `${path}.${key}`,
        "must be a non-negative integer or null",
      );
    }
  }

  if (
    (value.start === undefined || value.start === null) !==
    (value.end === undefined || value.end === null)
  ) {
    addError(errors, path, "start and end must be provided together");
  } else if (
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    value.start >= value.end
  ) {
    addError(errors, path, "start must be less than end");
  }

  if (
    value.kind === "link" &&
    !isSafeHttpUrl(value.link_target)
  ) {
    addError(
      errors,
      `${path}.link_target`,
      "is required for link evidence and must be an HTTP(S) URL",
    );
  }
}

function validateSnapshot(
  value: unknown,
  path: string,
  node: Obj,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object or null");
    return;
  }

  if (!isNonEmptyString(value.id)) {
    addError(errors, `${path}.id`, "must be a non-empty string");
  }
  if (!isNonEmptyString(value.content_hash)) {
    addError(errors, `${path}.content_hash`, "must be a non-empty string");
  }
  if (!isAwareTimestamp(value.captured_at)) {
    addError(
      errors,
      `${path}.captured_at`,
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (!isEnumValue(value.content_status, CONTENT_STATUSES)) {
    addError(
      errors,
      `${path}.content_status`,
      "is not a supported content status",
    );
  }
  if (!isOptionalStringOrNull(value.excerpt)) {
    addError(errors, `${path}.excerpt`, "must be a string or null");
  }

  if (
    isNonEmptyString(node.snapshot_id) &&
    isNonEmptyString(value.id) &&
    node.snapshot_id !== value.id
  ) {
    addError(errors, `${path}.id`, "must match the node snapshot_id");
  }
  if (
    isEnumValue(node.content_status, CONTENT_STATUSES) &&
    isEnumValue(value.content_status, CONTENT_STATUSES) &&
    node.content_status !== value.content_status
  ) {
    addError(
      errors,
      `${path}.content_status`,
      "must match the node content_status",
    );
  }
}

export interface ExpectedNodeDetails {
  researchId: string;
  nodeId: string;
  knownNodeIds?: ReadonlySet<string>;
}

export function validateNodeDetails(
  input: unknown,
  expected: ExpectedNodeDetails,
): ValidationResult<NodeDetails> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return fail(["response: must be a JSON object"]);
  }

  if (!isNonEmptyString(input.research_id)) {
    addError(errors, "research_id", "must be a non-empty string");
  } else if (input.research_id !== expected.researchId) {
    addError(
      errors,
      "research_id",
      "must match the requested research",
    );
  }

  validateSourceNode(
    input.node,
    "node",
    expected.researchId,
    errors,
  );

  let node: Obj | null = null;
  if (!isRecord(input.node)) {
    addError(errors, "node", "must be an object");
  } else {
    node = input.node;
    if (
      isNonEmptyString(node.id) &&
      node.id !== expected.nodeId
    ) {
      addError(
        errors,
        "node.id",
        "must match the requested node id",
      );
    }
  }

  const evidenceRaw = input.evidence;
  if (evidenceRaw !== undefined && !Array.isArray(evidenceRaw)) {
    addError(errors, "evidence", "must be an array");
  }
  const evidence = Array.isArray(evidenceRaw) ? evidenceRaw : [];
  evidence.forEach((item, index) => {
    validateEvidence(
      item,
      `evidence[${index}]`,
      expected.nodeId,
      errors,
    );
  });
  const evidenceIds: string[] = [];
  for (const item of evidence) {
    if (isRecord(item) && isNonEmptyString(item.id)) {
      evidenceIds.push(item.id);
    }
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    addError(errors, "evidence", "evidence ids must be unique");
  }

  const relationshipsRaw = input.relationships;
  if (relationshipsRaw !== undefined && !Array.isArray(relationshipsRaw)) {
    addError(errors, "relationships", "must be an array");
  }
  const relationships = Array.isArray(relationshipsRaw)
    ? relationshipsRaw
    : [];
  relationships.forEach((relationship, index) => {
    validateRelationship(
      relationship,
      `relationships[${index}]`,
      expected.knownNodeIds ?? null,
      errors,
    );
    if (
      isRecord(relationship) &&
      relationship.from_node_id !== expected.nodeId &&
      relationship.to_node_id !== expected.nodeId
    ) {
      addError(
        errors,
        `relationships[${index}]`,
        "must touch the inspected node",
      );
    }
  });
  const relationshipIds: string[] = [];
  for (const relationship of relationships) {
    if (isRecord(relationship) && isNonEmptyString(relationship.id)) {
      relationshipIds.push(relationship.id);
    }
  }
  if (new Set(relationshipIds).size !== relationshipIds.length) {
    addError(errors, "relationships", "relationship ids must be unique");
  }

  if (input.snapshot !== undefined && input.snapshot !== null) {
    validateSnapshot(
      input.snapshot,
      "snapshot",
      node ?? {},
      errors,
    );
  } else if (input.snapshot === undefined) {
    // `snapshot` is optional but the generated type models it as null when absent.
  }

  if (!isOptionalStringArray(input.coverage_notes)) {
    addError(errors, "coverage_notes", "must be an array of strings");
  }
  if (!isOptionalStringArray(input.warnings)) {
    addError(errors, "warnings", "must be an array of strings");
  }

  if (errors.length > 0) {
    return fail(errors);
  }

  return pass(input as unknown as NodeDetails);
}

export function isKnownErrorCode(value: unknown): value is ErrorCode {
  return isEnumValue(value, ERROR_CODES);
}
