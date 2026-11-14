import {
  validateGraphResult,
  validateNodeDetails,
} from "./validation";
import {
  buildNodeDetails,
  makeGraph,
  makeNode,
  sampleGraph,
} from "../test/fixtures";

describe("validateGraphResult", () => {
  it("accepts the coherent fixture graph", () => {
    const result = validateGraphResult(sampleGraph());
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate node ids", () => {
    const graph = sampleGraph();
    const duplicate = structuredClone(graph.nodes[1]);
    duplicate.id = graph.nodes[0].id;
    const result = validateGraphResult({
      ...graph,
      nodes: [...graph.nodes, duplicate],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/node ids must be unique/i);
    }
  });

  it("requires exactly one node matching the seed id", () => {
    const result = validateGraphResult({
      ...sampleGraph(),
      seed_node_id: "node-missing",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /seed_node_id.*exactly one node/i,
      );
    }
  });

  it("rejects tree references to unknown nodes", () => {
    const graph = sampleGraph();
    const result = validateGraphResult({
      ...graph,
      tree_edges: [
        ...graph.tree_edges,
        {
          parent_id: "node-root",
          child_id: "node-not-in-graph",
          relationship_id: null,
          placement_kind: "chronological_only",
          discovery_depth: 1,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /child_id.*must reference a node/i,
      );
    }
  });

  it("rejects tree cycles", () => {
    const graph = sampleGraph();
    const result = validateGraphResult({
      ...graph,
      tree_edges: [
        {
          parent_id: "node-root",
          child_id: "node-seed",
          relationship_id: null,
          placement_kind: "chronological_only",
          discovery_depth: 1,
        },
        {
          parent_id: "node-seed",
          child_id: "node-root",
          relationship_id: null,
          placement_kind: "chronological_only",
          discovery_depth: 2,
        },
      ],
      undated_node_ids: ["node-date-only", "node-undated", "node-tie", "node-followup"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/cycle/i);
    }
  });

  it("rejects a root that is not an earliest candidate", () => {
    const graph = sampleGraph();
    const result = validateGraphResult({
      ...graph,
      origin_assessment: {
        ...graph.origin_assessment,
        earliest_candidate_ids: ["node-seed"],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /root_node_id.*earliest origin candidates/i,
      );
    }
  });

  it("rejects cross-link ids without relationship records", () => {
    const result = validateGraphResult({
      ...sampleGraph(),
      cross_link_ids: ["rel-not-present"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /cross_link_ids.*does not exist/i,
      );
    }
  });

  it("rejects a node that is both undated and placed in the tree", () => {
    const result = validateGraphResult({
      ...sampleGraph(),
      undated_node_ids: [
        "node-date-only",
        "node-undated",
        "node-followup",
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /must not also appear in tree_edges/i,
      );
    }
  });

  it("rejects tree edges citing an unrelated or non-trace relationship", () => {
    const graph = sampleGraph();
    const result = validateGraphResult({
      ...graph,
      tree_edges: graph.tree_edges.map((edge, index) =>
        index === 0
          ? { ...edge, relationship_id: "rel-root-followup" }
          : edge,
      ),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /connect this tree edge|trace relationship kind/i,
      );
    }
  });

  it("rejects a relationship used by more than one tree edge", () => {
    const graph = sampleGraph();
    const result = validateGraphResult({
      ...graph,
      tree_edges: [
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
          relationship_id: "rel-seed-links-root",
          placement_kind: "traced_relationship",
          discovery_depth: 1,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /labels more than one tree edge/i,
      );
    }
  });

  it("rejects a graph for a different research session than requested", () => {
    const result = validateGraphResult(sampleGraph(), "fixture-other");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /research_id.*requested research session/i,
      );
    }
  });

  it("accepts a provisional date-only root in the time-uncertain lane", () => {
    const graph = sampleGraph();
    const result = validateGraphResult({
      ...graph,
      root_node_id: "node-date-only",
      origin_assessment: {
        ...graph.origin_assessment,
        status: "provisional",
        earliest_candidate_ids: ["node-date-only"],
      },
      undated_node_ids: [
        "node-date-only",
        "node-undated",
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects cross-link ids that are already used by a tree edge", () => {
    const result = validateGraphResult({
      ...sampleGraph(),
      cross_link_ids: ["rel-seed-links-root"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /cross_link_ids.*already a tree edge/i,
      );
    }
  });

  it("accepts an older known-date context node that is not placed", () => {
    const graph = sampleGraph();
    const old = makeNode({
      id: "node-old-context",
      publication: {
        timestamp: "2020-01-01T00:00:00+00:00",
        date: null,
        raw: null,
        precision: "timestamp",
        timezone_status: "known",
        evidence_id: null,
      },
    });
    const result = validateGraphResult({
      ...graph,
      nodes: [...graph.nodes, old],
      undated_node_ids: [...(graph.undated_node_ids ?? []), old.id],
    });

    expect(result.ok).toBe(true);
  });
});

describe("validateNodeDetails", () => {
  it("accepts the matching detail response", () => {
    const graph = sampleGraph();
    const result = validateNodeDetails(
      buildNodeDetails(graph, "node-root"),
      {
        researchId: graph.research_id,
        nodeId: "node-root",
        knownNodeIds: new Set(graph.nodes.map((node) => node.id)),
      },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects details for a different node id", () => {
    const graph = sampleGraph();
    const result = validateNodeDetails(
      buildNodeDetails(graph, "node-root"),
      {
        researchId: graph.research_id,
        nodeId: "node-seed",
        knownNodeIds: new Set(graph.nodes.map((node) => node.id)),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /node.id.*must match the requested node id/i,
      );
    }
  });

  it("rejects evidence attributed to another node", () => {
    const graph = sampleGraph();
    const details = structuredClone(
      buildNodeDetails(graph, "node-root"),
    );
    details.evidence![0].node_id = "node-seed";

    const result = validateNodeDetails(details, {
      researchId: graph.research_id,
      nodeId: "node-root",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /evidence\[0\].node_id.*inspected node/i,
      );
    }
  });

  it("rejects snapshot identity conflicts", () => {
    const graph = sampleGraph();
    const details = structuredClone(
      buildNodeDetails(graph, "node-root"),
    );
    details.snapshot = {
      ...details.snapshot!,
      id: "snap-different",
    };

    const result = validateNodeDetails(details, {
      researchId: graph.research_id,
      nodeId: "node-root",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /snapshot.id.*match the node snapshot_id/i,
      );
    }
  });

  it("rejects malformed graphs with mismatched research ids", () => {
    const graph = makeGraph();
    graph.nodes[0].research_id = "another-research";
    const result = validateGraphResult(graph);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(
        /research_id.*match the enclosing/i,
      );
    }
  });
});
