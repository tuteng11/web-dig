import { useId, useMemo } from 'react'
import type {
  ContentKind,
  GraphResult,
  RelationshipKind,
  SourceNode,
} from '../contracts/newsTrace'
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type NodeFilters,
} from '../domain/filtering'
import { splitChronology } from '../domain/chronology'
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

interface SourceListProps {
  graph: GraphResult
  nodes: SourceNode[]
  rootNodeId: string | null
  seedNodeId: string
  unplacedNodeIds: string[]
  selectedNodeId: string | null
  selectedA: string | null
  selectedB: string | null
  filters: NodeFilters
  onFiltersChange(filters: NodeFilters): void
  matchedIds: Set<string>
  contextIds: Set<string>
  hiddenCount: number
  onInspect(id: string): void
  onSelect(id: string): void
}

const CONTENT_KIND_OPTIONS: ReadonlyArray<{
  value: ContentKind | 'all'
  label: string
}> = [
  { value: 'all', label: 'All content kinds' },
  { value: 'news', label: 'News' },
  { value: 'post', label: 'Posts' },
  { value: 'webpage', label: 'Web pages' },
]

const RELATIONSHIP_KIND_OPTIONS: ReadonlyArray<{
  value: RelationshipKind | 'all'
  label: string
}> = [
  { value: 'all', label: 'All relationship kinds' },
  { value: 'links_to', label: relationshipKindLabel('links_to') },
  { value: 'references', label: relationshipKindLabel('references') },
  { value: 'replies_to', label: relationshipKindLabel('replies_to') },
  { value: 'reposts', label: relationshipKindLabel('reposts') },
  { value: 'same_event', label: relationshipKindLabel('same_event') },
  { value: 'follows_up', label: relationshipKindLabel('follows_up') },
  { value: 'related_topic', label: relationshipKindLabel('related_topic') },
]

function rootBadgeLabel(graph: GraphResult): string {
  switch (graph.origin_assessment.status) {
    case 'provisional':
      return 'Provisional earliest'
    case 'unresolved':
      return 'Origin candidate'
    case 'resolved_within_results':
      return 'Earliest evidence found'
  }
}

interface SourceRowProps {
  node: SourceNode
  isRoot: boolean
  isSeed: boolean
  isActive: boolean
  isContext: boolean
  isUnplaced: boolean
  rootLabel: string
  selectedSlot: 'A' | 'B' | null
  onInspect(id: string): void
  onSelect(id: string): void
}

function SourceRow({
  node,
  isRoot,
  isSeed,
  isActive,
  isContext,
  isUnplaced,
  rootLabel,
  selectedSlot,
  onInspect,
  onSelect,
}: SourceRowProps) {
  const title = displayNodeTitle(node)
  const publication = formatPublication(node.publication)
  const timeUncertain = readPublicationInstant(node.publication) === null

  return (
    <li
      className={`source-item${isActive ? ' source-item-active' : ''}${
        isContext ? ' source-item-context' : ''
      }`}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="node-badges">
        <span className="kind-chip">{contentKindLabel(node.content_kind)}</span>
        <span className="tb-source-domain muted">{sourceName(node)}</span>
        <span className="badge badge-soft">
          {contentStatusLabel(node.content_status)}
        </span>
      </div>

      <div className="node-text">
        <strong title={title.text}>{title.text}</strong>
      </div>

      <div className="node-badges">
        {isRoot ? <span className="badge badge-root">{rootLabel}</span> : null}
        {isSeed ? (
          <span className="badge badge-seed">Submitted source</span>
        ) : null}
        {selectedSlot ? (
          <span
            className="slot-pill"
            aria-label={`Selected as question node ${selectedSlot}`}
          >
            {selectedSlot}
          </span>
        ) : null}
        {isContext ? (
          <span className="badge badge-neutral">Context</span>
        ) : null}
        {title.isUrlFallback ? (
          <span className="badge badge-neutral">URL</span>
        ) : null}
        {timeUncertain ? (
          <span className="badge badge-uncertain">Time-uncertain</span>
        ) : isUnplaced ? (
          <span className="badge badge-neutral">
            Not placed on dated tree
          </span>
        ) : null}
      </div>

      <p className="field-note">{publication.compactText}</p>

      {isContext ? (
        <p className="field-note">
          Context ancestor of a filter match; this row is not a direct match.
        </p>
      ) : null}

      <div className="node-actions">
        <button
          type="button"
          className="button button-quiet"
          aria-label={`Inspect ${title.text}`}
          aria-pressed={isActive}
          onClick={() => onInspect(node.id)}
        >
          Inspect
        </button>
        <button
          type="button"
          className="button button-secondary"
          aria-label={`Select ${title.text} for question`}
          aria-pressed={selectedSlot !== null}
          disabled={selectedSlot !== null}
          onClick={() => onSelect(node.id)}
        >
          {selectedSlot ? `Selected ${selectedSlot}` : 'Select for question'}
        </button>
      </div>
    </li>
  )
}

