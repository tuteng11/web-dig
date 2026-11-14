import { buildChronologicalLayout } from "./layout";
import { makeGraph, makeNode, sampleGraph } from "../test/fixtures";

describe("buildChronologicalLayout", () => {
  it("orders the vertical axis by known publication time with an id tie-break", () => {
    const layout = buildChronologicalLayout(sampleGraph());
    const root = layout.positions.get("node-root");
    const seed = layout.positions.get("node-seed");
    const tie = layout.positions.get("node-tie");
    const followup = layout.positions.get("node-followup");

    expect(root).toBeDefined();
    expect(seed).toBeDefined();
    expect(tie).toBeDefined();
    expect(followup).toBeDefined();

    expect(root!.y).toBeLessThan(seed!.y);
    // Equal timestamps share one time band; the id is only a stable tie-break.
    expect(seed!.y).toBe(tie!.y);
    expect(seed!.timeBand).toBe(tie!.timeBand);
    expect(tie!.y).toBeLessThan(followup!.y);
    expect(seed!.timeRank).toBeLessThan(tie!.timeRank);
  });

  it("keeps children below their display parent unless they share a time band", () => {
    const layout = buildChronologicalLayout(sampleGraph());

    for (const edge of sampleGraph().tree_edges) {
      const parent = layout.positions.get(edge.parent_id);
      const child = layout.positions.get(edge.child_id);
      if (parent && child) {
        expect(child.y).toBeGreaterThanOrEqual(parent.y);
        if (child.y === parent.y) {
          expect(child.timeBand).toBe(parent.timeBand);
        }
      }
    }
  });

  it("puts date-only and undated nodes in the separate uncertain lane", () => {
    const layout = buildChronologicalLayout(sampleGraph());

    expect(layout.positions.has("node-date-only")).toBe(false);
    expect(layout.positions.has("node-undated")).toBe(false);
    expect(layout.uncertainNodeIds).toEqual([
      "node-date-only",
      "node-undated",
    ]);
  });

  it("keeps known-date nodes in the unplaced lane when the backend says so", () => {
    const graph = makeGraph({
      nodes: [
        makeNode({ id: "node-root" }),
        makeNode({
          id: "node-old-context",
          publication: {
            timestamp: "2020-01-01T00:00:00+00:00",
            date: null,
            raw: null,
            precision: "timestamp",
            timezone_status: "known",
            evidence_id: null,
          },
        }),
      ],
      seed_node_id: "node-root",
      root_node_id: "node-root",
      origin_assessment: {
        status: "resolved_within_results",
        earliest_candidate_ids: ["node-root"],
        rationale: "test",
        searched_at: "2026-11-14T12:02:00+00:00",
        coverage_notes: [],
        timestamp_evidence_ids: [],
      },
      relationships: [],
      tree_edges: [],
      cross_link_ids: [],
      undated_node_ids: ["node-old-context"],
    });

    const layout = buildChronologicalLayout(graph);
    expect(layout.positions.has("node-old-context")).toBe(false);
    expect(layout.uncertainNodeIds).toContain("node-old-context");
  });

  it("is deterministic across repeated builds", () => {
    const first = buildChronologicalLayout(sampleGraph());
    const second = buildChronologicalLayout(sampleGraph());

    expect(second.datedNodeIds).toEqual(first.datedNodeIds);
    expect(second.uncertainNodeIds).toEqual(first.uncertainNodeIds);
    expect([...second.positions.entries()]).toEqual([
      ...first.positions.entries(),
    ]);
  });

  it("handles an unplaced dated node without dropping it", () => {
    const graph = makeGraph({
      nodes: [
        makeNode({ id: "node-root" }),
        makeNode({
          id: "node-orphan",
          publication: {
            timestamp: "2021-06-09T10:00:00+00:00",
            date: null,
            raw: null,
            precision: "timestamp",
            timezone_status: "known",
            evidence_id: null,
          },
        }),
      ],
      seed_node_id: "node-root",
      root_node_id: "node-root",
      origin_assessment: {
        status: "resolved_within_results",
        earliest_candidate_ids: ["node-root"],
        rationale: "test",
        searched_at: "2026-11-14T12:02:00+00:00",
        coverage_notes: [],
        timestamp_evidence_ids: [],
      },
      relationships: [],
      tree_edges: [],
      cross_link_ids: [],
      undated_node_ids: [],
    });

    const layout = buildChronologicalLayout(graph);
    expect(layout.datedNodeIds).toEqual(["node-root", "node-orphan"]);
    expect(layout.positions.get("node-orphan")).toBeDefined();
    expect(layout.positions.get("node-orphan")!.y).toBeGreaterThan(
      layout.positions.get("node-root")!.y,
    );
  });
});
