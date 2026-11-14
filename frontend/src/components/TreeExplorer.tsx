import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  GraphResult,
  Relationship,
  SourceNode,
} from '../contracts/newsTrace'
import { HARD_NODE_CAP, HARD_RELATIONSHIP_CAP } from '../domain/caps'
import type { ChronologicalLayout } from '../domain/layout'
import {
  formatPublication,
  readPublicationInstant,
} from '../domain/format'
import {
  contentKindLabel,
  contentStatusLabel,
  displayNodeTitle,
  relationshipKindLabel,
  sourceName,
} from '../domain/nodes'

interface TreeExplorerProps {
  graph: GraphResult
  layout: ChronologicalLayout
  nodeById: Map<string, SourceNode>
  rootNodeId: string | null
  seedNodeId: string
  selectedNodeId: string | null
  selectedA: string | null
  selectedB: string | null
  matchedIds: Set<string>
  contextIds: Set<string>
  nodeIds: Set<string>
  relationshipIds: Set<string>
  hiddenCount: number
  capReached: boolean
  onShowAll(): void
  onInspect(id: string): void
  onSelect(id: string): void
}

type NodeSlot = 'A' | 'B' | null

type TraceNodeData = {
  node: SourceNode
  isRoot: boolean
  isSeed: boolean
  isSelected: boolean
  isContext: boolean
  slot: NodeSlot
  childCount: number
  collapsed: boolean
  rootBadge: string
  onInspect(id: string): void
  onSelect(id: string): void
  onToggleCollapse(id: string): void
}

type TraceFlowNode = Node<TraceNodeData, 'trace'>

const TRACED_STROKE = '#9dd55e'
const CHRONOLOGICAL_STROKE = '#94b47a'
const INFERRED_STROKE = '#c084fc'
const CROSS_LINK_STROKE = '#7fb9a4'
const TREE_NODE_WIDTH = 220
const TREE_NODE_HEIGHT = 140

function selectedSlotFor(
  nodeId: string,
  selectedA: string | null,
  selectedB: string | null,
): NodeSlot {
  if (selectedA === nodeId) {
    return 'A'
  }
  if (selectedB === nodeId) {
    return 'B'
  }
  return null
}

function publicationInstant(node: SourceNode | undefined): number | null {
  return node ? readPublicationInstant(node.publication) : null
}