export function SourceList({
  graph,
  nodes,
  rootNodeId,
  seedNodeId,
  unplacedNodeIds,
  selectedNodeId,
  selectedA,
  selectedB,
  filters,
  onFiltersChange,
  matchedIds,
  contextIds,
  hiddenCount,
  onInspect,
  onSelect,
}: SourceListProps) {
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const searchId = `${baseId}-search`
  const contentKindId = `${baseId}-content-kind`
  const sourceDomainId = `${baseId}-source-domain`
  const relationshipKindId = `${baseId}-relationship-kind`
  const publishedFromId = `${baseId}-published-from`
  const publishedToId = `${baseId}-published-to`
  const resultsId = `${baseId}-results`
  const datedHeadingId = `${baseId}-dated-heading`
  const uncertainHeadingId = `${baseId}-uncertain-heading`

  const unplacedIds = useMemo(
    () => new Set(unplacedNodeIds),
    [unplacedNodeIds],
  )

  const domains = useMemo(() => {
    const values = new Set<string>()
    for (const node of nodes) {
      if (node.source.domain.trim().length > 0) {
        values.add(node.source.domain)
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [nodes])

  const domainOptions =
    filters.sourceDomain !== 'all' && !domains.includes(filters.sourceDomain)
      ? [filters.sourceDomain, ...domains]
      : domains

  const matchedNodes = nodes.filter((node) => matchedIds.has(node.id))
  const visibleNodes = nodes.filter(
    (node) => matchedIds.has(node.id) || contextIds.has(node.id),
  )
  const contextCount = visibleNodes.filter(
    (node) => contextIds.has(node.id) && !matchedIds.has(node.id),
  ).length
  const chronology = splitChronology(visibleNodes)
  const active = hasActiveFilters(filters)
  const invalidRange =
    filters.publishedFrom.length > 0 &&
    filters.publishedTo.length > 0 &&
    filters.publishedFrom > filters.publishedTo
  const rootLabel = rootBadgeLabel(graph)

  function updateFilters(patch: Partial<NodeFilters>) {
    onFiltersChange({ ...filters, ...patch })
  }

  function renderRow(node: SourceNode) {
    const selectedSlot =
      selectedA === node.id ? 'A' : selectedB === node.id ? 'B' : null
    return (
      <SourceRow
        key={node.id}
        node={node}
        isRoot={node.id === rootNodeId}
        isSeed={node.id === seedNodeId}
        isActive={node.id === selectedNodeId}
        isContext={contextIds.has(node.id) && !matchedIds.has(node.id)}
        isUnplaced={unplacedIds.has(node.id)}
        rootLabel={rootLabel}
        selectedSlot={selectedSlot}
        onInspect={onInspect}
        onSelect={onSelect}
      />
    )
  }

  return (
    <section className="source-list-panel" aria-labelledby={headingId}>
      <div className="tb-panel-heading">
        <div>
          <p className="tb-eyebrow">Sources</p>
          <h2 id={headingId}>Loaded research sources</h2>
        </div>
        <span
          className="count-chip"
          title={`${matchedNodes.length} direct filter match${
            matchedNodes.length === 1 ? '' : 'es'
          }; ${contextCount} context row${contextCount === 1 ? '' : 's'}`}
        >
          {visibleNodes.length}/{nodes.length}
        </span>
      </div>

      <p className="field-note">
        Graph revision {graph.graph_revision}. Filters match loaded sources and
        dim their ancestors as context; they never redefine the origin or the
        root marker.
      </p>

      {hiddenCount > 0 ? (
        <p className="field-note">
          The tree currently omits {hiddenCount.toLocaleString()} loaded source
          {hiddenCount === 1 ? '' : 's'} because of its render limit. This source
          list still includes every loaded source.
        </p>
      ) : null}

      <div className="source-controls">
        <div className="tb-control" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label" htmlFor={searchId}>
            Search loaded sources
          </label>
          <input
            id={searchId}
            className="text-input"
            type="search"
            value={filters.query}
            aria-describedby={resultsId}
            placeholder="Title, source, URL, excerpt…"
            onChange={(event) =>
              updateFilters({ query: event.currentTarget.value })
            }
          />
        </div>

        <div className="tb-control">
          <label className="field-label" htmlFor={contentKindId}>
            Content kind
          </label>
          <select
            id={contentKindId}
            className="select-input"
            value={filters.contentKind}
            aria-describedby={resultsId}
            onChange={(event) =>
              updateFilters({
                contentKind: event.currentTarget.value as
                  | ContentKind
                  | 'all',
              })
            }
          >
            {CONTENT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="tb-control">
          <label className="field-label" htmlFor={sourceDomainId}>
            Source domain
          </label>
          <select
            id={sourceDomainId}
            className="select-input"
            value={filters.sourceDomain}
            aria-describedby={resultsId}
            onChange={(event) =>
              updateFilters({ sourceDomain: event.currentTarget.value })
            }
          >
            <option value="all">All source domains</option>
            {domainOptions.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </div>

        <div className="tb-control">
          <label className="field-label" htmlFor={relationshipKindId}>
            Relationship kind
          </label>
          <select
            id={relationshipKindId}
            className="select-input"
            value={filters.relationshipKind}
            aria-describedby={resultsId}
            onChange={(event) =>
              updateFilters({
                relationshipKind: event.currentTarget.value as
                  | RelationshipKind
                  | 'all',
              })
            }
          >
            {RELATIONSHIP_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="tb-control">
          <label className="field-label" htmlFor={publishedFromId}>
            Published from
          </label>
          <input
            id={publishedFromId}
            className="text-input"
            type="date"
            value={filters.publishedFrom}
            aria-describedby={resultsId}
            onChange={(event) =>
              updateFilters({ publishedFrom: event.currentTarget.value })
            }
          />
        </div>

        <div className="tb-control">
          <label className="field-label" htmlFor={publishedToId}>
            Published to
          </label>
          <input
            id={publishedToId}
            className="text-input"
            type="date"
            value={filters.publishedTo}
            aria-describedby={resultsId}
            onChange={(event) =>
              updateFilters({ publishedTo: event.currentTarget.value })
            }
          />
        </div>

        <div className="tb-control tb-control-reset">
          <button
            type="button"
            className="button button-quiet"
            disabled={!active}
            onClick={() => onFiltersChange({ ...EMPTY_FILTERS })}
          >
            Reset filters
          </button>
        </div>
      </div>

      {invalidRange ? (
        <p className="field-note" role="status">
          The “From” date is after the “To” date, so no dated source can fall in
          that range.
        </p>
      ) : null}

      <p id={resultsId} className="sr-only" aria-live="polite">
        {visibleNodes.length} source{visibleNodes.length === 1 ? '' : 's'} shown,{' '}
        {matchedNodes.length} direct filter match
        {matchedNodes.length === 1 ? '' : 'es'}, {contextCount} context row
        {contextCount === 1 ? '' : 's'}, of {nodes.length} loaded source
        {nodes.length === 1 ? '' : 's'}.
      </p>

      {nodes.length === 0 ? (
        <p className="empty-list-note">
          No sources are loaded in this graph.
        </p>
      ) : visibleNodes.length === 0 ? (
        <p className="empty-list-note">
          {active
            ? `No loaded sources match these filters. This says nothing about sources outside this research run. Reset filters to see all ${nodes.length} loaded sources.`
            : 'No sources are available to display in this list.'}
        </p>
      ) : (
        <div className="tb-source-scroll" style={{ padding: '10px 11px 14px' }}>
          {matchedNodes.length === 0 ? (
            <p className="field-note">
              No direct filter matches. The rows shown are ancestors included as
              context only.
            </p>
          ) : null}

          {chronology.dated.length > 0 ? (
            <section aria-labelledby={datedHeadingId}>
              <h3 id={datedHeadingId} className="source-group-heading">
                Dated sources · earliest first ({chronology.dated.length})
              </h3>
              <ul className="source-items">
                {chronology.dated.map((node) => renderRow(node))}
              </ul>
            </section>
          ) : null}

          {chronology.uncertain.length > 0 ? (
            <section
              className="tb-uncertain-group"
              aria-labelledby={uncertainHeadingId}
            >
              <h3 id={uncertainHeadingId} className="source-group-heading">
                Time-uncertain / undated ({chronology.uncertain.length})
              </h3>
              <p className="field-note">
                Publication precision does not support a reliable position on
                the chronological axis. No midnight or browser time zone is
                inferred.
              </p>
              <ul className="source-items">
                {chronology.uncertain.map((node) => renderRow(node))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </section>
  )
}
