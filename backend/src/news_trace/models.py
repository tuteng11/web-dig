"""Authoritative shared models for News Trace.

These Pydantic models define the HTTP/gateway and MCP structured payloads for
the first milestone. The frontend types are generated from these models through
``contracts/generated/news_graph.schema.json``; do not hand-maintain parallel
DTO copies.
"""

from __future__ import annotations

from datetime import date as DateType
from enum import StrEnum
from urllib.parse import urlparse

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

STRICT = ConfigDict(extra="forbid")


class ContentKind(StrEnum):
    post = "post"
    news = "news"
    webpage = "webpage"


class PublicationPrecision(StrEnum):
    timestamp = "timestamp"
    date = "date"
    unknown = "unknown"


class TimezoneStatus(StrEnum):
    known = "known"
    unknown = "unknown"


class ContentStatus(StrEnum):
    full_text = "full_text"
    excerpt = "excerpt"
    snippet_only = "snippet_only"
    unavailable = "unavailable"


class RelationshipKind(StrEnum):
    links_to = "links_to"
    references = "references"
    replies_to = "replies_to"
    reposts = "reposts"
    same_event = "same_event"
    follows_up = "follows_up"
    related_topic = "related_topic"


class RelationshipMethod(StrEnum):
    source_link = "source_link"
    platform_metadata = "platform_metadata"
    llm_inference = "llm_inference"


class RelationshipStatus(StrEnum):
    validated = "validated"
    provisional = "provisional"


class OriginStatus(StrEnum):
    resolved_within_results = "resolved_within_results"
    provisional = "provisional"
    unresolved = "unresolved"


class TreePlacementKind(StrEnum):
    traced_relationship = "traced_relationship"
    chronological_only = "chronological_only"


class EvidenceKind(StrEnum):
    text_quote = "text_quote"
    link = "link"
    metadata = "metadata"
    snippet = "snippet"
    search_result = "search_result"


class ErrorCode(StrEnum):
    INVALID_REQUEST = "INVALID_REQUEST"
    NOT_FOUND = "NOT_FOUND"
    VERSION_CONFLICT = "VERSION_CONFLICT"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    SOURCE_URL_BLOCKED = "SOURCE_URL_BLOCKED"
    SOURCE_ACCESS_DENIED = "SOURCE_ACCESS_DENIED"
    SOURCE_FETCH_FAILED = "SOURCE_FETCH_FAILED"
    UNSUPPORTED_CONTENT = "UNSUPPORTED_CONTENT"
    EXTRACTION_FAILED = "EXTRACTION_FAILED"
    SEARCH_NOT_CONFIGURED = "SEARCH_NOT_CONFIGURED"
    SEARCH_UNAVAILABLE = "SEARCH_UNAVAILABLE"
    PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    INVALID_MODEL_OUTPUT = "INVALID_MODEL_OUTPUT"
    RATE_LIMITED = "RATE_LIMITED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    JOB_TIMEOUT = "JOB_TIMEOUT"
    MCP_UNAVAILABLE = "MCP_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


DIRECTED_RELATIONSHIP_KINDS = frozenset(
    {
        RelationshipKind.links_to,
        RelationshipKind.references,
        RelationshipKind.replies_to,
        RelationshipKind.reposts,
        RelationshipKind.follows_up,
    }
)

TRACE_RELATIONSHIP_KINDS = frozenset(
    {
        RelationshipKind.links_to,
        RelationshipKind.references,
        RelationshipKind.replies_to,
        RelationshipKind.reposts,
        RelationshipKind.follows_up,
    }
)


def _validate_http_url(value: str) -> str:
    if len(value) > 2048:
        raise ValueError("URL must be at most 2048 characters")
    if any(character.isspace() for character in value):
        raise ValueError("URL must not contain whitespace")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("URL must be an absolute http(s) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URL must not contain userinfo")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("URL must contain a valid port") from exc
    return value


class SourceInfo(BaseModel):
    model_config = STRICT

    name: str | None = None
    domain: str = Field(min_length=1, max_length=253)
    platform: str | None = None


