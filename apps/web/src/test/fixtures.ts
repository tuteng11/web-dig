import type {
  Evidence,
  GraphResult,
  NodeDetails,
  OriginAssessment,
  Relationship,
  SourceNode,
  TreeEdge,
} from "../generated/newsTraceContracts";

const RETRIEVED_AT = "2026-11-14T12:00:00+00:00";
const DISCOVERED_AT = "2026-11-14T12:01:00+00:00";
const SEARCHED_AT = "2026-11-14T12:02:00+00:00";

interface NodeOverrides extends Partial<Omit<SourceNode, "id">> {
  id: string;
  title?: string | null;
}

export function makeNode(overrides: NodeOverrides): SourceNode {
  const base: SourceNode = {
    id: overrides.id,
    research_id: "fixture-riverbend",
    content_kind: "news",
    requested_url: `https://source.example/${overrides.id}`,
    canonical_url: `https://source.example/${overrides.id}`,
    author: null,
    source: {
      name: "Example Source",
      domain: "source.example",
      platform: null,
    },
    publication: {
      timestamp: "2021-06-02T09:00:00-04:00",
      date: null,
      raw: "June 2, 2021 at 9:00 a.m. ET",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: null,
    },
    updated_at: null,
    retrieved_at: RETRIEVED_AT,
    discovered_at: DISCOVERED_AT,
    content_status: "excerpt",
    excerpt: "Synthetic fixture excerpt.",
    snapshot_id: null,
    content_hash: null,
    warnings: [],
  };

  return {
    ...base,
    ...overrides,
    source: overrides.source ?? base.source,
    publication: overrides.publication ?? base.publication,
  } as SourceNode;
}

function rootNode(): SourceNode {
  return makeNode({
    id: "node-root",
    title: "Riverbend council approves waterfront plan",
    author: "Maya Chen",
    content_kind: "news",
    requested_url:
      "https://riverbendledger.example/waterfront-plan",
    canonical_url:
      "https://riverbendledger.example/waterfront-plan",
    source: {
      name: "Riverbend Ledger",
      domain: "riverbendledger.example",
      platform: null,
    },
    publication: {
      timestamp: "2021-06-02T09:00:00-04:00",
      date: null,
      raw: "June 2, 2021 at 9:00 a.m. ET",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: "ev-root-published",
    },
    content_status: "full_text",
    excerpt:
      "Council notes: <script>alert('not markup')</script> is not HTML here.",
    snapshot_id: "snap-root",
    content_hash: "sha256:root-fixture",
  });
}

function seedNode(): SourceNode {
  return makeNode({
    id: "node-seed",
    title: "Waterfront plan draws praise and questions",
    content_kind: "post",
    requested_url: "https://social.example/@riverbendwatch/123",
    canonical_url: "https://social.example/@riverbendwatch/123",
    source: {
      name: "@riverbendwatch",
      domain: "social.example",
      platform: "Mastodon",
    },
    publication: {
      timestamp: "2021-06-05T14:30:00-04:00",
      date: null,
      raw: "Jun 5, 2021, 2:30 PM EDT",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: null,
    },
    content_status: "excerpt",
    excerpt:
      "The submitted post links to the earlier council report and asks about the vote.",
    snapshot_id: "snap-seed",
  });
}

function tieNode(): SourceNode {
  return makeNode({
    id: "node-tie",
    title: "Radio interview: waterfront plan debate",
    content_kind: "webpage",
    canonical_url: "https://riverbendradio.example/waterfront-debate",
    source: {
      name: "Riverbend Radio",
      domain: "riverbendradio.example",
      platform: null,
    },
    publication: {
      timestamp: "2021-06-05T14:30:00-04:00",
      date: null,
      raw: "Sat, 5 Jun 2021 14:30 -0400",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: null,
    },
    content_status: "excerpt",
    excerpt: "A same-time fixture source used to exercise stable ordering.",
    snapshot_id: null,
  });
}

