import type { GraphResult } from "../generated/newsTraceContracts";
import {
  compareUncertainNodes,
  datedSortInfo,
  splitGraphChronology,
} from "./chronology";

export const LAYOUT_X_GAP = 260;
export const LAYOUT_Y_GAP = 160;

export interface TreePosition {
  x: number;
  y: number;
  level: number;
  timeRank: number;
  timeBand: number;
}

export interface ChronologicalLayout {
  positions: Map<string, TreePosition>;
  datedNodeIds: string[];
  uncertainNodeIds: string[];
  roots: string[];
  width: number;
  height: number;
}

/**
 * Renderer-independent deterministic layout.
 *
 * - Comparable, timezone-known publication timestamps set the vertical rank
 *   (ascending, with node id as the stable tie-break).
 * - Children are always placed below their display parent.
 * - Horizontal positions come only from tree_edges, using a stable tidy-tree
 *   pass (leaves in chronological order, parents centered over children).
 * - Date-only, unknown-zone, and undated nodes are returned separately for the
 *   time-uncertain lane rather than being given invented positions on the axis.
 */
export function buildChronologicalLayout(
  graph: GraphResult,
): ChronologicalLayout {
  const { dated, uncertain } = splitGraphChronology(graph);
  const datedIds = dated.map((node) => node.id);
  const datedSet = new Set(datedIds);
  const timeRank = new Map<string, number>();
  const timeBand = new Map<string, number>();
  let currentBand = -1;
  let previousInstant: number | null = null;
  dated.forEach((node, index) => {
    timeRank.set(node.id, index);
    const info = datedSortInfo(node);
    if (info !== null) {
      if (previousInstant === null || info.instant !== previousInstant) {
        currentBand += 1;
        previousInstant = info.instant;
      }
      timeBand.set(node.id, currentBand);
    }
  });

  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();

  for (const edge of graph.tree_edges) {
    if (!datedSet.has(edge.parent_id) || !datedSet.has(edge.child_id)) {
      continue;
    }
    if (parentByChild.has(edge.child_id)) {
      continue;
    }
    parentByChild.set(edge.child_id, edge.parent_id);
    const children = childrenByParent.get(edge.parent_id) ?? [];
    children.push(edge.child_id);
    childrenByParent.set(edge.parent_id, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => {
      const aRank = timeRank.get(a) ?? 0;
      const bRank = timeRank.get(b) ?? 0;
      return aRank === bRank ? a.localeCompare(b) : aRank - bRank;
    });
  }

  const roots: string[] = [];
  const rootWasAdded = new Set<string>();
  const addRoot = (id: string | null) => {
    if (id !== null && datedSet.has(id) && !rootWasAdded.has(id)) {
      roots.push(id);
      rootWasAdded.add(id);
    }
  };

  addRoot(graph.root_node_id);
  for (const id of datedIds) {
    if (!parentByChild.has(id)) {
      addRoot(id);
    }
  }

  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  const assignLevel = (
    nodeId: string,
    parentLevel: number | null,
  ): void => {
    if (levels.has(nodeId) || visiting.has(nodeId)) {
      return;
    }
    visiting.add(nodeId);

    const rank = timeRank.get(nodeId) ?? 0;
    const level =
      parentLevel === null ? rank : Math.max(rank, parentLevel + 1);
    levels.set(nodeId, level);

    for (const childId of childrenByParent.get(nodeId) ?? []) {
      assignLevel(childId, level);
    }
    visiting.delete(nodeId);
  };

  for (const rootId of roots) {
    assignLevel(rootId, null);
  }
  // Defensive fallback for a disconnected node (the validator rejects a
  // cyclic or multiply-parented projection, but the layout must remain total).
  for (const id of datedIds) {
    if (!levels.has(id)) {
      addRoot(id);
      assignLevel(id, null);
    }
  }

  const columns = new Map<string, number>();
  const columnVisiting = new Set<string>();
  let nextColumn = 0;

  const assignColumn = (nodeId: string): number => {
    const existing = columns.get(nodeId);
    if (existing !== undefined) {
      return existing;
    }
    if (columnVisiting.has(nodeId)) {
      return nextColumn;
    }
    columnVisiting.add(nodeId);

    const children = (childrenByParent.get(nodeId) ?? []).filter(
      (childId) => !columns.has(childId),
    );

    let column: number;
    if (children.length === 0) {
      column = nextColumn;
      nextColumn += 1;
    } else {
      const childColumns = children.map((childId) =>
        assignColumn(childId),
      );
      column =
        (Math.min(...childColumns) + Math.max(...childColumns)) / 2;
    }

    columnVisiting.delete(nodeId);
    columns.set(nodeId, column);
    return column;
  };

  for (const rootId of roots) {
    assignColumn(rootId);
  }
  for (const id of datedIds) {
    if (!columns.has(id)) {
      assignColumn(id);
    }
  }

  const columnValues = [...columns.values()];
  const minColumn =
    columnValues.length > 0 ? Math.min(...columnValues) : 0;
  const maxColumn =
    columnValues.length > 0 ? Math.max(...columnValues) : 0;

  const positions = new Map<string, TreePosition>();
  for (const id of datedIds) {
    const column = columns.get(id) ?? 0;
    const level = levels.get(id) ?? 0;
    const band = timeBand.get(id) ?? 0;
    positions.set(id, {
      x: (column - minColumn) * LAYOUT_X_GAP,
      y: band * LAYOUT_Y_GAP,
      level,
      timeRank: timeRank.get(id) ?? 0,
      timeBand: band,
    });
  }

  const sortedUncertain = [...uncertain].sort(compareUncertainNodes);

  return {
    positions,
    datedNodeIds: datedIds,
    uncertainNodeIds: sortedUncertain.map((node) => node.id),
    roots: roots.filter((id) => positions.has(id)),
    width:
      datedIds.length === 0
        ? 0
        : (maxColumn - minColumn) * LAYOUT_X_GAP + LAYOUT_X_GAP,
    height:
      datedIds.length === 0
        ? 0
        : (currentBand < 0 ? 0 : currentBand) * LAYOUT_Y_GAP + LAYOUT_Y_GAP,
  };
}
