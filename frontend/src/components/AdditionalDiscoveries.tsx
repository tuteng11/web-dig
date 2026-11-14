import { useId } from 'react'
import type { AdditionalCandidate } from '../contracts/http'
import type { SourceInfo } from '../contracts/newsTrace'
import type { UiError } from '../domain/errors'
import { formatPublication } from '../domain/format'
import {
  contentStatusLabel,
  isSafeExternalUrl,
  relationshipKindLabel,
} from '../domain/nodes'

export interface AdditionalDiscoveriesProps {
  candidates: AdditionalCandidate[]
  selectedIds: Set<string>
  graphRevision: number
  currentGraphRevision: number
  adding: boolean
  error: UiError | null
  onToggle(id: string): void
  onAdd(): void
}

function sourceInfoLabel(source: SourceInfo): string {
  const name = source.name?.trim()
  if (name && name.length > 0 && name !== source.domain) {
    return `${name} · ${source.domain}`
  }
  return source.domain
}

function SafeExternalLink({ url, label }: { url: string; label: string }) {
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
    <a href={url} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  )
}

function ErrorNotice({ error }: { error: UiError }) {
  return (
    <div className="state-card state-error" role="alert">
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

export function AdditionalDiscoveries({
  candidates,
  selectedIds,
  graphRevision,
  currentGraphRevision,
  adding,
  error,
  onToggle,
  onAdd,
}: AdditionalDiscoveriesProps) {
  const headingId = useId()
  const fieldIdBase = useId()
  const stale = graphRevision !== currentGraphRevision
  const selectedCount = candidates.filter((candidate) =>
    selectedIds.has(candidate.candidate_id),
  ).length
  const addDisabled = adding || stale || selectedCount === 0

  return (
    <section
      className="additional-discoveries"
      aria-labelledby={headingId}
      aria-busy={adding}
    >
      <div className="badge-row">
        <h3 id={headingId}>Additional discoveries</h3>
        <span className="count-chip">
          {candidates.length}{' '}
          {candidates.length === 1 ? 'candidate' : 'candidates'}
        </span>
      </div>
      <p className="field-note">
        These findings are not part of the tree. They stay separate until you
        check them and explicitly choose “Add to tree”. Nothing is inserted
        automatically.
      </p>

      {stale ? (
        <div className="answer-stale" role="alert">
          <p>
            <strong>Graph revision conflict.</strong> This answer was pinned to
            revision {graphRevision}, but the tree is now at revision{' '}
            {currentGraphRevision}. Adding these discoveries would target an
            outdated revision, so the add action is disabled.
          </p>
          <p className="limitation-note">
            Ask again against the current revision to review discoveries that
            can be added safely.
          </p>
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <p className="empty-list-note">
          No additional discoveries were supplied for this answer.
        </p>
      ) : (
        <ul className="candidate-list">
          {candidates.map((candidate, index) => {
            const checkboxId = `${fieldIdBase}-${index}`
            const title = candidate.title?.trim() || 'Untitled discovery'
            const publication = formatPublication(candidate.publication)
            const checked = selectedIds.has(candidate.candidate_id)

            return (
              <li className="candidate-item" key={candidate.candidate_id}>
                <div className="candidate-check">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={checked}
                    disabled={adding}
                    onChange={() => onToggle(candidate.candidate_id)}
                    aria-label={`Select additional discovery: ${title}`}
                  />
                  <div>
                    <label htmlFor={checkboxId} className="candidate-title">
                      {title}
                    </label>
                    <div className="badge-row">
                      <span className="badge badge-neutral">
                        {contentStatusLabel(candidate.content_status)}
                      </span>
                      <span className="badge badge-soft">
                        {sourceInfoLabel(candidate.source)}
                      </span>
                    </div>
                    <p className="candidate-meta">
                      {publication.headline}
                      {publication.timeNote
                        ? ` — ${publication.timeNote}`
                        : ''}
                    </p>
                    <p className="candidate-meta">
                      <SafeExternalLink
                        url={candidate.url}
                        label="Open discovery URL"
                      />
                    </p>
                    {candidate.snippet ? (
                      <p className="candidate-snippet">{candidate.snippet}</p>
                    ) : (
                      <p className="candidate-snippet">
                        No snippet was supplied.
                      </p>
                    )}
                    <p className="candidate-meta">
                      Relationship hypothesis:{' '}
                      {candidate.relationship_hypothesis
                        ? relationshipKindLabel(
                            candidate.relationship_hypothesis,
                          )
                        : 'No hypothesis supplied'}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="candidate-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onAdd}
          disabled={addDisabled}
          aria-busy={adding}
          title={
            stale
              ? 'The graph revision changed; refresh or ask again before adding discoveries.'
              : selectedCount === 0
                ? 'Select at least one additional discovery to add.'
                : undefined
          }
        >
          {adding ? 'Adding to tree…' : 'Add to tree'}
        </button>
      </div>
      <p className="field-note">
        {selectedCount} of {candidates.length} selected. The gateway validates
        the selected candidate IDs against the graph revision before any node
        enters the tree.
      </p>

      {error ? <ErrorNotice error={error} /> : null}
    </section>
  )
}
