import { useEffect, useId, useRef } from 'react'
import type {
  AdditionalCandidate,
  AnswerResult,
} from '../contracts/http'
import type { SourceNode } from '../contracts/newsTrace'
import { formatPublication, formatRetrievedAt } from '../domain/format'
import {
  displayNodeTitle,
  isSafeExternalUrl,
  sourceName,
} from '../domain/nodes'

export interface CitationDrawerProps {
  open: boolean
  answer: AnswerResult | null
  activeCitationId: string | null
  nodeById: Map<string, SourceNode>
  candidateById: Map<string, AdditionalCandidate>
  onClose(): void
}

function SafeExternalLink({
  url,
  label,
  className,
}: {
  url: string
  label: string
  className?: string
}) {
  if (!isSafeExternalUrl(url)) {
    return (
      <span className="unsafe-url">
        {label}{' '}
        <span className="field-note">
          (not opened: this is not a safe HTTP(S) address)
        </span>
      </span>
    )
  }

  return (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {label}
    </a>
  )
}

export function CitationDrawer({
  open,
  answer,
  activeCitationId,
  nodeById,
  candidateById,
  onClose,
}: CitationDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const activeItemRef = useRef<HTMLLIElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }

    if (open) {
      if (!dialog.open) {
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        dialog.showModal()
      }

      return () => {
        if (dialog.open) {
          dialog.close()
        }
        const target = restoreFocusRef.current
        restoreFocusRef.current = null
        if (target && target.isConnected) {
          target.focus()
        }
      }
    }

    if (dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (!open || !activeCitationId) {
      return
    }
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, activeCitationId])

  const citations = answer?.citations ?? []
  const selectedNodeIds = new Set(
    (answer?.selected_nodes ?? []).map((pin) => pin.node_id),
  )

  return (
    <dialog
      ref={dialogRef}
      className="citation-drawer"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="citation-drawer-body">
        <div className="citation-top">
          <div>
            <h2 id={titleId}>Answer citations</h2>
            <p className="field-note">
              Exact quotes or metadata values supplied by the gateway. No
              citation text is generated in the browser.
            </p>
          </div>
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
            autoFocus
            aria-label="Close citation drawer"
          >
            Close
          </button>
        </div>

        {!answer ? (
          <div className="state-card state-empty">
            <p>No answer is available to cite.</p>
          </div>
        ) : citations.length === 0 ? (
          <p className="empty-list-note">
            This answer did not include any citations.
          </p>
        ) : (
          <ol className="citation-list">
            {citations.map((citation, index) => {
              const node = nodeById.get(citation.node_id)
              const candidate = candidateById.get(citation.node_id)
              const additional = !selectedNodeIds.has(citation.node_id)
              const active = citation.id === activeCitationId
              const nodeTitle = node ? displayNodeTitle(node) : null
              const title = nodeTitle
                ? nodeTitle.text
                : candidate
                  ? candidate.title?.trim() || candidate.url
                  : citation.node_id
              const publication = node?.publication ?? candidate?.publication
              const publicationDisplay = publication
                ? formatPublication(publication)
                : null
              const sourceLine = node
                ? `${sourceName(node)}${
                    node.source.platform ? ` · ${node.source.platform}` : ''
                  }`
                : candidate
                  ? `${candidate.source.name?.trim() || candidate.source.domain} · ${candidate.source.domain}`
                  : 'No source record was supplied for this citation.'
              const retrieval = node
                ? formatRetrievedAt(node.retrieved_at)
                : 'Not supplied for this additional candidate.'
              const externalUrl = node?.canonical_url ?? candidate?.url ?? null
              const metadataField =
                typeof citation.metadata_field === 'string' &&
                citation.metadata_field.trim().length > 0
                  ? citation.metadata_field.trim()
                  : null
              const metadataValue =
                typeof citation.metadata_value === 'string' &&
                citation.metadata_value.trim().length > 0
                  ? citation.metadata_value.trim()
                  : null
              const metadataPresent =
                metadataField !== null || metadataValue !== null
              const quotePresent =
                typeof citation.quote === 'string' &&
                citation.quote.trim().length > 0

              return (
                <li
                  key={citation.id}
                  ref={active ? activeItemRef : null}
                  className={
                    active
                      ? 'citation-item citation-item-active'
                      : 'citation-item'
                  }
                  aria-current={active ? 'true' : undefined}
                >
                  <div className="badge-row">
                    <span className="kind-chip">Citation {index + 1}</span>
                    <span
                      className={
                        additional
                          ? 'badge badge-cross-link'
                          : 'badge badge-neutral'
                      }
                    >
                      {additional ? 'Additional source' : 'Selected source'}
                    </span>
                    {active ? (
                      <span className="badge badge-soft">Opened</span>
                    ) : null}
                  </div>
                  <h3 className="detail-section-heading">
                    {nodeTitle?.isUrlFallback ? (
                      <span className="fallback-label">URL</span>
                    ) : null}
                    {title}
                  </h3>
                  <p className="citation-meta">{sourceLine}</p>

                  {quotePresent ? (
                    <blockquote className="citation-quote">
                      {citation.quote}
                    </blockquote>
                  ) : null}
                  {metadataPresent ? (
                    <p className="citation-meta">
                      <strong>{metadataField ?? 'Metadata value'}:</strong>{' '}
                      {metadataValue ?? 'Not supplied'}
                    </p>
                  ) : null}
                  {!quotePresent && !metadataPresent ? (
                    <p className="citation-meta">
                      No quote or metadata field/value was supplied for this
                      citation.
                    </p>
                  ) : null}

                  <dl className="meta-grid">
                    <dt>Source node</dt>
                    <dd>{citation.node_id}</dd>
                    <dt>Snapshot</dt>
                    <dd>{citation.snapshot_id}</dd>
                    <dt>Evidence record</dt>
                    <dd>{citation.evidence_id}</dd>
                    <dt>Publication</dt>
                    <dd>
                      {publicationDisplay
                        ? `${publicationDisplay.headline}${
                            publicationDisplay.timeNote
                              ? ` — ${publicationDisplay.timeNote}`
                              : ''
                          }`
                        : 'Publication metadata not supplied'}
                    </dd>
                    {publicationDisplay ? (
                      <>
                        <dt>Precision</dt>
                        <dd>{publicationDisplay.precisionLabel}</dd>
                        <dt>Time zone</dt>
                        <dd>
                          {publication?.timezone_status === 'known'
                            ? publicationDisplay.offsetLabel ??
                              'Reported as known'
                            : 'Not reported'}
                        </dd>
                        <dt>Original raw text</dt>
                        <dd>{publicationDisplay.rawText ?? 'Not supplied'}</dd>
                      </>
                    ) : null}
                    <dt>Retrieved</dt>
                    <dd>{retrieval}</dd>
                    {typeof citation.start === 'number' &&
                    typeof citation.end === 'number' ? (
                      <>
                        <dt>Quote offsets</dt>
                        <dd>
                          {citation.start}–{citation.end}
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  {externalUrl ? (
                    <p>
                      <SafeExternalLink
                        url={externalUrl}
                        label="Open source page"
                        className="open-source"
                      />
                    </p>
                  ) : (
                    <p className="field-note">
                      No external source URL was supplied.
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </dialog>
  )
}
