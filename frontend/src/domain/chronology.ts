import type { GraphResult, SourceNode } from "../contracts/newsTrace";
import { readPublicationInstant } from "./format";

export interface ChronologySplit {
  dated: SourceNode[];
  uncertain: SourceNode[];
}

export interface DatedSortInfo {
  instant: number;
  id: string;
}

export function datedSortInfo(node: SourceNode): DatedSortInfo | null {
  const instant = readPublicationInstant(node.publication);
  return instant === null ? null : { instant, id: node.id };
}

export function compareDatedNodes(a: SourceNode, b: SourceNode): number {
  const aInfo = datedSortInfo(a);
  const bInfo = datedSortInfo(b);

  if (aInfo === null && bInfo === null) {
    return a.id.localeCompare(b.id);
  }
  if (aInfo === null) {
    return 1;
  }
  if (bInfo === null) {
    return -1;
  }
  if (aInfo.instant !== bInfo.instant) {
    return aInfo.instant - bInfo.instant;
  }
  return a.id.localeCompare(b.id);
}

function uncertainSortKey(node: SourceNode): [string, string] {
  const publication = node.publication;
  if (typeof publication.date === "string" && publication.date.length > 0) {
    return [publication.date, node.id];
  }
  if (
    typeof publication.timestamp === "string" &&
    publication.timestamp.length > 0
  ) {
    return [publication.timestamp.slice(0, 19), node.id];
  }
  return ["9999-12-31", node.id];
}

export function compareUncertainNodes(a: SourceNode, b: SourceNode): number {
  const [aKey, aId] = uncertainSortKey(a);
  const [bKey, bId] = uncertainSortKey(b);
  return aKey === bKey ? aId.localeCompare(bId) : aKey.localeCompare(bKey);
}

export function splitChronology(nodes: SourceNode[]): ChronologySplit {
  const dated: SourceNode[] = [];
  const uncertain: SourceNode[] = [];

  for (const node of nodes) {
    if (readPublicationInstant(node.publication) === null) {
      uncertain.push(node);
    } else {
      dated.push(node);
    }
  }

  dated.sort(compareDatedNodes);
  uncertain.sort(compareUncertainNodes);
  return { dated, uncertain };
}

export function splitGraphChronology(graph: GraphResult): ChronologySplit {
  // The backend's undated_node_ids collection also carries known-date
  // context that is deliberately not placed on the dated tree (for example,
  // older pages excluded from origin eligibility). Honor placement, not just
  // timestamp presence.
  const unplaced = new Set(graph.undated_node_ids ?? []);
  const dated: SourceNode[] = [];
  const uncertain: SourceNode[] = [];

  for (const node of graph.nodes) {
    if (
      readPublicationInstant(node.publication) !== null &&
      !unplaced.has(node.id)
    ) {
      dated.push(node);
    } else {
      uncertain.push(node);
    }
  }

  dated.sort(compareDatedNodes);
  uncertain.sort(compareUncertainNodes);
  return { dated, uncertain };
}
