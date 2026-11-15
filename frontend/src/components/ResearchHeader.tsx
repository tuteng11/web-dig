import { useId } from 'react'
import type { DemoTransport } from '../config'
import type { GraphResult, SourceNode } from '../contracts/newsTrace'
import { formatPublication, readPublicationInstant } from '../domain/format'
import {
  displayNodeTitle,
  isSafeExternalUrl,
  sourceIdentity,
} from '../domain/nodes'

interface ResearchHeaderProps {
  phase: 'loading' | 'ready' | 'error'
  graph: GraphResult | null
  question: string
  sourceUrl: string | null
  seedNode: SourceNode | null
  rootNode: SourceNode | null
  fixture: boolean
  transport: DemoTransport | null
  demoNotice: string | null
  originNotice: string | null
  onNewResearch(): void
}

function NodeSummary({
  node,
  badge,
  badgeClass,
}: {
  node: SourceNode
  badge: string
  badgeClass: string
}) {
  const title = displayNodeTitle(node)
  const publication = formatPublication(node.publication)
  const timeUncertain = readPublicationInstant(node.publication) === null

  return (
    <>
      <span className="node-badges">
        <span className={`badge ${badgeClass}`}>{badge}</span>
        {timeUncertain ? (
          <span className="badge badge-uncertain">Time-uncertain</span>
        ) : null}
      </span>
      <span
        className={`tb-header-node-title${title.isUrlFallback ? ' tb-url-fallback' : ''}`}
      >
        {title.isUrlFallback ? 'URL: ' : ''}
        {title.text}
      </span>
      <span className="tb-header-node-meta">{sourceIdentity(node)}</span>
      <span className="tb-header-node-meta">{publication.compactText}</span>
    </>
  )
}

export function ResearchHeader({
  phase,
  graph,
  question,
  sourceUrl,
  seedNode,
  rootNode,
  fixture,
  transport,
  demoNotice,
  originNotice,
  onNewResearch,
}: ResearchHeaderProps) {
  const headingId = useId()
  const originStatus = graph?.origin_assessment.status ?? null
  const submittedUrlIsSafe = sourceUrl !== null && isSafeExternalUrl(sourceUrl)
  const rootTimeUncertain =
    rootNode !== null && readPublicationInstant(rootNode.publication) === null
  const rootIsUnplaced =
    rootNode !== null && (graph?.undated_node_ids ?? []).includes(rootNode.id)

  const earliestBadge =
    originStatus === 'provisional'
      ? { label: 'Provisional earliest evidence', className: 'badge-provisional' }
      : originStatus === 'unresolved'
        ? { label: 'Unresolved earliest candidate', className: 'badge-uncertain' }
        : { label: 'Earliest evidence found', className: 'badge-root' }

  const fixtureBadgeLabel = fixture
    ? transport === 'gateway'
      ? 'Synthetic fixture · gateway'
      : transport === 'bundled'
        ? 'Synthetic fixture · bundled'
        : 'Synthetic fixture'
    : 'Live mode'
  const fixtureBadgeTitle = fixture
    ? transport === 'gateway'
      ? 'Synthetic fixture data served read-only by the configured backend gateway. Demo jobs are not implemented in this milestone.'
      : transport === 'bundled'
        ? 'Bundled synthetic fixture data. No live search, page fetch, model execution, or backend request was performed.'
        : 'Synthetic fixture data. No live search, page fetch, or model execution was performed.'
    : 'Live gateway mode. Displayed data comes from the configured backend.'

  const statusLine =
    phase === 'loading'
      ? 'Loading the research graph… No progress is estimated.'
      : phase === 'error'
        ? 'The graph is unavailable. No fallback or synthetic data is being substituted for this error.'
        : graph
          ? `Graph loaded · revision ${graph.graph_revision} · ${graph.nodes.length} source${graph.nodes.length === 1 ? '' : 's'}`
          : 'No graph is available.'

  return (
    <header className="research-header-card" aria-labelledby={headingId}>
      <div className="tb-header-copy">
        <div className="tb-header-topline">
          <div className="tb-header-copy">
            <p className="tb-eyebrow">Research run</p>
            <h2 id={headingId} className="tb-research-question">
              {question.trim().length > 0
                ? question
                : 'Research question not available.'}
            </h2>
          </div>
          <span
            className={`badge ${fixture ? 'badge-provisional' : 'badge-neutral'}`}
            title={fixtureBadgeTitle}
          >
            {fixtureBadgeLabel}
          </span>
        </div>

        <p className="field-note" role="status" aria-live="polite">
          {statusLine}
        </p>
      </div>

      {demoNotice ? (
        <p className="origin-notice" role="status">
          {demoNotice}
        </p>
      ) : null}

      <dl className="header-facts">
        <div className="header-fact">
          <dt>Graph revision</dt>
          <dd>
            {graph ? (
              <span className="tb-header-revision">{graph.graph_revision}</span>
            ) : (
              <span className="muted">
                {phase === 'loading' ? 'Waiting for graph…' : 'Not available'}
              </span>
            )}
          </dd>
        </div>

        <div className="header-fact">
          <dt>Submitted source</dt>
          <dd>
            {seedNode ? (
              <NodeSummary
                node={seedNode}
                badge="Submitted source"
                badgeClass="badge-seed"
              />
            ) : (
              <span className="tb-header-node-meta">
                {phase === 'loading'
                  ? 'Waiting for the submitted source…'
                  : 'Submitted source is not available in this run.'}
              </span>
            )}
            {sourceUrl ? (
              submittedUrlIsSafe ? (
                <a
                  className="tb-source-url"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open submitted source URL
                </a>
              ) : (
                <span className="tb-header-node-meta">
                  The submitted URL is not a safe HTTP(S) link, so it is shown
                  as text only: {sourceUrl}
                </span>
              )
            ) : (
              <span className="tb-header-node-meta">
                No separate source URL was submitted for this run.
              </span>
            )}
          </dd>
        </div>

        <div className="header-fact">
          <dt>Earliest evidence</dt>
          <dd>
            {rootNode ? (
              <NodeSummary
                node={rootNode}
                badge={earliestBadge.label}
                badgeClass={earliestBadge.className}
              />
            ) : (
              <span className="tb-header-node-meta">
                {phase === 'loading'
                  ? 'Waiting for the graph…'
                  : originStatus === 'unresolved'
                    ? 'Origin unresolved: no earliest evidence was identified within these results.'
                    : 'No earliest evidence is available in this graph.'}
              </span>
            )}
            {rootNode && (rootIsUnplaced || rootTimeUncertain) ? (
              <span className="field-note">
                This origin candidate has no reliable dated position, so it is
                shown in the time-uncertain lane rather than given an invented
                date.
              </span>
            ) : null}
            {originStatus === 'provisional' ? (
              <span className="field-note">
                Provisional within the loaded results only; coverage may be
                incomplete.
              </span>
            ) : null}
            {originStatus === 'unresolved' ? (
              <span className="field-note">
                The backend could not resolve the origin within these results.
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {originNotice ? (
        <p className="origin-notice" role="status">
          {originNotice}
        </p>
      ) : null}

      <div className="tb-header-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onNewResearch}
        >
          New research
        </button>
        <p className="field-note">
          Starts a new research session and discards the current workspace.
        </p>
      </div>
    </header>
  )
}