class Publication(BaseModel):
    """Publication metadata with explicit precision and timezone uncertainty."""

    model_config = STRICT

    timestamp: AwareDatetime | None = None
    date: DateType | None = None
    raw: str | None = None
    precision: PublicationPrecision
    timezone_status: TimezoneStatus
    evidence_id: str | None = None

    @model_validator(mode="after")
    def _check_precision(self) -> Publication:
        if self.precision is PublicationPrecision.timestamp:
            if self.timestamp is None:
                raise ValueError("precision='timestamp' requires timestamp")
            if self.timezone_status is not TimezoneStatus.known:
                raise ValueError("a normalized timestamp requires a known timezone")
        if self.timestamp is not None and self.precision is not PublicationPrecision.timestamp:
            raise ValueError("timestamp may only be set when precision='timestamp'")
        if self.precision is PublicationPrecision.date:
            if self.date is None:
                raise ValueError("precision='date' requires date")
            if self.timestamp is not None:
                raise ValueError("date-only publication must not contain a timestamp")
            if self.timezone_status is not TimezoneStatus.unknown:
                raise ValueError("date-only publication cannot claim a known timezone")
        if self.date is not None and self.precision is not PublicationPrecision.date:
            raise ValueError("date may only be set when precision='date'")
        if self.precision is PublicationPrecision.unknown:
            if self.timestamp is not None or self.date is not None:
                raise ValueError("unknown precision must not invent a timestamp or date")
            if self.timezone_status is not TimezoneStatus.unknown:
                raise ValueError("unknown publication time cannot claim a known timezone")
        return self


class SourceNode(BaseModel):
    model_config = STRICT

    id: str = Field(min_length=1, max_length=200)
    research_id: str = Field(min_length=1, max_length=200)
    content_kind: ContentKind
    requested_url: str
    canonical_url: str
    title: str | None = None
    author: str | None = None
    source: SourceInfo
    publication: Publication
    updated_at: AwareDatetime | None = None
    retrieved_at: AwareDatetime
    discovered_at: AwareDatetime
    content_status: ContentStatus
    excerpt: str | None = None
    snapshot_id: str | None = None
    content_hash: str | None = None
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_node(self) -> SourceNode:
        _validate_http_url(self.requested_url)
        _validate_http_url(self.canonical_url)
        if self.content_status is ContentStatus.snippet_only and not self.excerpt:
            raise ValueError("snippet_only content requires an excerpt")
        if self.content_status is ContentStatus.full_text and not self.snapshot_id:
            raise ValueError("full_text content requires a snapshot_id")
        return self


class Evidence(BaseModel):
    model_config = STRICT

    id: str = Field(min_length=1, max_length=200)
    node_id: str = Field(min_length=1, max_length=200)
    snapshot_id: str = Field(min_length=1, max_length=200)
    kind: EvidenceKind
    quote: str | None = None
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=0)
    link_target: str | None = None
    metadata_field: str | None = None
    metadata_value: str | None = None
    retrieved_at: AwareDatetime

    @model_validator(mode="after")
    def _check_evidence(self) -> Evidence:
        if (self.start is None) != (self.end is None):
            raise ValueError("start and end must be provided together")
        if self.start is not None and self.end is not None and self.start >= self.end:
            raise ValueError("start must be less than end")
        if self.kind is EvidenceKind.text_quote and not self.quote:
            raise ValueError("text_quote evidence requires quote")
        if self.kind is EvidenceKind.snippet and not self.quote:
            raise ValueError("snippet evidence requires quote")
        if self.kind is EvidenceKind.link:
            if not self.link_target:
                raise ValueError("link evidence requires link_target")
            _validate_http_url(self.link_target)
        if self.kind is EvidenceKind.metadata:
            if not self.metadata_field or self.metadata_value is None:
                raise ValueError("metadata evidence requires field and value")
        return self


class Relationship(BaseModel):
    model_config = STRICT

    id: str = Field(min_length=1, max_length=200)
    from_node_id: str = Field(min_length=1, max_length=200)
    to_node_id: str = Field(min_length=1, max_length=200)
    kind: RelationshipKind
    directed: bool
    method: RelationshipMethod
    explanation: str = Field(min_length=1)
    evidence_ids: list[str] = Field(default_factory=list)
    score: float | None = None
    status: RelationshipStatus
    created_at: AwareDatetime

    @model_validator(mode="after")
    def _check_relationship(self) -> Relationship:
        if self.from_node_id == self.to_node_id:
            raise ValueError("a relationship must connect two distinct nodes")
        expected_directed = self.kind in DIRECTED_RELATIONSHIP_KINDS
        if self.directed is not expected_directed:
            raise ValueError(
                f"relationship kind {self.kind.value!r} requires directed={expected_directed}"
            )
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("evidence_ids must be unique")
        if self.status is RelationshipStatus.validated and not self.evidence_ids:
            raise ValueError("validated relationships require supporting evidence")
        return self


