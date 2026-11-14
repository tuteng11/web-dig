import { useId, useMemo, type ReactNode } from 'react'
import type {
  Evidence,
  GraphResult,
  NodeDetails as NodeDetailsPayload,
  Relationship,
  SourceNode,
} from '../contracts/newsTrace'
import type { UiError } from '../domain/errors'
import {
  formatPublication,
  formatRetrievedAt,
  readPublicationInstant,
} from '../domain/format'
import {
  contentKindLabel,
  contentStatusLabel,
  displayNodeTitle,
  isSafeExternalUrl,
  relationshipKindLabel,
  relationshipMethodLabel,
  relationshipStatusLabel,
  sourceIdentity,
  sourceName,
} from '../domain/nodes'

export type DetailState =
  | { status: 'idle' }
  | { status: 'loading'; nodeId: string }
  | { status: 'error'; nodeId: string; error: UiError }
  | { status: 'ready'; nodeId: string; details: NodeDetailsPayload }

export interface NodeDetailsProps {
  graph: GraphResult
  nodeById: Map<string, SourceNode>
  nodeId: string | null
  details: DetailState
  onRetry(): void
  onSelect(id: string): void
  selectedSlot: 'A' | 'B' | null
  crossLinkIds: Set<string>
  onExpand(id: string): void
  expanding: boolean
  expandError: UiError | null
}

