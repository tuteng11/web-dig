import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { GraphResult, Relationship, SourceNode } from "../generated/newsTraceContracts";
import type { ChronologicalLayout } from "../domain/layout";
import { formatPublication, readPublicationInstant } from "../domain/format";
import {
  contentKindLabel,
  contentStatusLabel,
  displayNodeTitle,
  relationshipKindLabel,
  relationshipMethodLabel,
  sourceName,
} from "../domain/nodes";

interface TreeExplorerProps {
  graph: GraphResult;
  layout: ChronologicalLayout;
  nodeById: Map<string, SourceNode>;
  rootNodeId: string | null;
  seedNodeId: string;
  selectedNodeId: string | null;
  selectedA: string | null;
  selectedB: string | null;
  onInspect: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}

function treeNodeLabel(
  node: SourceNode,
  isRoot: boolean,
  isSeed: boolean,
): string {
  const title = displayNodeTitle(node);
  const publication = formatPublication(node.publication);
  const badges = [
    isRoot ? "Earliest evidence found" : null,
    isSeed ? "Submitted source" : null,
  ].filter((badge): badge is string => badge !== null);

  return [
    badges.length > 0 ? badges.join(" · ") : null,
    title.isUrlFallback ? `URL: ${title.text}` : title.text,
    `${contentKindLabel(node.content_kind)} · ${sourceName(node)}`,
    contentStatusLabel(node.content_status),
    publication.compactText,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function treeEdgeLabel(
  relationship: Relationship | null,
  placementKind: string,
): string {
  if (placementKind === "chronological_only") {
    return "Chronological placement only";
  }
  return relationship
    ? relationshipKindLabel(relationship.kind)
    : "Traced relationship";
}

function selectedSlotFor(
  nodeId: string,
  selectedA: string | null,
  selectedB: string | null,
): "A" | "B" | null {
  if (selectedA === nodeId) {
    return "A";
  }
  if (selectedB === nodeId) {
    return "B";
  }
  return null;
}

export function TreeExplorer({
  graph,
  layout,
  nodeById,
  rootNodeId,
  seedNodeId,
  selectedNodeId,
  selectedA,
  selectedB,
  onInspect,
  onSelect,
}: TreeExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const inspectRef = useRef(onInspect);
  inspectRef.current = onInspect;

  const [showCrossLinks, setShowCrossLinks] = useState(false);

  const relationshipById = useMemo(
    () =>
      new Map<string, Relationship>(
        graph.relationships.map((relationship) => [
          relationship.id,
          relationship,
        ]),
      ),
    [graph.relationships],
  );

  const crossLinkRelationships = useMemo(() => {
    return (graph.cross_link_ids ?? [])
      .map((id) => relationshipById.get(id))
      .filter((relationship): relationship is Relationship =>
        Boolean(relationship),
      );
  }, [graph.cross_link_ids, relationshipById]);

  const renderableCrossLinks = useMemo(
    () =>
      crossLinkRelationships.filter(
        (relationship) =>
          layout.positions.has(relationship.from_node_id) &&
          layout.positions.has(relationship.to_node_id),
      ),
    [crossLinkRelationships, layout.positions],
  );

  const hiddenCrossLinkCount =
    crossLinkRelationships.length - renderableCrossLinks.length;
  const datedCount = layout.datedNodeIds.length;
  const uncertainNodes = layout.uncertainNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is SourceNode => Boolean(node));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || layout.datedNodeIds.length === 0) {
      return;
    }

    const elements: cytoscape.ElementDefinition[] = [];

    for (const nodeId of layout.datedNodeIds) {
      const node = nodeById.get(nodeId);
      const position = layout.positions.get(nodeId);
      if (!node || !position) {
        continue;
      }
      const isRoot = nodeId === rootNodeId;
      const isSeed = nodeId === seedNodeId;
      elements.push({
        group: "nodes",
        data: {
          id: nodeId,
          label: treeNodeLabel(node, isRoot, isSeed),
        },
        position: { x: position.x, y: position.y },
        classes: [
          "source-node",
          isRoot ? "root" : "",
          isSeed ? "seed" : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    }

    for (const edge of graph.tree_edges) {
      if (
        !layout.positions.has(edge.parent_id) ||
        !layout.positions.has(edge.child_id)
      ) {
        continue;
      }
      const relationship = edge.relationship_id
        ? relationshipById.get(edge.relationship_id) ?? null
        : null;
      const parentNode = nodeById.get(edge.parent_id);
      const childNode = nodeById.get(edge.child_id);
      const parentInstant = parentNode
        ? readPublicationInstant(parentNode.publication)
        : null;
      const childInstant = childNode
        ? readPublicationInstant(childNode.publication)
        : null;
      const samePublishedTime =
        parentInstant !== null && parentInstant === childInstant;
      const inferred =
        relationship !== null &&
        (relationship.method === "llm_inference" ||
          relationship.kind === "related_topic");
      const placementClass =
        edge.placement_kind === "chronological_only"
          ? "chronological"
          : inferred
            ? "inferred"
            : "traced";
      elements.push({
        group: "edges",
        data: {
          id: `tree-edge-${edge.parent_id}-${edge.child_id}`,
          source: edge.parent_id,
          target: edge.child_id,
          label: samePublishedTime
            ? "Same published time (tie-break)"
            : treeEdgeLabel(relationship, edge.placement_kind),
        },
        classes: `tree-edge ${placementClass}${samePublishedTime ? " same-time" : ""}`,
      });
    }

    if (showCrossLinks) {
      for (const relationship of renderableCrossLinks) {
        elements.push({
          group: "edges",
          data: {
            id: `cross-link-${relationship.id}`,
            source: relationship.from_node_id,
            target: relationship.to_node_id,
            label: relationshipKindLabel(relationship.kind),
            tooltip: `${relationshipKindLabel(relationship.kind)} · ${relationshipMethodLabel(relationship.method)}`,
          },
          classes: `cross-link ${relationship.directed ? "directed" : "undirected"}`,
        });
      }
    }

    const cy = cytoscape({
      container,
      elements,
      style: [
        {
          selector: "node",
          style: {
            width: 220,
            height: 112,
            shape: "round-rectangle",
            "background-color": "#f8fafc",
            "border-width": 1.5,
            "border-color": "#94a3b8",
            label: "data(label)",
            color: "#0f172a",
            "font-size": 11,
            "font-family":
              "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "text-wrap": "wrap",
            "text-max-width": 200,
            "text-valign": "center",
            "text-halign": "center",
            "line-height": 1.25,
          },
        },
        {
          selector: "node.root",
          style: {
            "border-width": 3,
            "border-color": "#b45309",
            "background-color": "#fffbeb",
          },
        },
        {
          selector: "node.seed",
          style: {
            "border-style": "double",
            "border-color": "#1d4ed8",
          },
        },
        {
          selector: "node.selected-a",
          style: {
            "border-width": 4,
            "border-color": "#0f766e",
            "background-color": "#ecfdf5",
          },
        },
        {
          selector: "node.selected-b",
          style: {
            "border-width": 4,
            "border-color": "#7e22ce",
            "background-color": "#faf5ff",
          },
        },
        {
          selector: "node.inspected",
          style: {
            "background-color": "#e0f2fe",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#64748b",
            "target-arrow-color": "#64748b",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            color: "#475569",
            "font-size": 8,
            "text-rotation": "autorotate",
            "text-margin-y": -8,
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
            "text-max-width": 180,
            "text-wrap": "wrap",
          },
        },
        {
          selector: "edge.chronological",
          style: {
            "line-style": "dashed",
            "target-arrow-shape": "none",
          },
        },
        {
          selector: "edge.inferred",
          style: {
            "line-style": "dotted",
            "line-color": "#7c3aed",
            "target-arrow-color": "#7c3aed",
          },
        },
        {
          selector: "edge.cross-link",
          style: {
            "line-style": "dashed",
            "line-color": "#0f766e",
            "target-arrow-color": "#0f766e",
            width: 1.2,
            opacity: 0.85,
            "curve-style": "bezier",
          },
        },
        {
          selector: "edge.cross-link.undirected",
          style: {
            "target-arrow-shape": "none",
          },
        },
      ] as cytoscape.StylesheetJson,
      layout: {
        name: "preset",
        padding: 40,
        fit: false,
      },
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
      boxSelectionEnabled: false,
    });

    cy.on("tap", "node", (event) => {
      inspectRef.current(event.target.id());
    });

    cyRef.current = cy;
    const initialRoot = rootNodeId
      ? cy.getElementById(rootNodeId)
      : cy.collection();
    if (initialRoot.nonempty()) {
      // Start readable at the earliest evidence; Fit remains available for the
      // full-tree overview.
      cy.zoom(0.9);
      cy.center(initialRoot);
    } else {
      cy.fit(cy.elements(), 40);
    }

    return () => {
      cy.destroy();
      if (cyRef.current === cy) {
        cyRef.current = null;
      }
    };
  }, [
    graph,
    layout,
    nodeById,
    relationshipById,
    renderableCrossLinks,
    rootNodeId,
    seedNodeId,
    showCrossLinks,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.nodes().forEach((node) => {
      const nodeId = node.id();
      node.toggleClass("selected-a", nodeId === selectedA);
      node.toggleClass("selected-b", nodeId === selectedB);
      node.toggleClass("inspected", nodeId === selectedNodeId);
    });
  }, [selectedA, selectedB, selectedNodeId, layout]);

  const fitView = () => {
    const cy = cyRef.current;
    if (cy) {
      cy.fit(cy.elements(), 40);
    }
  };

  const focusRoot = () => {
    const cy = cyRef.current;
    if (!cy || !rootNodeId) {
      return;
    }
    const root = cy.getElementById(rootNodeId);
    if (root.nonempty()) {
      cy.animate(
        { zoom: 0.9, center: { eles: root } },
        { duration: 220 },
      );
    }
  };

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy) {
      return;
    }
    const nextLevel = Math.min(3, Math.max(0.2, cy.zoom() * factor));
    cy.zoom({
      level: nextLevel,
      renderedPosition: {
        x: (container?.clientWidth ?? 0) / 2,
        y: (container?.clientHeight ?? 0) / 2,
      },
    });
  };

  return (
    <section className="tree-panel" aria-labelledby="tree-heading">
      <div className="panel-heading tree-heading-row">
        <div>
          <p className="eyebrow">Tree</p>
          <h2 id="tree-heading">Chronological tree</h2>
        </div>
        <div className="tree-controls" role="group" aria-label="Tree view controls">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => zoomBy(1.2)}
          >
            Zoom in
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => zoomBy(1 / 1.2)}
          >
            Zoom out
          </button>
          <button
            type="button"
            className="button button-quiet"
            data-testid="fit-view"
            onClick={fitView}
            disabled={datedCount === 0}
          >
            Fit
          </button>
          <button
            type="button"
            className="button button-quiet"
            data-testid="focus-root"
            onClick={focusRoot}
            disabled={!rootNodeId || !layout.positions.has(rootNodeId)}
          >
            Focus earliest evidence
          </button>
          {crossLinkRelationships.length > 0 ? (
            <button
              type="button"
              className="button button-quiet"
              data-testid="cross-link-toggle"
              aria-pressed={showCrossLinks}
              onClick={() => setShowCrossLinks((current) => !current)}
            >
              {showCrossLinks ? "Hide" : "Show"} cross-links (
              {crossLinkRelationships.length})
            </button>
          ) : null}
        </div>
      </div>

      <p className="tree-note">
        Vertical order follows known publication timestamps, earliest first,
        with node id as the stable tie-break. Tree connectors are display
        placement; factual relationship direction is preserved separately in
        details and the optional cross-link overlay. Drag to pan, scroll to zoom,
        or use Fit for the full dated tree overview.
      </p>

      {datedCount === 0 ? (
        <div className="tree-empty">
          No source can be placed on the dated tree. Sources with unresolved
          chronology or uncertain time are listed below.
        </div>
      ) : (
        <div
          className="tree-canvas"
          data-testid="tree-canvas"
          ref={containerRef}
          role="img"
          aria-label={`Chronological tree of ${datedCount} dated sources. Use the Sources panel for a keyboard-accessible list of the same sources.`}
        />
      )}

      <div className="tree-legend" aria-label="Tree legend">
        <span className="legend-item">
          <span className="legend-line legend-traced" aria-hidden="true" />
          Traced relationship
        </span>
        <span className="legend-item">
          <span className="legend-line legend-chronological" aria-hidden="true" />
          Chronological placement only
        </span>
        <span className="legend-item">
          <span className="legend-line legend-inferred" aria-hidden="true" />
          Inferred relationship
        </span>
        <span className="legend-item">
          <span className="legend-line legend-cross" aria-hidden="true" />
          Cross-link overlay
        </span>
      </div>

      {showCrossLinks && hiddenCrossLinkCount > 0 ? (
        <p className="tree-note">
          {hiddenCrossLinkCount} cross-link
          {hiddenCrossLinkCount === 1 ? " is" : "s are"} not drawn because an
          endpoint is in the time-uncertain lane. The records remain available
          in node details.
        </p>
      ) : null}

      {uncertainNodes.length > 0 ? (
        <section
          className="time-uncertain-section"
          data-testid="time-uncertain-section"
          aria-labelledby="time-uncertain-heading"
        >
          <div className="lane-heading">
            <div>
              <h3 id="time-uncertain-heading">
                Unplaced / time-uncertain sources
              </h3>
              <p className="group-note">
                These sources are deliberately outside the dated tree. Known-date
                context is not claimed as the origin, and no midnight or browser
                time zone is invented for date-only or undated values.
              </p>
            </div>
            <span className="count-chip">{uncertainNodes.length}</span>
          </div>

          <ul className="lane-items">
            {uncertainNodes.map((node) => {
              const title = displayNodeTitle(node);
              const publication = formatPublication(node.publication);
              const hasKnownInstant =
                readPublicationInstant(node.publication) !== null;
              const selectedSlot = selectedSlotFor(
                node.id,
                selectedA,
                selectedB,
              );
              return (
                <li
                  key={node.id}
                  className={`lane-item${selectedNodeId === node.id ? " lane-item-active" : ""}`}
                >
                  <div className="badge-row">
                    {node.id === rootNodeId ? (
                      <span className="badge badge-root">
                        Earliest evidence found
                      </span>
                    ) : null}
                    {node.id === seedNodeId ? (
                      <span className="badge badge-seed">
                        Submitted source
                      </span>
                    ) : null}
                    <span className="badge badge-uncertain">
                      {hasKnownInstant
                        ? "Not placed on dated tree"
                        : "Time-uncertain"}
                    </span>
                  </div>
                  <p
                    className={`lane-title${title.isUrlFallback ? " url-fallback" : ""}`}
                  >
                    {title.isUrlFallback ? (
                      <span className="fallback-label">URL</span>
                    ) : null}
                    {title.text}
                  </p>
                  <p className="lane-meta">
                    {contentKindLabel(node.content_kind)} ·{" "}
                    {sourceName(node)} · {contentStatusLabel(node.content_status)} ·{" "}
                    {publication.compactText}
                  </p>
                  <div className="source-actions">
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`Inspect ${title.text}`}
                      aria-pressed={selectedNodeId === node.id}
                      onClick={() => onInspect(node.id)}
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-label={`Select ${title.text} for question`}
                      disabled={selectedSlot !== null}
                      onClick={() => onSelect(node.id)}
                    >
                      {selectedSlot
                        ? `Selected ${selectedSlot}`
                        : "Select for question"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