function followupNode(): SourceNode {
  return makeNode({
    id: "node-followup",
    title: "County review adds new questions to waterfront plan",
    content_kind: "news",
    canonical_url: "https://riverbendcourier.example/county-review",
    source: {
      name: "Riverbend Courier",
      domain: "riverbendcourier.example",
      platform: null,
    },
    publication: {
      timestamp: "2021-06-08T08:15:00-04:00",
      date: null,
      raw: "June 8, 2021, 8:15 a.m. EDT",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: null,
    },
    content_status: "full_text",
    excerpt: "The county review asks for additional engineering details.",
    snapshot_id: "snap-followup",
  });
}

function dateOnlyNode(): SourceNode {
  return makeNode({
    id: "node-date-only",
    title: "Waterfront open house notice",
    content_kind: "webpage",
    canonical_url: "https://riverbendcity.example/open-house",
    source: {
      name: "Riverbend City",
      domain: "riverbendcity.example",
      platform: null,
    },
    publication: {
      timestamp: null,
      date: "2021-06-04",
      raw: "Friday, June 4, 2021",
      precision: "date",
      timezone_status: "unknown",
      evidence_id: null,
    },
    content_status: "excerpt",
    excerpt: "The notice gives a date but no publication time.",
    snapshot_id: null,
  });
}

function undatedNode(): SourceNode {
  return makeNode({
    id: "node-undated",
    title: "Archive note on the waterfront proposal",
    content_kind: "webpage",
    canonical_url: "https://archive.example/waterfront-note",
    source: {
      name: "Riverbend Archive",
      domain: "archive.example",
      platform: null,
    },
    publication: {
      timestamp: null,
      date: null,
      raw: "Date not recorded in the archive clipping",
      precision: "unknown",
      timezone_status: "unknown",
      evidence_id: null,
    },
    content_status: "snippet_only",
    excerpt: "The archive clipping has no recoverable publication date.",
    snapshot_id: null,
  });
}

function treeEdges(): TreeEdge[] {
  return [
    {
      parent_id: "node-root",
      child_id: "node-seed",
      relationship_id: "rel-seed-links-root",
      placement_kind: "traced_relationship",
      discovery_depth: 1,
    },
    {
      parent_id: "node-root",
      child_id: "node-tie",
      relationship_id: null,
      placement_kind: "chronological_only",
      discovery_depth: 1,
    },
    {
      parent_id: "node-root",
      child_id: "node-followup",
      relationship_id: null,
      placement_kind: "chronological_only",
      discovery_depth: 1,
    },
  ];
}

function relationships(): Relationship[] {
  return [
    {
      id: "rel-seed-links-root",
      from_node_id: "node-seed",
      to_node_id: "node-root",
      kind: "links_to",
      directed: true,
      method: "source_link",
      explanation: "The post links to the council article.",
      evidence_ids: ["ev-seed-link"],
      score: null,
      status: "validated",
      created_at: DISCOVERED_AT,
    },
    {
      id: "rel-root-followup",
      from_node_id: "node-root",
      to_node_id: "node-followup",
      kind: "related_topic",
      directed: false,
      method: "llm_inference",
      explanation:
        "The county review reports on the same waterfront plan topic.",
      evidence_ids: [],
      score: null,
      status: "provisional",
      created_at: DISCOVERED_AT,
    },
  ];
}

function originAssessment(): OriginAssessment {
  return {
    status: "resolved_within_results",
    earliest_candidate_ids: ["node-root"],
    rationale:
      "The council article is the earliest adequately dated relevant evidence in this synthetic fixture.",
    searched_at: SEARCHED_AT,
    coverage_notes: [
      "Synthetic fixture only; this does not claim an exhaustive search of the web.",
    ],
    timestamp_evidence_ids: ["ev-root-published"],
  };
}

function baseGraph(): GraphResult {
  return {
    research_id: "fixture-riverbend",
    graph_revision: 7,
    seed_node_id: "node-seed",
    root_node_id: "node-root",
    origin_assessment: originAssessment(),
    nodes: [
      rootNode(),
      seedNode(),
      tieNode(),
      followupNode(),
      dateOnlyNode(),
      undatedNode(),
    ],
    relationships: relationships(),
    tree_edges: treeEdges(),
    cross_link_ids: ["rel-root-followup"],
    undated_node_ids: ["node-date-only", "node-undated"],
    limits: { max_nodes: 500, max_relationships: 1500 },
    truncated: false,
    omitted_count: null,
    warnings: [
      "Synthetic fixture: source content, dates, and relationships are illustrative, not live research.",
    ],
  };
}