function supplied(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function SafeExternalLink({
  url,
  label,
}: {
  url: string
  label?: string
}) {
  const text = label ?? url
  if (!isSafeExternalUrl(url)) {
    return (
      <span className="unsafe-url">
        {text}{' '}
        <span className="field-note">
          (not opened: this is not a safe HTTP(S) address)
        </span>
      </span>
    )
  }

  return (
    <a href={url} target="_blank" rel="noreferrer noopener">
      {text}
    </a>
  )
}

function ErrorNotice({
  error,
  title,
  compact = false,
}: {
  error: UiError
  title?: string
  compact?: boolean
}) {
  return (
    <div
      className={compact ? 'field-error' : 'state-card state-error'}
      role="alert"
    >
      {title ? <strong>{title}</strong> : null}
      <p>{error.message}</p>
      <p className="error-meta">
        <span className="error-code">{error.code}</span>
        {' · '}
        {error.retryable ? 'Retryable' : 'Not reported as retryable'}
        {error.requestId ? ` · Request ${error.requestId}` : ''}
      </p>
      {error.details.length > 0 ? (
        <details className="error-details">
          <summary>Response validation details</summary>
          <ul>
            {error.details.map((detail, index) => (
              <li key={`${index}-${detail}`}>{detail}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function evidenceKindLabel(kind: Evidence['kind']): string {
  switch (kind) {
    case 'text_quote':
      return 'Text quote'
    case 'link':
      return 'Link'
    case 'metadata':
      return 'Metadata'
    case 'snippet':
      return 'Search snippet'
    case 'search_result':
      return 'Search result'
  }
}

function EvidenceItem({ item }: { item: Evidence }) {
  const offsets =
    typeof item.start === 'number' && typeof item.end === 'number'
      ? ` · offsets ${item.start}–${item.end}`
      : ''

  return (
    <li className="evidence-item">
      <div className="evidence-topline">
        <span className="kind-chip">{evidenceKindLabel(item.kind)}</span>
        <span className="evidence-snapshot">Snapshot {item.snapshot_id}</span>
      </div>
      {item.quote ? <blockquote>{item.quote}</blockquote> : null}
      {item.metadata_field ? (
        <p className="evidence-metadata">
          <strong>{item.metadata_field}:</strong>{' '}
          {supplied(item.metadata_value) ?? 'Not supplied'}
        </p>
      ) : null}
      {item.link_target ? (
        <p className="evidence-link">
          Link target:{' '}
          <SafeExternalLink url={item.link_target} />
        </p>
      ) : null}
      {!item.quote && !item.metadata_field && !item.link_target ? (
        <p className="empty-list-note">
          No quote, metadata value, or link target was supplied for this
          evidence record.
        </p>
      ) : null}
      <p className="evidence-meta">
        Evidence {item.id} · retrieved {formatRetrievedAt(item.retrieved_at)}
        {offsets}
      </p>
    </li>
  )
}

function safeNodeTitle(
  nodeById: Map<string, SourceNode>,
  nodeId: string,
): string {
  const node = nodeById.get(nodeId)
  if (!node) {
    return nodeId
  }
  const title = displayNodeTitle(node)
  return title.isUrlFallback ? `URL: ${title.text}` : title.text
}

function RelationshipItem({
  relationship,
  nodeById,
  isCrossLink,
}: {
  relationship: Relationship
  nodeById: Map<string, SourceNode>
  isCrossLink: boolean
}) {
  const fromTitle = safeNodeTitle(nodeById, relationship.from_node_id)
  const toTitle = safeNodeTitle(nodeById, relationship.to_node_id)
  const direction = relationship.directed
    ? `${fromTitle} → ${toTitle}`
    : `Undirected relationship between ${fromTitle} and ${toTitle}.`

  return (
    <li className="relationship-item">
      <div className="badge-row">
        <span className="badge badge-neutral">
          {relationshipKindLabel(relationship.kind)}
        </span>
        <span className="badge badge-soft">
          {relationshipMethodLabel(relationship.method)}
        </span>
        <span
          className={`badge ${
            relationship.status === 'validated'
              ? 'badge-validated'
              : 'badge-provisional'
          }`}
        >
          {relationshipStatusLabel(relationship.status)}
        </span>
        {isCrossLink ? (
          <span className="badge badge-cross-link">Cross-link</span>
        ) : null}
      </div>
      <p className="relationship-explanation">{relationship.explanation}</p>
      <p className="relationship-direction">
        <strong>Factual direction:</strong> {direction}
      </p>
      <p className="evidence-meta">
        {relationship.evidence_ids && relationship.evidence_ids.length > 0
          ? `Evidence IDs: ${relationship.evidence_ids.join(', ')}`
          : 'No evidence ids supplied.'}
      </p>
      {typeof relationship.score === 'number' ? (
        <p className="evidence-meta">Method score: {relationship.score}</p>
      ) : null}
      <p className="evidence-meta">
        Relationship {relationship.id} · recorded{' '}
        {formatRetrievedAt(relationship.created_at)}
      </p>
    </li>
  )
}

export function NodeDetails({
  graph,
  nodeById,
  nodeId,
  details,
  onRetry,
  onSelect,
  selectedSlot,
  crossLinkIds,
  onExpand,
  expanding,
  expandError,
}: NodeDetailsProps) {
  const headingId = useId()
  const graphNode = nodeId ? nodeById.get(nodeId) ?? null : null

  const relationships = useMemo(() => {
    const focusId =
      details.status === 'ready' ? details.details.node.id : nodeId
    if (!focusId) {
      return []
    }

    const merged = new Map<string, Relationship>()
    for (const relationship of graph.relationships) {
      if (
        relationship.from_node_id === focusId ||
        relationship.to_node_id === focusId
      ) {
        merged.set(relationship.id, relationship)
      }
    }
    if (details.status === 'ready') {
      for (const relationship of details.details.relationships ?? []) {
        merged.set(relationship.id, relationship)
      }
    }

    return [...merged.values()].sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id),
    )
  }, [details, graph.relationships, nodeId])

  function shell(children: ReactNode) {
    return (
      <section className="detail-panel" aria-labelledby={headingId}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Details</p>
            <h2 id={headingId}>Node details</h2>
          </div>
        </div>
        {children}
      </section>
    )
  }

  if (details.status === 'idle') {
    return shell(
      <>
        <p className="detail-placeholder">
          Inspect a source from the tree or the source list to load its
          metadata, publication provenance, evidence, and relationship records.
        </p>
        {nodeId ? (
          <div className="detail-content">
            <div className="question-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={onRetry}
              >
                Load node details
              </button>
            </div>
          </div>
        ) : null}
      </>,
    )
  }

  if (details.status === 'loading') {
    const title = graphNode ? displayNodeTitle(graphNode) : null
    return shell(
      <div className="detail-loading" role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span>
          Loading node details
          {title ? ` for ${title.isUrlFallback ? `URL ${title.text}` : title.text}` : ''}
          …
        </span>
      </div>,
    )
  }

  if (details.status === 'error') {
    const title = graphNode ? displayNodeTitle(graphNode) : null
    return shell(
      <div className="detail-error" role="alert">
        <h3>
          {title
            ? title.isUrlFallback
              ? `URL ${title.text}`
              : title.text
            : 'Node details unavailable'}
        </h3>
        <ErrorNotice error={details.error} compact />
        <div className="question-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onRetry}
          >
            Retry node details
          </button>
        </div>
        <p className="limitation-note">
          The loaded tree is unchanged. No details were invented.
        </p>
      </div>,
    )
  }

  const detailPayload = details.details
  const node = detailPayload.node
  const title = displayNodeTitle(node)
  const publication = formatPublication(node.publication)
  const uncertain = readPublicationInstant(node.publication) === null
  const snapshot = detailPayload.snapshot ?? null
  const snapshotId = snapshot?.id ?? supplied(node.snapshot_id)
  const snapshotExcerpt = supplied(snapshot?.excerpt)
  const nodeExcerpt = supplied(node.excerpt)
  const excerpt = nodeExcerpt ?? snapshotExcerpt
  const evidence = detailPayload.evidence ?? []
  const nodeWarnings = node.warnings ?? []
  const detailWarnings = detailPayload.warnings ?? []
  const coverageNotes = detailPayload.coverage_notes ?? []
  const updatedAt = supplied(node.updated_at)
  const titleMismatch =
    details.nodeId !== node.id
      ? `Details were returned for ${details.nodeId}, not the inspected node ${node.id}.`
      : null

  return shell(
    <>
      <article className="detail-content">
        <header className="detail-source-header">
          <div className="badge-row">
            {node.id === graph.root_node_id ? (
              <span className="badge badge-root">Earliest evidence found</span>
            ) : null}
            {node.id === graph.seed_node_id ? (
              <span className="badge badge-seed">Submitted source</span>
            ) : null}
            {uncertain ? (
              <span className="badge badge-uncertain">Time-uncertain</span>
            ) : null}
            {selectedSlot ? (
              <span className="badge badge-soft">
                Question slot {selectedSlot}
              </span>
            ) : null}
          </div>
          <h3 className={`detail-title${title.isUrlFallback ? ' url-fallback' : ''}`}>
            {title.isUrlFallback ? (
              <span className="fallback-label">URL</span>
            ) : null}
            {title.text}
          </h3>
          <p className="detail-source-line">
            {sourceIdentity(node)}
            {node.source.platform ? ` · ${node.source.platform}` : ''}
          </p>
          <p className="detail-status-line">
            {contentStatusLabel(node.content_status)} · {sourceName(node)}
          </p>
          <div className="source-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onSelect(node.id)}
              disabled={selectedSlot !== null}
              title={
                selectedSlot
                  ? `Already selected in slot ${selectedSlot}`
                  : undefined
              }
            >
              {selectedSlot
                ? `Selected as ${selectedSlot}`
                : 'Select for question'}
            </button>
          </div>
          {titleMismatch ? (
            <p className="field-error" role="alert">
              {titleMismatch}
            </p>
          ) : null}
        </header>

        <section className="workspace-section" aria-labelledby={`${headingId}-source`}>
          <h3 id={`${headingId}-source`} className="detail-section-heading">
            Source metadata
          </h3>
          <dl className="meta-grid">
            <dt>Node ID</dt>
            <dd>{node.id}</dd>
            <dt>Research ID</dt>
            <dd>{node.research_id}</dd>
            <dt>Title</dt>
            <dd>{supplied(node.title) ?? 'Not supplied (URL is shown above)'}</dd>
            <dt>Author</dt>
            <dd>{supplied(node.author) ?? 'Not supplied'}</dd>
            <dt>Source name</dt>
            <dd>{sourceName(node)}</dd>
            <dt>Domain</dt>
            <dd>{node.source.domain}</dd>
            <dt>Platform</dt>
            <dd>{supplied(node.source.platform) ?? 'Not supplied'}</dd>
            <dt>Content kind</dt>
            <dd>{contentKindLabel(node.content_kind)}</dd>
            <dt>Content status</dt>
            <dd>{contentStatusLabel(node.content_status)}</dd>
            <dt>Canonical URL</dt>
            <dd>
              <SafeExternalLink url={node.canonical_url} />
            </dd>
            <dt>Requested URL</dt>
            <dd>
              <SafeExternalLink url={node.requested_url} />
            </dd>
          </dl>
        </section>

        <section className="workspace-section" aria-labelledby={`${headingId}-excerpt`}>
          <h3 id={`${headingId}-excerpt`} className="detail-section-heading">
            Excerpt
          </h3>
          {excerpt ? (
            <blockquote className="excerpt-block">{excerpt}</blockquote>
          ) : (
            <p className="empty-list-note">
              No excerpt was supplied. No source text has been invented.
            </p>
          )}
        </section>

        <section
          className="workspace-section"
          aria-labelledby={`${headingId}-publication`}
        >
          <h3 id={`${headingId}-publication`} className="detail-section-heading">
            Publication provenance
          </h3>
          <dl className="meta-grid">
            <dt>Publication</dt>
            <dd>
              {publication.headline}
              {publication.timeNote ? ` — ${publication.timeNote}` : ''}
            </dd>
            <dt>Precision</dt>
            <dd>{publication.precisionLabel}</dd>
            <dt>Time zone status</dt>
            <dd>
              {node.publication.timezone_status === 'known'
                ? publication.offsetLabel ?? 'Reported as known'
                : 'Not reported'}
            </dd>
            {publication.zoneNote ? (
              <>
                <dt>Zone note</dt>
                <dd>{publication.zoneNote}</dd>
              </>
            ) : null}
            {publication.localNote ? (
              <>
                <dt>Local display</dt>
                <dd>{publication.localNote}</dd>
              </>
            ) : null}
            <dt>Publication date field</dt>
            <dd>{supplied(node.publication.date) ?? 'Not supplied'}</dd>
            <dt>Publication timestamp field</dt>
            <dd>{supplied(node.publication.timestamp) ?? 'Not supplied'}</dd>
            <dt>Original raw text</dt>
            <dd>{publication.rawText ?? 'Not supplied'}</dd>
            <dt>Publication evidence ID</dt>
            <dd>{supplied(node.publication.evidence_id) ?? 'Not supplied'}</dd>
          </dl>
          {uncertain ? (
            <p className="limitation-note">
              This publication time is not a fully verified instant. No time
              zone conversion has been invented.
            </p>
          ) : null}
        </section>

        <section
          className="workspace-section"
          aria-labelledby={`${headingId}-times`}
        >
          <h3 id={`${headingId}-times`} className="detail-section-heading">
            Retrieval and snapshot
          </h3>
          <dl className="meta-grid">
            <dt>Retrieved</dt>
            <dd>
              {formatRetrievedAt(node.retrieved_at)}
              <span className="field-note">
                {' '}
                — retrieval time, not publication time
              </span>
            </dd>
            <dt>Discovered</dt>
            <dd>{formatRetrievedAt(node.discovered_at)}</dd>
            <dt>Updated</dt>
            <dd>{updatedAt ? formatRetrievedAt(updatedAt) : 'Not supplied'}</dd>
            <dt>Snapshot ID</dt>
            <dd>{snapshotId ?? 'Not supplied'}</dd>
            <dt>Snapshot captured</dt>
            <dd>
              {snapshot ? formatRetrievedAt(snapshot.captured_at) : 'Not supplied'}
            </dd>
            <dt>Snapshot content status</dt>
            <dd>
              {snapshot
                ? contentStatusLabel(snapshot.content_status)
                : 'Not supplied'}
            </dd>
            <dt>Snapshot content hash</dt>
            <dd className="mono">{supplied(snapshot?.content_hash) ?? 'Not supplied'}</dd>
            <dt>Node content hash</dt>
            <dd className="mono">{supplied(node.content_hash) ?? 'Not supplied'}</dd>
          </dl>
          {snapshot ? null : (
            <p className="field-note">
              No snapshot payload was returned for this node. Only the node’s
              stored snapshot identifier is shown where supplied.
            </p>
          )}
        </section>

        <section
          className="workspace-section"
          aria-labelledby={`${headingId}-evidence`}
        >
          <h3 id={`${headingId}-evidence`} className="detail-section-heading">
            Evidence
          </h3>
          {evidence.length === 0 ? (
            <p className="empty-list-note">
              No evidence records were supplied.
            </p>
          ) : (
            <ul className="evidence-list">
              {evidence.map((item) => (
                <EvidenceItem key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <section
          className="workspace-section"
          aria-labelledby={`${headingId}-relationships`}
        >
          <h3 id={`${headingId}-relationships`} className="detail-section-heading">
            Relationships and cross-links
          </h3>
          {relationships.length === 0 ? (
            <p className="empty-list-note">
              No relationship records were supplied for this source.
            </p>
          ) : (
            <ul className="relationship-list">
              {relationships.map((relationship) => (
                <RelationshipItem
                  key={relationship.id}
                  relationship={relationship}
                  nodeById={nodeById}
                  isCrossLink={crossLinkIds.has(relationship.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section
          className="workspace-section"
          aria-labelledby={`${headingId}-warnings`}
        >
          <h3 id={`${headingId}-warnings`} className="detail-section-heading">
            Warnings and coverage
          </h3>
          {nodeWarnings.length === 0 &&
          detailWarnings.length === 0 &&
          coverageNotes.length === 0 ? (
            <p className="empty-list-note">
              No source warnings or coverage notes were supplied.
            </p>
          ) : (
            <>
              {nodeWarnings.length > 0 ? (
                <>
                  <h4>Source warnings</h4>
                  <ul className="limitation-note">
                    {nodeWarnings.map((warning, index) => (
                      <li key={`node-${index}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {detailWarnings.length > 0 ? (
                <>
                  <h4>Detail warnings</h4>
                  <ul className="limitation-note">
                    {detailWarnings.map((warning, index) => (
                      <li key={`detail-${index}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {coverageNotes.length > 0 ? (
                <>
                  <h4>Coverage notes</h4>
                  <ul className="limitation-note">
                    {coverageNotes.map((note, index) => (
                      <li key={`coverage-${index}-${note}`}>{note}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </section>

        <section
          className="workspace-section"
          aria-labelledby={`${headingId}-expand`}
        >
          <h3 id={`${headingId}-expand`} className="detail-section-heading">
            Expand this node
          </h3>
          <p className="field-note">
            Expansion asks the gateway for further validated sources connected
            to this node. The loaded tree is unchanged until a validated
            revision arrives.
          </p>
          <div className="question-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => onExpand(node.id)}
              disabled={expanding}
              aria-busy={expanding}
            >
              {expanding
                ? 'Expanding…'
                : expandError
                  ? 'Try expansion again'
                  : 'Expand this node'}
            </button>
          </div>
          {expandError ? (
            <ErrorNotice
              error={expandError}
              title="Expansion failed"
              compact
            />
          ) : null}
        </section>
      </article>
    </>,
  )
}
