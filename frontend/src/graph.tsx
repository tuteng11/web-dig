import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { useMemo } from 'react'
import { FileText, Landmark, Link2 } from 'lucide-react'
import { formatDate, type Source, type Trace } from './api'
import '@xyflow/react/dist/style.css'

type SourceNode = Node<{ entry: Source; original: boolean; selected: boolean; onSelect: (source: Source) => void }, 'source'>

function GraphNode({ data }: NodeProps<SourceNode>) {
  const Icon = data.original ? Landmark : FileText
  return (
    <div className={`graph-node ${data.original ? 'node-original' : ''} ${data.selected ? 'node-selected' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button className="graph-node-button nodrag" onClick={() => data.onSelect(data.entry)} aria-label={`Inspect ${data.entry.title}`}>
        <span className="node-icon"><Icon size={14} /></span>
        <span className="node-text"><strong>{data.entry.publisher}</strong><small>{data.original ? 'Original evidence' : formatDate(data.entry.published)}</small></span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

const nodeTypes = { source: GraphNode }

export default function SourceGraph({ trace, selected, onSelect }: {
  trace: Trace; selected: string | null; onSelect: (source: Source) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const anchor = trace.sources.find(source => source.id === (trace.original_id || trace.earliest_id)) || trace.sources[0]
    const others = trace.sources.filter(source => source.id !== anchor?.id)
    const rows = Math.min(others.length, 4)
    const middle = (rows - 1) * 35
    const sources = anchor ? [anchor, ...others] : []
    const nodes: SourceNode[] = sources.map((entry, index) => ({
      id: entry.id,
      type: 'source',
      data: { entry, original: entry.id === trace.original_id, selected: entry.id === selected, onSelect },
      position: index === 0 ? { x: 0, y: Math.max(0, middle) } : {
        x: (1 + Math.floor((index - 1) / 4)) * 265,
        y: ((index - 1) % 4) * 70,
      },
      ariaLabel: `Inspect ${entry.title}`,
    }))
    const edges: Edge[] = trace.relationships.map(edge => ({
      id: `${edge.source}-${edge.target}`,
      source: edge.target,
      target: edge.source,
      type: 'smoothstep',
      markerStart: { type: MarkerType.ArrowClosed, color: '#9dd55e', width: 16, height: 16 },
      style: { stroke: '#73934e', strokeWidth: 1.4 },
      ariaLabel: edge.proof,
    }))
    return { nodes, edges }
  }, [trace, selected, onSelect])

  return (
    <>
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          nodesFocusable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.12}
          maxZoom={1.35}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background gap={18} size={1.2} color="#30372f" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
      <div className="graph-key"><Link2 size={14} /> {edges.length ? 'Arrows point from referring sources to the sources they reference.' : 'No direct references were verified between these sources.'}</div>
    </>
  )
}