class OriginAssessment(BaseModel):
    model_config = STRICT

    status: OriginStatus
    earliest_candidate_ids: list[str] = Field(default_factory=list)
    rationale: str = Field(min_length=1)
    searched_at: AwareDatetime
    coverage_notes: list[str] = Field(default_factory=list)
    timestamp_evidence_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_candidates(self) -> OriginAssessment:
        if len(set(self.earliest_candidate_ids)) != len(self.earliest_candidate_ids):
            raise ValueError("earliest_candidate_ids must be unique")
        if self.status is OriginStatus.unresolved and self.earliest_candidate_ids:
            raise ValueError("unresolved origin must not name earliest candidates")
        if self.status is not OriginStatus.unresolved and not self.earliest_candidate_ids:
            raise ValueError("resolved/provisional origin requires earliest candidates")
        return self


class TreeEdge(BaseModel):
    model_config = STRICT

    parent_id: str
    child_id: str
    relationship_id: str | None = None
    placement_kind: TreePlacementKind
    discovery_depth: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_placement(self) -> TreeEdge:
        if self.parent_id == self.child_id:
            raise ValueError("tree edge parent and child must differ")
        if self.placement_kind is TreePlacementKind.traced_relationship:
            if self.relationship_id is None:
                raise ValueError("traced_relationship placement requires relationship_id")
        elif self.relationship_id is not None:
            raise ValueError("chronological_only placement must not claim a relationship")
        return self


class GraphLimits(BaseModel):
    model_config = STRICT

    max_nodes: int = Field(default=500, ge=1, le=500)
    max_relationships: int = Field(default=1500, ge=1, le=1500)


class GraphResult(BaseModel):
    model_config = STRICT

    research_id: str = Field(min_length=1, max_length=200)
    graph_revision: int = Field(ge=1)
    seed_node_id: str
    root_node_id: str | None
    origin_assessment: OriginAssessment
    nodes: list[SourceNode]
    relationships: list[Relationship]
    tree_edges: list[TreeEdge]
    cross_link_ids: list[str] = Field(default_factory=list)
    undated_node_ids: list[str] = Field(default_factory=list)
    limits: GraphLimits = Field(default_factory=GraphLimits)
    truncated: bool = False
    omitted_count: int | None = Field(default=None, ge=0)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_graph(self) -> GraphResult:
        node_ids = [node.id for node in self.nodes]
        if len(set(node_ids)) != len(node_ids):
            raise ValueError("node ids must be unique")
        if any(node.research_id != self.research_id for node in self.nodes):
            raise ValueError("every node must belong to this research")
        node_id_set = set(node_ids)
        if self.seed_node_id not in node_id_set:
            raise ValueError("seed_node_id must reference a node")
        if self.root_node_id is not None and self.root_node_id not in node_id_set:
            raise ValueError("root_node_id must reference a node")
        if (self.root_node_id is None) != (
            self.origin_assessment.status is OriginStatus.unresolved
        ):
            raise ValueError("root is null exactly when the origin is unresolved")
        if self.root_node_id is not None and (
            self.root_node_id not in self.origin_assessment.earliest_candidate_ids
        ):
            raise ValueError("root must be one of the earliest origin candidates")
        if not set(self.origin_assessment.earliest_candidate_ids) <= node_id_set:
            raise ValueError("origin candidates must reference nodes")

        relationship_ids = [relationship.id for relationship in self.relationships]
        if len(set(relationship_ids)) != len(relationship_ids):
            raise ValueError("relationship ids must be unique")
        relationship_id_set = set(relationship_ids)
        relationship_by_id = {
            relationship.id: relationship for relationship in self.relationships
        }
        for relationship in self.relationships:
            if relationship.from_node_id not in node_id_set:
                raise ValueError("relationship from_node_id must reference a node")
            if relationship.to_node_id not in node_id_set:
                raise ValueError("relationship to_node_id must reference a node")

        if len(set(self.cross_link_ids)) != len(self.cross_link_ids):
            raise ValueError("cross_link_ids must be unique")
        if not set(self.cross_link_ids) <= relationship_id_set:
            raise ValueError("cross_link_ids must reference relationships")

        if len(set(self.undated_node_ids)) != len(self.undated_node_ids):
            raise ValueError("undated_node_ids must be unique")
        if not set(self.undated_node_ids) <= node_id_set:
            raise ValueError("undated_node_ids must reference nodes")
        placed_ids = {edge.parent_id for edge in self.tree_edges} | {
            edge.child_id for edge in self.tree_edges
        }
        if placed_ids & set(self.undated_node_ids):
            raise ValueError("undated nodes must not be placed in the tree")

        parent_by_child: dict[str, str] = {}
        used_tree_relationship_ids: set[str] = set()
        for edge in self.tree_edges:
            if edge.parent_id not in node_id_set or edge.child_id not in node_id_set:
                raise ValueError("tree edges must reference nodes")
            if edge.child_id in parent_by_child:
                raise ValueError("a node can have at most one display parent")
            if edge.relationship_id is not None:
                relationship = relationship_by_id.get(edge.relationship_id)
                if relationship is None:
                    raise ValueError(
                        "tree edge relationship_id must reference a relationship"
                    )
                if {
                    relationship.from_node_id,
                    relationship.to_node_id,
                } != {edge.parent_id, edge.child_id}:
                    raise ValueError(
                        "tree edge relationship must connect its parent and child"
                    )
                if relationship.kind not in TRACE_RELATIONSHIP_KINDS:
                    raise ValueError(
                        "traced tree edges require a trace relationship kind"
                    )
                if edge.relationship_id in used_tree_relationship_ids:
                    raise ValueError(
                        "a relationship can label at most one tree edge"
                    )
                used_tree_relationship_ids.add(edge.relationship_id)
            parent_by_child[edge.child_id] = edge.parent_id
        for start in parent_by_child:
            seen = {start}
            cursor = start
            while cursor in parent_by_child:
                cursor = parent_by_child[cursor]
                if cursor in seen:
                    raise ValueError("tree edges must not contain a cycle")
                seen.add(cursor)
        if self.root_node_id is not None and self.root_node_id in parent_by_child:
            raise ValueError("root_node_id must not be a tree child")
        if set(self.cross_link_ids) & used_tree_relationship_ids:
            raise ValueError(
                "cross_link_ids must not include relationships used by tree edges"
            )

        if self.truncated and (self.omitted_count is None or self.omitted_count == 0):
            raise ValueError("truncated graph requires a positive omitted_count")
        if not self.truncated and self.omitted_count not in (None, 0):
            raise ValueError("omitted_count requires truncated=true")
        return self


