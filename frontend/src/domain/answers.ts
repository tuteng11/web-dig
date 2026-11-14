import type {
  AnswerResult,
  SelectedNodePin,
} from "../contracts/http";
import type {
  ContentStatus,
  RelationshipKind,
} from "../contracts/newsTrace";
import type { ValidationResult } from "./validation";

type Obj = Record<string, unknown>;

const OUTCOMES = [
  "answered",
  "partial",
  "insufficient_evidence",
] as const;
const CONTENT_STATUSES: readonly ContentStatus[] = [
  "full_text",
  "excerpt",
  "snippet_only",
  "unavailable",
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
const MAX_ERRORS = 40;
const AWARE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function isAwareTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    AWARE_TIMESTAMP_PATTERN.test(value) &&
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

  if (
    value.precision !== "timestamp" &&
    value.precision !== "date" &&
    value.precision !== "unknown"
  ) {
    addError(
      errors,
      `${path}.precision`,
      "must be timestamp, date, or unknown",
    );
  }
  if (
    value.timezone_status !== "known" &&
    value.timezone_status !== "unknown"
  ) {
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

function validateSourceInfo(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }
  if (!isNonEmptyString(value.domain)) {
    addError(errors, `${path}.domain`, "must be a non-empty string");
  }
  if (!isOptionalStringOrNull(value.name)) {
    addError(errors, `${path}.name`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.platform)) {
    addError(errors, `${path}.platform`, "must be a string or null");
  }
}

function validateAdditionalCandidate(
  value: unknown,
  path: string,
  declaredIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  if (!isNonEmptyString(value.candidate_id)) {
    addError(errors, `${path}.candidate_id`, "must be a non-empty string");
  } else if (!declaredIds.has(value.candidate_id)) {
    addError(
      errors,
      `${path}.candidate_id`,
      "must appear in additional_candidate_ids",
    );
  }

  if (!isSafeHttpUrl(value.url)) {
    addError(errors, `${path}.url`, "must be an absolute HTTP(S) URL");
  }
  if (!isOptionalStringOrNull(value.title)) {
    addError(errors, `${path}.title`, "must be a string or null");
  }
  if (!isOptionalStringOrNull(value.snippet)) {
    addError(errors, `${path}.snippet`, "must be a string or null");
  }
  if (
    value.relationship_hypothesis !== null &&
    value.relationship_hypothesis !== undefined &&
    !RELATIONSHIP_KINDS.includes(
      value.relationship_hypothesis as RelationshipKind,
    )
  ) {
    addError(
      errors,
      `${path}.relationship_hypothesis`,
      "must be a supported relationship kind or null",
    );
  }

  validateSourceInfo(value.source, `${path}.source`, errors);
  validatePublication(value.publication, `${path}.publication`, errors);

  if (
    typeof value.content_status !== "string" ||
    !CONTENT_STATUSES.includes(value.content_status as ContentStatus)
  ) {
    addError(
      errors,
      `${path}.content_status`,
      "is not a supported content status",
    );
  }
}

function validateCitation(
  value: unknown,
  path: string,
  knownNodeIds: ReadonlySet<string>,
  candidateIds: ReadonlySet<string>,
  errors: string[],
): string | null {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return null;
  }

  let id: string | null = null;
  if (!isNonEmptyString(value.id)) {
    addError(errors, `${path}.id`, "must be a non-empty string");
  } else {
    id = value.id;
  }

  if (!isNonEmptyString(value.node_id)) {
    addError(errors, `${path}.node_id`, "must be a non-empty string");
  } else if (
    !knownNodeIds.has(value.node_id) &&
    !candidateIds.has(value.node_id)
  ) {
    addError(
      errors,
      `${path}.node_id`,
      "must reference a graph node or additional candidate",
    );
  }
  if (!isNonEmptyString(value.snapshot_id)) {
    addError(errors, `${path}.snapshot_id`, "must be a non-empty string");
  }
  if (!isNonEmptyString(value.evidence_id)) {
    addError(errors, `${path}.evidence_id`, "must be a non-empty string");
  }

  if (
    value.quote !== undefined &&
    value.quote !== null &&
    typeof value.quote !== "string"
  ) {
    addError(errors, `${path}.quote`, "must be a string or null");
  } else if (typeof value.quote === "string" && value.quote.length === 0) {
    addError(errors, `${path}.quote`, "must not be an empty string");
  }

  const hasStart = value.start !== undefined && value.start !== null;
  const hasEnd = value.end !== undefined && value.end !== null;
  if (hasStart !== hasEnd) {
    addError(errors, path, "start and end must be provided together");
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
    typeof value.start === "number" &&
    typeof value.end === "number"
  ) {
    if (value.start >= value.end) {
      addError(errors, path, "start must be less than end");
    }
    if (typeof value.quote !== "string" || value.quote.length === 0) {
      addError(
        errors,
        `${path}.quote`,
        "is required when character offsets are provided",
      );
    } else if ([...value.quote].length !== value.end - value.start) {
      addError(
        errors,
        path,
        "quote length must match the character offset range",
      );
    }
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

  return id;
}

function validateStatement(
  value: unknown,
  path: string,
  citationIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (!isRecord(value)) {
    addError(errors, path, "must be an object");
    return;
  }
  if (!isNonEmptyString(value.text)) {
    addError(errors, `${path}.text`, "must be a non-empty string");
  }
  if (!isStringArray(value.citation_ids)) {
    addError(
      errors,
      `${path}.citation_ids`,
      "must be an array of strings",
    );
    return;
  }
  if (value.citation_ids.length === 0) {
    addError(
      errors,
      `${path}.citation_ids`,
      "must contain at least one citation",
    );
  }
  if (new Set(value.citation_ids).size !== value.citation_ids.length) {
    addError(
      errors,
      `${path}.citation_ids`,
      "must not contain duplicates",
    );
  }
  for (const citationId of value.citation_ids) {
    if (!citationIds.has(citationId)) {
      addError(
        errors,
        `${path}.citation_ids`,
        `unknown citation ${citationId}`,
      );
    }
  }
}

export interface ExpectedAnswer {
  researchId: string;
  graphRevision: number;
  nodeIds: [string, string];
  knownNodeIds: ReadonlySet<string>;
  knownCandidateIds?: ReadonlySet<string>;
}

/**
 * Defensive validation for a question JobEnvelope result. A malformed answer
 * must produce an explicit UI error rather than partially rendered statements
 * or citations.
 */
export function validateAnswerResult(
  input: unknown,
  expected: ExpectedAnswer,
): ValidationResult<AnswerResult> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ["response: must be a JSON object"] };
  }

  if (!isNonEmptyString(input.answer_id)) {
    addError(errors, "answer_id", "must be a non-empty string");
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
  if (!isNonEmptyString(input.question)) {
    addError(errors, "question", "must be a non-empty string");
  } else if ([...input.question].length > 2000) {
    addError(errors, "question", "must be at most 2000 code points");
  }
  if (
    typeof input.graph_revision !== "number" ||
    !Number.isInteger(input.graph_revision) ||
    input.graph_revision < 1
  ) {
    addError(errors, "graph_revision", "must be a positive integer");
  } else if (input.graph_revision !== expected.graphRevision) {
    addError(
      errors,
      "graph_revision",
      "must match the revision pinned by the question job",
    );
  }
  if (
    typeof input.outcome !== "string" ||
    !OUTCOMES.includes(
      input.outcome as (typeof OUTCOMES)[number],
    )
  ) {
    addError(
      errors,
      "outcome",
      "must be answered, partial, or insufficient_evidence",
    );
  }
  if (!isAwareTimestamp(input.completed_at)) {
    addError(
      errors,
      "completed_at",
      "must be an RFC 3339 timestamp with an explicit offset",
    );
  }
  if (!isOptionalStringOrNull(input.model_identity)) {
    addError(
      errors,
      "model_identity",
      "must be a string or null when provided",
    );
  }

  if (!isStringArray(input.limitations)) {
    addError(errors, "limitations", "must be an array of strings");
  }

  const additionalIds: string[] = [];
  if (!isStringArray(input.additional_candidate_ids)) {
    addError(
      errors,
      "additional_candidate_ids",
      "must be an array of strings",
    );
  } else {
    additionalIds.push(...input.additional_candidate_ids);
    if (new Set(additionalIds).size !== additionalIds.length) {
      addError(
        errors,
        "additional_candidate_ids",
        "must not contain duplicates",
      );
    }
  }

  const expectedNodeIds = new Set(
    expected.nodeIds.filter((id) => isNonEmptyString(id)),
  );
  if (expectedNodeIds.size !== 2) {
    return {
      ok: false,
      errors: [
        "expected.nodeIds: must contain exactly two distinct node ids",
      ],
    };
  }

  const selectedRaw = input.selected_nodes;
  const selectedPins: SelectedNodePin[] = [];
  if (!Array.isArray(selectedRaw)) {
    addError(errors, "selected_nodes", "must be an array");
  } else if (selectedRaw.length !== 2) {
    addError(
      errors,
      "selected_nodes",
      "must contain exactly two selected nodes",
    );
  } else {
    selectedRaw.forEach((pin, index) => {
      const path = `selected_nodes[${index}]`;
      if (!isRecord(pin)) {
        addError(errors, path, "must be an object");
        return;
      }
      if (!isNonEmptyString(pin.node_id)) {
        addError(errors, `${path}.node_id`, "must be a non-empty string");
        return;
      }
      if (!isOptionalStringOrNull(pin.snapshot_id)) {
        addError(
          errors,
          `${path}.snapshot_id`,
          "must be a string or null",
        );
      }
      selectedPins.push({
        node_id: pin.node_id,
        snapshot_id:
          typeof pin.snapshot_id === "string" ? pin.snapshot_id : null,
      });
    });

    if (selectedPins.length === 2) {
      const selectedIds = new Set(
        selectedPins.map((pin) => pin.node_id),
      );
      if (selectedIds.size !== 2) {
        addError(
          errors,
          "selected_nodes",
          "must reference two distinct nodes",
        );
      }
      for (const id of selectedIds) {
        if (!expectedNodeIds.has(id)) {
          addError(
            errors,
            "selected_nodes",
            `must reference requested node ${id}`,
          );
        }
      }
      for (const id of expectedNodeIds) {
        if (!selectedIds.has(id)) {
          addError(
            errors,
            "selected_nodes",
            `must include requested node ${id}`,
          );
        }
      }
    }
  }

  const candidateIds = new Set<string>(additionalIds);
  if (expected.knownCandidateIds !== undefined) {
    for (const id of expected.knownCandidateIds) {
      candidateIds.add(id);
    }
  }

  const citationIds = new Set<string>();
  const citationsRaw = input.citations;
  if (!Array.isArray(citationsRaw)) {
    addError(errors, "citations", "must be an array");
  } else {
    citationsRaw.forEach((citation, index) => {
      const id = validateCitation(
        citation,
        `citations[${index}]`,
        expected.knownNodeIds,
        candidateIds,
        errors,
      );
      if (id !== null) {
        if (citationIds.has(id)) {
          addError(
            errors,
            `citations[${index}].id`,
            "citation ids must be unique",
          );
        }
        citationIds.add(id);
      }
    });
  }

  const candidatesRaw = input.additional_candidates;
  if (
    candidatesRaw !== undefined &&
    !Array.isArray(candidatesRaw)
  ) {
    addError(
      errors,
      "additional_candidates",
      "must be an array when provided",
    );
  } else if (Array.isArray(candidatesRaw)) {
    const declaredIds = new Set(additionalIds);
    const seenCandidateIds = new Set<string>();
    candidatesRaw.forEach((candidate, index) => {
      validateAdditionalCandidate(
        candidate,
        `additional_candidates[${index}]`,
        declaredIds,
        errors,
      );
      if (
        isRecord(candidate) &&
        isNonEmptyString(candidate.candidate_id)
      ) {
        if (seenCandidateIds.has(candidate.candidate_id)) {
          addError(
            errors,
            `additional_candidates[${index}].candidate_id`,
            "candidate ids must be unique",
          );
        }
        seenCandidateIds.add(candidate.candidate_id);
      }
    });
  }

  const statementsRaw = input.statements;
  let statementCount = 0;
  if (!Array.isArray(statementsRaw)) {
    addError(errors, "statements", "must be an array");
  } else {
    statementCount = statementsRaw.length;
    statementsRaw.forEach((statement, index) => {
      validateStatement(
        statement,
        `statements[${index}]`,
        citationIds,
        errors,
      );
    });
  }

  if (
    input.outcome === "insufficient_evidence" &&
    statementCount > 0
  ) {
    addError(
      errors,
      "statements",
      "must be empty when the outcome is insufficient_evidence",
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as unknown as AnswerResult };
}
