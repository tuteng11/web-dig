import type { GraphResult } from "../contracts/newsTrace";

export const INITIAL_RENDER_LIMIT = 100;
export const HARD_NODE_CAP = 500;
export const HARD_RELATIONSHIP_CAP = 1500;

/**
 * Select the deterministic subset of the loaded graph that may be rendered.
 *
 * The root and submitted seed are always kept first so a cap can never hide
 * the two nodes the workspace is anchored around. All remaining nodes retain
 * their backend order. Relationship selection follows graph order and keeps
 * only relationships whose endpoints are both visible.
 */
export function applyGraphCaps(
  graph: GraphResult,
  showAll: boolean,
): {
  nodeIds: Set<string>;
  edgeRelationshipIds: Set<string>;
  hiddenCount: number;
  capReached: boolean;
} {
  const nodeLimit = showAll ? HARD_NODE_CAP : INITIAL_RENDER_LIMIT;

  const nodeIds = new Set<string>();
  const addNode = (id: string | null | undefined): void => {
    if (typeof id === "string" && id.length > 0) {
      nodeIds.add(id);
    }
  };

  addNode(graph.root_node_id);
  addNode(graph.seed_node_id);
  for (const node of graph.nodes) {
    if (nodeIds.size >= nodeLimit) {
      break;
    }
    addNode(node.id);
  }

  const edgeRelationshipIds = new Set<string>();
  let eligibleRelationships = 0;
  for (const relationship of graph.relationships) {
    if (
      !nodeIds.has(relationship.from_node_id) ||
      !nodeIds.has(relationship.to_node_id)
    ) {
      continue;
    }
    eligibleRelationships += 1;
    if (edgeRelationshipIds.size < HARD_RELATIONSHIP_CAP) {
      edgeRelationshipIds.add(relationship.id);
    }
  }

  return {
    nodeIds,
    edgeRelationshipIds,
    hiddenCount: Math.max(0, graph.nodes.length - nodeIds.size),
    capReached:
      graph.nodes.length > nodeLimit ||
      eligibleRelationships > HARD_RELATIONSHIP_CAP,
  };
}