export function sampleGraph(): GraphResult {
  return baseGraph();
}

export function makeGraph(
  overrides: Partial<GraphResult> = {},
): GraphResult {
  const graph = baseGraph();
  return {
    ...graph,
    ...overrides,
  };
}

export function seedOnlyGraph(): GraphResult {
  const onlyNode = makeNode({
    id: "node-only",
    title: "Only the submitted source",
    content_kind: "post",
    canonical_url: "https://social.example/@only/1",
    source: {
      name: "@only",
      domain: "social.example",
      platform: "Mastodon",
    },
    publication: {
      timestamp: "2021-06-02T09:00:00-04:00",
      date: null,
      raw: "June 2, 2021",
      precision: "timestamp",
      timezone_status: "known",
      evidence_id: null,
    },
    content_status: "excerpt",
    snapshot_id: null,
  });

  return {
    research_id: "fixture-riverbend",
    graph_revision: 1,
    seed_node_id: "node-only",
    root_node_id: "node-only",
    origin_assessment: {
      status: "resolved_within_results",
      earliest_candidate_ids: ["node-only"],
      rationale: "Only the submitted source was returned for this fixture.",
      searched_at: SEARCHED_AT,
      coverage_notes: [],
      timestamp_evidence_ids: [],
    },
    nodes: [onlyNode],
    relationships: [],
    tree_edges: [],
    cross_link_ids: [],
    undated_node_ids: [],
    limits: { max_nodes: 500, max_relationships: 1500 },
    truncated: false,
    omitted_count: null,
    warnings: [],
  };
}

function evidenceFor(node: SourceNode): Evidence[] {
  if (node.id === "node-root") {
    return [
      {
        id: "ev-root-quote",
        node_id: node.id,
        snapshot_id: "snap-root",
        kind: "text_quote",
        quote: "The council approved the waterfront plan 4–1.",
        start: 0,
        end: 45,
        link_target: null,
        metadata_field: null,
        metadata_value: null,
        retrieved_at: RETRIEVED_AT,
      },
      {
        id: "ev-root-published",
        node_id: node.id,
        snapshot_id: "snap-root",
        kind: "metadata",
        quote: null,
        start: null,
        end: null,
        link_target: null,
        metadata_field: "datePublished",
        metadata_value: "2021-06-02T09:00:00-04:00",
        retrieved_at: RETRIEVED_AT,
      },
    ];
  }

  if (node.id === "node-seed") {
    return [
      {
        id: "ev-seed-link",
        node_id: node.id,
        snapshot_id: "snap-seed",
        kind: "link",
        quote: null,
        start: null,
        end: null,
        link_target: "https://riverbendledger.example/waterfront-plan",
        metadata_field: null,
        metadata_value: null,
        retrieved_at: RETRIEVED_AT,
      },
    ];
  }

  return [];
}

export function buildNodeDetails(
  graph: GraphResult,
  nodeId: string,
): NodeDetails {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Test fixture has no node ${nodeId}`);
  }

  const relationships = graph.relationships.filter(
    (relationship) =>
      relationship.from_node_id === nodeId ||
      relationship.to_node_id === nodeId,
  );

  return {
    research_id: graph.research_id,
    node,
    evidence: evidenceFor(node),
    relationships,
    snapshot: node.snapshot_id
      ? {
          id: node.snapshot_id,
          content_hash: node.content_hash ?? `sha256:${node.id}`,
          captured_at: RETRIEVED_AT,
          content_status: node.content_status,
          excerpt: node.excerpt,
        }
      : null,
    coverage_notes: [
      "Synthetic fixture detail; no live retrieval occurred.",
    ],
    warnings: [],
  };
}
