import type {
  ContentKind,
  GraphResult,
  Relationship,
  RelationshipKind,
  SourceNode,
} from "../contracts/newsTrace";
import {
  contentKindLabel,
  relationshipKindLabel,
} from "./nodes";

export interface NodeFilters {
  query: string;
  contentKind: ContentKind | "all";
  sourceDomain: string | "all";
  relationshipKind: RelationshipKind | "all";
  publishedFrom: string;
  publishedTo: string;
}

export const EMPTY_FILTERS: NodeFilters = {
  query: "",
  contentKind: "all",
  sourceDomain: "all",
  relationshipKind: "all",
  publishedFrom: "",
  publishedTo: "",
};

const CONTENT_KINDS: readonly ContentKind[] = ["post", "news", "webpage"];
const RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  "links_to",
  "references",
  "replies_to",
  "reposts",
  "same_event",
  "follows_up",
  "related_topic",
];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarDate(value: string): boolean {
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

function isContentKind(value: unknown): value is ContentKind {
  return (
    typeof value === "string" &&
    CONTENT_KINDS.includes(value as ContentKind)
  );
}

function isRelationshipKind(value: unknown): value is RelationshipKind {
  return (
    typeof value === "string" &&
    RELATIONSHIP_KINDS.includes(value as RelationshipKind)
  );
}

export function hasActiveFilters(filters: NodeFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.contentKind !== "all" ||
    filters.sourceDomain !== "all" ||
    filters.relationshipKind !== "all" ||
    filters.publishedFrom.length > 0 ||
    filters.publishedTo.length > 0
  );
}

/**
 * Return the publication date that can honestly be compared against a
 * calendar-date filter. Timestamps contribute their reported calendar date
 * (the date part is not converted to the browser zone). Undated and
 * unknown-precision sources are excluded while a date range is active.
 */
function publicationDateKey(node: SourceNode): string | null {
  const publication = node.publication;
  if (
    publication.precision === "date" &&
    typeof publication.date === "string" &&
    isCalendarDate(publication.date)
  ) {
    return publication.date;
  }
  if (
    publication.precision === "timestamp" &&
    typeof publication.timestamp === "string"
  ) {
    const key = publication.timestamp.slice(0, 10);
    return isCalendarDate(key) ? key : null;
  }
  return null;
}

function relationshipKindsByNode(
  relationships: Relationship[],
): Map<string, Set<RelationshipKind>> {
  const byNode = new Map<string, Set<RelationshipKind>>();
  const add = (nodeId: string, kind: RelationshipKind): void => {
    const kinds = byNode.get(nodeId) ?? new Set<RelationshipKind>();
    kinds.add(kind);
    byNode.set(nodeId, kinds);
  };

  for (const relationship of relationships) {
    add(relationship.from_node_id, relationship.kind);
    add(relationship.to_node_id, relationship.kind);
  }

  return byNode;
}

function queryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function searchableFields(
  node: SourceNode,
  relationshipKinds: ReadonlySet<RelationshipKind>,
): string[] {
  const publication = node.publication;
  const fields: Array<string | null | undefined> = [
    node.title,
    node.author,
    node.excerpt,
    node.canonical_url,
    node.requested_url,
    node.source.name,
    node.source.domain,
    node.source.platform,
    node.content_kind,
    contentKindLabel(node.content_kind),
    publication.date,
    publication.timestamp,
    publication.raw,
  ];

  for (const kind of relationshipKinds) {
    fields.push(kind, relationshipKindLabel(kind));
  }

  return fields
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.toLowerCase());
}

function matchesQuery(
  node: SourceNode,
  tokens: string[],
  relationshipKinds: ReadonlySet<RelationshipKind>,
): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const fields = searchableFields(node, relationshipKinds);
  return tokens.every((token) =>
    fields.some((field) => field.includes(token)),
  );
}

/**
 * Filter the current graph without touching the stored origin assessment.
 * Ancestors of matching nodes are returned separately as dimmed context so a
 * match remains visibly connected to its tree placement.
 */