function TraceNodeCard({ data }: NodeProps<TraceFlowNode>) {
  const title = displayNodeTitle(data.node)
  const publication = formatPublication(data.node.publication)
  const hasBadges =
    data.isRoot ||
    data.isSeed ||
    data.slot !== null ||
    data.isContext ||
    title.isUrlFallback

  return (
    <div
      className={`graph-node${data.isSelected ? ' node-selected' : ''}${
        data.isContext ? ' context-node' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      {hasBadges ? (
        <div className="node-badges">
          {data.isRoot ? (
            <span className="badge badge-root">{data.rootBadge}</span>
          ) : null}
          {data.isSeed ? (
            <span className="badge badge-seed">Submitted source</span>
          ) : null}
          {data.slot ? (
            <span
              className="slot-pill"
              aria-label={`Selected as question node ${data.slot}`}
            >
              {data.slot}
            </span>
          ) : null}
          {data.isContext ? (
            <span className="badge badge-neutral">Context</span>
          ) : null}
          {title.isUrlFallback ? (
            <span className="badge badge-neutral">URL</span>
          ) : null}
        </div>
      ) : null}

      <div className="node-text">
        <strong title={title.text}>{title.text}</strong>
        <small>
          {contentKindLabel(data.node.content_kind)} · {sourceName(data.node)}
        </small>
        <small>
          {contentStatusLabel(data.node.content_status)} ·{' '}
          {publication.compactText}
        </small>
      </div>

      <div className="node-actions">
        <button
          type="button"
          className="button button-quiet nodrag nopan"
          aria-label={`Inspect ${title.text}`}
          aria-pressed={data.isSelected}
          onClick={(event) => {
            event.stopPropagation()
            data.onInspect(data.node.id)
          }}
        >
          Inspect
        </button>
        <button
          type="button"
          className="button button-secondary nodrag nopan"
          aria-label={`Select ${title.text} for question`}
          aria-pressed={data.slot !== null}
          disabled={data.slot !== null}
          onClick={(event) => {
            event.stopPropagation()
            data.onSelect(data.node.id)
          }}
        >
          {data.slot ? 'Selected' : 'Select'}
        </button>
        {data.childCount > 0 ? (
          <button
            type="button"
            className="button button-quiet nodrag nopan"
            aria-expanded={!data.collapsed}
            aria-label={`${
              data.collapsed ? 'Expand' : 'Collapse'
            } subtree under ${title.text}`}
            title={`${data.childCount} visible child${
              data.childCount === 1 ? '' : 'ren'
            }`}
            onClick={(event) => {
              event.stopPropagation()
              data.onToggleCollapse(data.node.id)
            }}
          >
            {data.collapsed ? 'Expand' : 'Collapse'}
          </button>
        ) : null}
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}

const nodeTypes = { trace: TraceNodeCard }

export function TreeExplorer({
  graph,
  layout,
  nodeById,
  rootNodeId,
  seedNodeId,
  selectedNodeId,
  selectedA,
  selectedB,
  matchedIds,
  contextIds,
  nodeIds,
  relationshipIds,
  hiddenCount,
  capReached,
  onShowAll,
  onInspect,
  onSelect,
}: TreeExplorerProps) {
  const headingId = useId()
  const noteId = useId()
  const laneHeadingId = useId()
  const [flow, setFlow] = useState<ReactFlowInstance<TraceFlowNode, Edge> | null>(
    null,
  )
  const [showCrossLinks, setShowCrossLinks] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // When filters are active the App marks direct matches and their ancestors as
  // context. Every loaded node is a match when no filter is active, so this test
  // keeps the unfiltered tree untouched while making filters FE-09-visible.
  const filterActive = !graph.nodes.every((node) => matchedIds.has(node.id))

  const filterVisibleCapIds = useMemo(() => {
    const visible = new Set<string>()
    for (const node of graph.nodes) {
      if (!nodeIds.has(node.id)) {
        continue
      }
      if (
        !filterActive ||
        matchedIds.has(node.id) ||
        contextIds.has(node.id)
      ) {
        visible.add(node.id)
      }
    }
    return visible
  }, [contextIds, filterActive, graph.nodes, matchedIds, nodeIds])

  const childrenByParent = useMemo(() => {
    const children = new Map<string, string[]>()
    for (const edge of graph.tree_edges) {
      if (
        !filterVisibleCapIds.has(edge.parent_id) ||
        !filterVisibleCapIds.has(edge.child_id) ||
        !layout.positions.has(edge.parent_id) ||
        !layout.positions.has(edge.child_id)
      ) {
        continue
      }
      const existing = children.get(edge.parent_id) ?? []
      if (!existing.includes(edge.child_id)) {
        existing.push(edge.child_id)
        children.set(edge.parent_id, existing)
      }
    }
    return children
  }, [filterVisibleCapIds, graph.tree_edges, layout.positions])

  const hiddenByCollapse = useMemo(() => {
    const hidden = new Set<string>()
    const stack = [...collapsed].filter((id) => filterVisibleCapIds.has(id))
    while (stack.length > 0) {
      const parentId = stack.pop()
      if (parentId === undefined) {
        break
      }
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (!hidden.has(childId)) {
          hidden.add(childId)
          stack.push(childId)
        }
      }
    }
    return hidden
  }, [childrenByParent, collapsed, filterVisibleCapIds])

  const visibleDatedIds = useMemo(
    () =>
      layout.datedNodeIds.filter(
        (id) =>
          filterVisibleCapIds.has(id) &&
          nodeById.has(id) &&
          !hiddenByCollapse.has(id),
      ),
    [filterVisibleCapIds, hiddenByCollapse, layout.datedNodeIds, nodeById],
  )

  const visibleUncertainIds = useMemo(
    () =>
      layout.uncertainNodeIds.filter(
        (id) =>
          filterVisibleCapIds.has(id) &&
          nodeById.has(id) &&
          !hiddenByCollapse.has(id),
      ),
    [filterVisibleCapIds, hiddenByCollapse, layout.uncertainNodeIds, nodeById],
  )

  const visibleDatedIdSet = useMemo(
    () => new Set(visibleDatedIds),
    [visibleDatedIds],
  )

  const relationshipById = useMemo(
    () =>
      new Map<string, Relationship>(
        graph.relationships.map((relationship) => [
          relationship.id,
          relationship,
        ]),
      ),
    [graph.relationships],
  )

  const crossLinkRelationships = useMemo(
    () =>
      (graph.cross_link_ids ?? [])
        .map((id) => relationshipById.get(id))
        .filter(
          (relationship): relationship is Relationship =>
            relationship !== undefined && relationshipIds.has(relationship.id),
        ),
    [graph.cross_link_ids, relationshipById, relationshipIds],
  )

  const renderableCrossLinks = useMemo(
    () =>
      crossLinkRelationships.filter(
        (relationship) =>
          visibleDatedIdSet.has(relationship.from_node_id) &&
          visibleDatedIdSet.has(relationship.to_node_id),
      ),
    [crossLinkRelationships, visibleDatedIdSet],
  )

  const hiddenCrossLinkCount =
    crossLinkRelationships.length - renderableCrossLinks.length

  const rootBadge =
    graph.origin_assessment.status === 'provisional'
      ? 'Provisional earliest'
      : graph.origin_assessment.status === 'unresolved'
        ? 'Origin candidate'
        : 'Earliest evidence'

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const flowNodes = useMemo<TraceFlowNode[]>(() => {
    const nodes: TraceFlowNode[] = []
    for (const id of visibleDatedIds) {
      const node = nodeById.get(id)
      const position = layout.positions.get(id)
      if (!node || !position) {
        continue
      }
      const title = displayNodeTitle(node)
      const publication = formatPublication(node.publication)
      nodes.push({
        id,
        type: 'trace',
        position: { x: position.x, y: position.y },
        data: {
          node,
          isRoot: id === rootNodeId,
          isSeed: id === seedNodeId,
          isSelected: id === selectedNodeId,
          isContext: contextIds.has(id) && !matchedIds.has(id),
          slot: selectedSlotFor(id, selectedA, selectedB),
          childCount: childrenByParent.get(id)?.length ?? 0,
          collapsed: collapsed.has(id),
          rootBadge,
          onInspect,
          onSelect,
          onToggleCollapse: toggleCollapse,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        deletable: false,
        ariaLabel: `${title.isUrlFallback ? 'URL ' : ''}${title.text}. ${contentKindLabel(
          node.content_kind,
        )} from ${sourceName(node)}. ${publication.compactText}.`,
      })
    }
    return nodes
  }, [
    childrenByParent,
    collapsed,
    contextIds,
    layout.positions,
    matchedIds,
    nodeById,
    onInspect,
    onSelect,
    rootBadge,
    rootNodeId,
    seedNodeId,
    selectedA,
    selectedB,
    selectedNodeId,
    toggleCollapse,
    visibleDatedIds,
  ])

  const flowEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = []

    graph.tree_edges.forEach((edge, index) => {
      if (
        !visibleDatedIdSet.has(edge.parent_id) ||
        !visibleDatedIdSet.has(edge.child_id)
      ) {
        return
      }
      if (
        typeof edge.relationship_id === 'string' &&
        !relationshipIds.has(edge.relationship_id)
      ) {
        return
      }

      const relationship = edge.relationship_id
        ? relationshipById.get(edge.relationship_id) ?? null
        : null
      const inferred =
        relationship !== null &&
        (relationship.method === 'llm_inference' ||
          relationship.kind === 'related_topic')
      const chronological = edge.placement_kind === 'chronological_only'
      const parentInstant = publicationInstant(nodeById.get(edge.parent_id))
      const childInstant = publicationInstant(nodeById.get(edge.child_id))
      const samePublishedTime =
        parentInstant !== null && parentInstant === childInstant
      const stroke = chronological
        ? CHRONOLOGICAL_STROKE
        : inferred
          ? INFERRED_STROKE
          : TRACED_STROKE
      const relationshipLabel = relationship
        ? relationshipKindLabel(relationship.kind)
        : 'Traced relationship'
      const label = chronological
        ? 'Chronological placement only'
        : `${relationshipLabel}${inferred ? ' · inferred' : ''}${
            samePublishedTime ? ' · same published time (tie-break)' : ''
          }`

      edges.push({
        id: `tree-${edge.parent_id}-${edge.child_id}-${index}`,
        source: edge.parent_id,
        target: edge.child_id,
        type: 'smoothstep',
        label,
        markerEnd: chronological
          ? undefined
          : {
              type: MarkerType.ArrowClosed,
              color: stroke,
              width: 16,
              height: 16,
            },
        style: {
          stroke,
          strokeWidth: chronological ? 1.4 : 1.6,
          strokeDasharray: chronological
            ? '6 5'
            : inferred
              ? '2 5'
              : undefined,
        },
        labelStyle: { fill: '#d7e3cf', fontSize: 9 },
        labelBgStyle: { fill: '#141914', fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        ariaLabel: label,
      })
    })

    if (showCrossLinks) {
      for (const relationship of renderableCrossLinks) {
        const label = `Cross-link · ${relationshipKindLabel(
          relationship.kind,
        )}${relationship.directed ? '' : ' · undirected'}`
        edges.push({
          id: `cross-link-${relationship.id}`,
          source: relationship.from_node_id,
          target: relationship.to_node_id,
          type: 'smoothstep',
          label,
          markerEnd: relationship.directed
            ? {
                type: MarkerType.ArrowClosed,
                color: CROSS_LINK_STROKE,
                width: 14,
                height: 14,
              }
            : undefined,
          style: {
            stroke: CROSS_LINK_STROKE,
            strokeWidth: 1.3,
            strokeDasharray: '4 4',
          },
          labelStyle: { fill: '#c4e3d8', fontSize: 9 },
          labelBgStyle: { fill: '#141914', fillOpacity: 0.9 },
          labelBgPadding: [4, 2],
          ariaLabel: label,
        })
      }
    }

    return edges
  }, [
    graph.tree_edges,
    nodeById,
    relationshipById,
    renderableCrossLinks,
    relationshipIds,
    showCrossLinks,
    visibleDatedIdSet,
  ])

  function focusNode(nodeId: string | null) {
    if (!flow || nodeId === null) {
      return
    }
    const position = layout.positions.get(nodeId)
    if (!position) {
      return
    }
    void flow.setCenter(
      position.x + TREE_NODE_WIDTH / 2,
      position.y + TREE_NODE_HEIGHT / 2,
      { zoom: 0.9, duration: 250 },
    )
  }

  function fitTree() {
    if (!flow || visibleDatedIds.length === 0) {
      return
    }
    void flow.fitView({ padding: 0.2, duration: 200 })
  }

  const flowReady = flow !== null && visibleDatedIds.length > 0
  const cappedNodeCount = graph.nodes.filter((node) =>
    nodeIds.has(node.id),
  ).length
  const visibleCount = visibleDatedIds.length + visibleUncertainIds.length
  const filterHiddenCount = Math.max(
    0,
    cappedNodeCount - filterVisibleCapIds.size,
  )
  const collapseHiddenCount = [...hiddenByCollapse].filter((id) =>
    filterVisibleCapIds.has(id),
  ).length
  const contextVisibleCount = [...visibleDatedIds, ...visibleUncertainIds].filter(
    (id) => contextIds.has(id) && !matchedIds.has(id),
  ).length
  const nodeCapExceeded = graph.nodes.length > HARD_NODE_CAP
  const relationshipCapReached =
    graph.relationships.length > HARD_RELATIONSHIP_CAP
  const showAllAllowed =
    hiddenCount > 0 && (!capReached || cappedNodeCount < HARD_NODE_CAP)
  const uncertainContextCount = visibleUncertainIds.filter(
    (id) => contextIds.has(id) && !matchedIds.has(id),
  ).length

  useEffect(() => {
    if (!flow || visibleDatedIds.length === 0) {
      return
    }
    const timer = window.setTimeout(() => {
      if (filterActive) {
        void flow.fitView({ padding: 0.2, duration: 0 })
        return
      }
      const rootPosition =
        rootNodeId !== null && visibleDatedIdSet.has(rootNodeId)
          ? layout.positions.get(rootNodeId)
          : null
      if (rootPosition) {
        void flow.setCenter(
          rootPosition.x + TREE_NODE_WIDTH / 2,
          rootPosition.y + TREE_NODE_HEIGHT / 2 + 150,
          { zoom: 0.8, duration: 0 },
        )
        return
      }
      void flow.fitView({ padding: 0.2, duration: 0 })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [
    flow,
    graph.graph_revision,
    filterActive,
    matchedIds.size,
    contextIds.size,
    layout.positions,
    rootNodeId,
  ])

  return (
    <section
      className="tree-panel"
      aria-labelledby={headingId}
      aria-describedby={noteId}
    >
      <div className="tb-panel-heading">
        <div>
          <p className="tb-eyebrow">Tree</p>
          <h2 id={headingId}>Chronological tree</h2>
        </div>
        <span
          className="count-chip"
          title={`Showing ${visibleCount} of ${graph.nodes.length} loaded sources after filters, the render limit, and collapsed subtrees.`}
        >
          {visibleDatedIds.length} dated · {visibleUncertainIds.length}{' '}
          time-uncertain
        </span>
      </div>

      <div
        className="tree-controls"
        role="group"
        aria-label="Tree view controls"
      >
        <button
          type="button"
          className="button button-quiet"
          onClick={() => void flow?.zoomIn({ duration: 120 })}
          disabled={!flowReady}
        >
          Zoom in
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => void flow?.zoomOut({ duration: 120 })}
          disabled={!flowReady}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={fitTree}
          disabled={!flowReady}
        >
          Fit
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => focusNode(rootNodeId)}
          disabled={!flow || rootNodeId === null || !visibleDatedIdSet.has(rootNodeId)}
        >
          Focus earliest
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => focusNode(seedNodeId)}
          disabled={!flow || !visibleDatedIdSet.has(seedNodeId)}
        >
          Focus submitted source
        </button>
        {crossLinkRelationships.length > 0 ? (
          <button
            type="button"
            className="button button-quiet"
            aria-pressed={showCrossLinks}
            onClick={() => setShowCrossLinks((current) => !current)}
          >
            {showCrossLinks ? 'Hide' : 'Show'} cross-links (
            {crossLinkRelationships.length})
          </button>
        ) : null}
      </div>

      <p
        className="field-note"
        id={noteId}
        style={{ padding: '0 15px 9px' }}
      >
        Position follows known publication timestamps, earliest first, with node
        id as the stable tie-break. Tree connectors show placement only; factual
        relationship direction and evidence live in the details panel. The
        Sources panel is the keyboard-accessible list alternative with the same
        Inspect and Select actions.
      </p>

      <p
        className="field-note"
        role="status"
        style={{ padding: '0 15px 9px' }}
      >
        Showing {visibleCount} of {graph.nodes.length} loaded sources.
        {filterActive
          ? filterHiddenCount > 0
            ? ` ${filterHiddenCount} source${
                filterHiddenCount === 1 ? ' is' : 's are'
              } hidden by the active filters because they are neither matches nor context ancestors.`
            : ' The active filters hide no source inside the current render limit.'
          : ''}
        {contextVisibleCount > 0
          ? ` ${contextVisibleCount} context ancestor${
              contextVisibleCount === 1 ? ' remains' : 's remain'
            } visible and dimmed.`
          : ''}
        {collapseHiddenCount > 0
          ? ` ${collapseHiddenCount} source${
              collapseHiddenCount === 1 ? ' is' : 's are'
            } hidden inside collapsed subtrees.`
          : ''}
        {hiddenCount > 0
          ? ` ${hiddenCount} loaded source${
              hiddenCount === 1 ? ' is' : 's are'
            } outside the current render limit.`
          : ''}
      </p>

      {graph.origin_assessment.status !== 'resolved_within_results' ? (
        <p className="origin-notice" role="status">
          Origin is {graph.origin_assessment.status.replaceAll('_', ' ')}:
          the earliest marker is a candidate within the loaded results, not a
          confirmed historical origin.
        </p>
      ) : null}

      {hiddenCount > 0 ? (
        <div className="tb-cap-notice">
          <p className="field-note">
            {nodeCapExceeded
              ? cappedNodeCount >= HARD_NODE_CAP
                ? `The hard UI cap of ${HARD_NODE_CAP.toLocaleString()} nodes is reached; ${hiddenCount.toLocaleString()} loaded source${
                    hiddenCount === 1 ? '' : 's'
                  } remain outside the render limit.`
                : `This graph exceeds the hard UI cap of ${HARD_NODE_CAP.toLocaleString()} nodes. The current limit includes ${cappedNodeCount.toLocaleString()} loaded sources; show all renders the first ${HARD_NODE_CAP.toLocaleString()}.`
              : `The initial render limit includes ${cappedNodeCount.toLocaleString()} of ${graph.nodes.length.toLocaleString()} loaded sources; ${hiddenCount.toLocaleString()} remain outside it.`}
          </p>
          {showAllAllowed ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={onShowAll}
            >
              Show all loaded sources
            </button>
          ) : null}
        </div>
      ) : null}

      {relationshipCapReached ? (
        <p className="field-note" role="status" style={{ padding: '0 15px 9px' }}>
          This graph contains {graph.relationships.length.toLocaleString()}{' '}
          relationships. The interactive tree applies the{' '}
          {HARD_RELATIONSHIP_CAP.toLocaleString()}-relationship hard cap and
          draws only relationships whose endpoints are visible. Records beyond
          the cap remain in the source metadata response and are not invented.
        </p>
      ) : null}

      {visibleDatedIds.length === 0 ? (
        <p className="empty-list-note">
          {filterActive
            ? 'No dated source within the current render limit matches the active filters or is a context ancestor. Any time-uncertain matches remain listed in the lane below.'
            : layout.datedNodeIds.length === 0
              ? 'No source has a timezone-known publication timestamp, so no dated tree is drawn. No time is invented for date-only or undated sources.'
              : 'No dated source is within the current render limit. Sources outside the canvas remain available in the time-uncertain lane below.'}
        </p>
      ) : (
        <div
          className="tree-canvas"
          role="group"
          aria-label={`Interactive chronological tree of ${visibleDatedIds.length} dated source${
            visibleDatedIds.length === 1 ? '' : 's'
          }. Every node action is also available as a button in the Sources panel.`}
        >
          <ReactFlow<TraceFlowNode, Edge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onInit={(instance) => setFlow(instance)}
            onNodeClick={(_event, node) => onInspect(node.id)}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            zoomOnDoubleClick={false}
            fitView={false}
            minZoom={0.15}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={24} size={1} color="#30372f" />
          </ReactFlow>
        </div>
      )}

      <div className="tree-legend" aria-label="Tree legend">
        <span className="legend-item">
          <span
            className="legend-line"
            aria-hidden="true"
            style={{ borderTop: `2px solid ${TRACED_STROKE}` }}
          />
          Traced relationship (solid arrow)
        </span>
        <span className="legend-item">
          <span
            className="legend-line"
            aria-hidden="true"
            style={{ borderTop: `2px dashed ${CHRONOLOGICAL_STROKE}` }}
          />
          Chronological placement only (dashed, no arrow)
        </span>
        <span className="legend-item">
          <span
            className="legend-line"
            aria-hidden="true"
            style={{ borderTop: `2px dotted ${INFERRED_STROKE}` }}
          />
          Inferred relationship (dotted purple)
        </span>
        {crossLinkRelationships.length > 0 ? (
          <span className="legend-item">
            <span
              className="legend-line"
              aria-hidden="true"
              style={{ borderTop: `2px dashed ${CROSS_LINK_STROKE}` }}
            />
            Cross-link overlay (factual relationship)
          </span>
        ) : null}
      </div>

      {showCrossLinks && hiddenCrossLinkCount > 0 ? (
        <p className="field-note" role="note">
          {hiddenCrossLinkCount} cross-link
          {hiddenCrossLinkCount === 1 ? ' is' : 's are'} not drawn because at
          least one endpoint is outside the dated canvas (time-uncertain, hidden
          by the render limit, or hidden by active filters). The relationship
          records remain available in node details.
        </p>
      ) : null}

      {visibleUncertainIds.length > 0 ? (
        <section
          className="time-uncertain-section"
          aria-labelledby={laneHeadingId}
        >
          <div className="tb-panel-heading">
            <div>
              <h3 id={laneHeadingId}>Unplaced / time-uncertain sources</h3>
              <p className="field-note">
                These sources are deliberately outside the dated canvas.
                Date-only, unknown-zone, and undated values do not receive an
                invented midnight or browser time zone.
                {uncertainContextCount > 0
                  ? ` ${uncertainContextCount} row${
                      uncertainContextCount === 1 ? ' is' : 's are'
                    } context for a filter match.`
                  : ''}
              </p>
            </div>
            <span className="count-chip">{visibleUncertainIds.length}</span>
          </div>

          <ul className="lane-items">
            {visibleUncertainIds.map((id) => {
              const node = nodeById.get(id)
              if (!node) {
                return null
              }
              const title = displayNodeTitle(node)
              const publication = formatPublication(node.publication)
              const hasKnownInstant =
                readPublicationInstant(node.publication) !== null
              const slot = selectedSlotFor(id, selectedA, selectedB)
              const isContext =
                contextIds.has(id) && !matchedIds.has(id)
              const isSelected = id === selectedNodeId
              return (
                <li
                  key={id}
                  className={`lane-item${
                    isSelected ? ' source-item-active' : ''
                  }${isContext ? ' source-item-context' : ''}`}
                >
                  <div className="node-badges">
                    {id === rootNodeId ? (
                      <span className="badge badge-root">{rootBadge}</span>
                    ) : null}
                    {id === seedNodeId ? (
                      <span className="badge badge-seed">
                        Submitted source
                      </span>
                    ) : null}
                    {slot ? (
                      <span
                        className="slot-pill"
                        aria-label={`Selected as question node ${slot}`}
                      >
                        {slot}
                      </span>
                    ) : null}
                    {isContext ? (
                      <span className="badge badge-neutral">Context</span>
                    ) : null}
                    {title.isUrlFallback ? (
                      <span className="badge badge-neutral">URL</span>
                    ) : null}
                    <span
                      className={
                        hasKnownInstant
                          ? 'badge badge-neutral'
                          : 'badge badge-uncertain'
                      }
                    >
                      {hasKnownInstant
                        ? 'Not placed on dated tree'
                        : 'Time-uncertain'}
                    </span>
                  </div>

                  <div className="node-text">
                    <strong title={title.text}>{title.text}</strong>
                  </div>
                  <p className="field-note">
                    {contentKindLabel(node.content_kind)} · {sourceName(node)} ·{' '}
                    {contentStatusLabel(node.content_status)} ·{' '}
                    {publication.compactText}
                  </p>

                  <div className="node-actions">
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`Inspect ${title.text}`}
                      aria-pressed={isSelected}
                      onClick={() => onInspect(id)}
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-label={`Select ${title.text} for question`}
                      aria-pressed={slot !== null}
                      disabled={slot !== null}
                      onClick={() => onSelect(id)}
                    >
                      {slot ? `Selected ${slot}` : 'Select for question'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </section>
  )
}