class SnapshotInfo(BaseModel):
    model_config = STRICT

    id: str
    content_hash: str
    captured_at: AwareDatetime
    content_status: ContentStatus
    excerpt: str | None = None


class NodeDetails(BaseModel):
    model_config = STRICT

    research_id: str
    node: SourceNode
    evidence: list[Evidence] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    snapshot: SnapshotInfo | None = None
    coverage_notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_details(self) -> NodeDetails:
        if self.node.research_id != self.research_id:
            raise ValueError("node must belong to this research")
        evidence_ids = [item.id for item in self.evidence]
        if len(set(evidence_ids)) != len(evidence_ids):
            raise ValueError("evidence ids must be unique")
        for item in self.evidence:
            if item.node_id != self.node.id:
                raise ValueError("node details may only include this node's evidence")
        relationship_ids = [item.id for item in self.relationships]
        if len(set(relationship_ids)) != len(relationship_ids):
            raise ValueError("relationship ids must be unique")
        for relationship in self.relationships:
            if self.node.id not in {relationship.from_node_id, relationship.to_node_id}:
                raise ValueError("node details may only include relationships touching this node")
        if self.snapshot is not None:
            if self.node.snapshot_id is not None and self.snapshot.id != self.node.snapshot_id:
                raise ValueError("snapshot id must match the node snapshot")
            if self.snapshot.content_status is not self.node.content_status:
                raise ValueError("snapshot content status must match the node")
        return self


class ErrorDetail(BaseModel):
    model_config = STRICT

    code: ErrorCode
    message: str = Field(min_length=1)
    retryable: bool = False


class ErrorEnvelope(BaseModel):
    model_config = STRICT

    error: ErrorDetail
    request_id: str | None = None


class GetResearchGraphInput(BaseModel):
    model_config = STRICT

    research_id: str = Field(min_length=1, max_length=200)


class GetNodeDetailsInput(BaseModel):
    model_config = STRICT

    research_id: str = Field(min_length=1, max_length=200)
    node_id: str = Field(min_length=1, max_length=200)
    detail_query: str | None = Field(default=None, max_length=1000)


class SharedContractBundle(BaseModel):
    """Root type used only to generate the committed shared JSON Schema."""

    graph: GraphResult
    node_details: NodeDetails
    error_envelope: ErrorEnvelope