export function filterGraphNodes(
  graph: GraphResult,
  filters: NodeFilters,
): {
  matchedIds: Set<string>;
  contextIds: Set<string>;
} {
  const matchedIds = new Set<string>();
  const contextIds = new Set<string>();
  if (!hasActiveFilters(filters)) {
    for (const node of graph.nodes) {
      matchedIds.add(node.id);
    }
    return { matchedIds, contextIds };
  }

  const tokens = queryTokens(filters.query);
  const relationshipKinds = relationshipKindsByNode(graph.relationships);
  const domain =
    filters.sourceDomain === "all"
      ? null
      : filters.sourceDomain.trim().toLowerCase();
  const publishedFrom = isCalendarDate(filters.publishedFrom)
    ? filters.publishedFrom
    : null;
  const publishedTo = isCalendarDate(filters.publishedTo)
    ? filters.publishedTo
    : null;
  const impossibleRange =
    publishedFrom !== null &&
    publishedTo !== null &&
    publishedFrom > publishedTo;

  if (!impossibleRange) {
    for (const node of graph.nodes) {
      if (
        filters.contentKind !== "all" &&
        node.content_kind !== filters.contentKind
      ) {
        continue;
      }

      if (
        domain !== null &&
        node.source.domain.trim().toLowerCase() !== domain
      ) {
        continue;
      }

      const kinds = relationshipKinds.get(node.id) ?? new Set();
      if (
        filters.relationshipKind !== "all" &&
        !kinds.has(filters.relationshipKind)
      ) {
        continue;
      }

      if (publishedFrom !== null || publishedTo !== null) {
        const dateKey = publicationDateKey(node);
        if (dateKey === null) {
          continue;
        }
        if (publishedFrom !== null && dateKey < publishedFrom) {
          continue;
        }
        if (publishedTo !== null && dateKey > publishedTo) {
          continue;
        }
      }

      if (!matchesQuery(node, tokens, kinds)) {
        continue;
      }

      matchedIds.add(node.id);
    }
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const parentByChild = new Map<string, string>();
  for (const edge of graph.tree_edges) {
    if (
      nodeIds.has(edge.parent_id) &&
      nodeIds.has(edge.child_id) &&
      !parentByChild.has(edge.child_id)
    ) {
      parentByChild.set(edge.child_id, edge.parent_id);
    }
  }

  for (const matchedId of matchedIds) {
    const seen = new Set<string>([matchedId]);
    let cursor = parentByChild.get(matchedId);
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      if (!matchedIds.has(cursor)) {
        contextIds.add(cursor);
      }
      cursor = parentByChild.get(cursor);
    }
  }

  return { matchedIds, contextIds };
}

export function filterToQueryString(filters: NodeFilters): string {
  const params = new URLSearchParams();
  const query = filters.query.trim();
  if (query.length > 0) {
    params.set("q", query);
  }
  if (filters.contentKind !== "all") {
    params.set("content", filters.contentKind);
  }
  if (filters.sourceDomain !== "all" && filters.sourceDomain.length > 0) {
    params.set("domain", filters.sourceDomain);
  }
  if (filters.relationshipKind !== "all") {
    params.set("relationship", filters.relationshipKind);
  }
  if (isCalendarDate(filters.publishedFrom)) {
    params.set("from", filters.publishedFrom);
  }
  if (isCalendarDate(filters.publishedTo)) {
    params.set("to", filters.publishedTo);
  }
  return params.toString();
}

export function filtersFromQueryString(search: string): NodeFilters {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ...EMPTY_FILTERS };
  }

  const content = params.get("content");
  const relationship = params.get("relationship");
  const domain = params.get("domain")?.trim() ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  return {
    query: params.get("q") ?? "",
    contentKind: isContentKind(content) ? content : "all",
    sourceDomain: domain.length > 0 ? domain : "all",
    relationshipKind: isRelationshipKind(relationship)
      ? relationship
      : "all",
    publishedFrom: isCalendarDate(from) ? from : "",
    publishedTo: isCalendarDate(to) ? to : "",
  };
}

export function isNodeFilters(value: unknown): value is NodeFilters {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.query === "string" &&
    (value.contentKind === "all" || isContentKind(value.contentKind)) &&
    typeof value.sourceDomain === "string" &&
    (value.relationshipKind === "all" ||
      isRelationshipKind(value.relationshipKind)) &&
    typeof value.publishedFrom === "string" &&
    typeof value.publishedTo === "string"
  );
}
