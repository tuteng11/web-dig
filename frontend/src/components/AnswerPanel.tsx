import { useId } from 'react'
import type {
  AdditionalCandidate,
  AnswerCitation,
  AnswerResult,
  AnswerStatement,
} from '../contracts/http'
import type { SourceNode } from '../contracts/newsTrace'
import type { UiError } from '../domain/errors'
import { formatPublication, formatRetrievedAt } from '../domain/format'
import { displayNodeTitle, sourceName } from '../domain/nodes'
import { AdditionalDiscoveries } from './AdditionalDiscoveries'
import type { JobView } from './jobView'

export interface AnswerRecord {
  question: string
  nodeIds: [string, string]
  graphRevision: number
  answer: AnswerResult | null
  job: JobView | null
  error: UiError | null
}

export interface AnswerPanelProps {
  record: AnswerRecord
  nodeById: Map<string, SourceNode>
  candidateById: Map<string, AdditionalCandidate>
  onOpenCitation(citationId: string): void
  onToggleCandidate(candidateId: string): void
  selectedCandidateIds: Set<string>
  onAddDiscoveries(): void
  adding: boolean
  addError: UiError | null
  currentGraphRevision: number
  validationError?: string[] | null
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

function outcomeLabel(outcome: AnswerResult['outcome']): string {
  switch (outcome) {
    case 'answered':
      return 'Answered'
    case 'partial':
      return 'Partially answered'
    case 'insufficient_evidence':
      return 'Insufficient evidence'
  }
}

function outcomeBadgeClass(outcome: AnswerResult['outcome']): string {
  switch (outcome) {
    case 'answered':
      return 'answer-outcome'
    case 'partial':
      return 'answer-outcome outcome-partial'
    case 'insufficient_evidence':
      return 'answer-outcome outcome-insufficient'
  }
}

function jobStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

function citationTitle(
  citation: AnswerCitation,
  nodeById: Map<string, SourceNode>,
  candidateById: Map<string, AdditionalCandidate>,
): string {
  const node = nodeById.get(citation.node_id)
  if (node) {
    return displayNodeTitle(node).text
  }
  const candidate = candidateById.get(citation.node_id)
  if (candidate) {
    return candidate.title?.trim() || candidate.url
  }
  return citation.node_id
}

function sourceMeta(
  citation: AnswerCitation,
  nodeById: Map<string, SourceNode>,
  candidateById: Map<string, AdditionalCandidate>,
): string | null {
  const node = nodeById.get(citation.node_id)
  if (node) {
    const publication = formatPublication(node.publication)
    return `${sourceName(node)} · ${publication.compactText}`
  }
  const candidate = candidateById.get(citation.node_id)
  if (candidate) {
    const publication = formatPublication(candidate.publication)
    const name = candidate.source.name?.trim() || candidate.source.domain
    return `${name} · ${publication.compactText}`
  }
  return null
}

function PinnedPair({
  pins,
  nodeById,
  pinned,
}: {
  pins: Array<{ node_id: string; snapshot_id: string | null }>
  nodeById: Map<string, SourceNode>
  pinned: boolean
}) {
  return (
    <div className="answer-pair">
      <p className="field-label">
        {pinned ? 'Pinned pair' : 'Requested pair'}
      </p>
      {pins.map((pin, index) => {
        const node = nodeById.get(pin.node_id)
        const title = node ? displayNodeTitle(node) : null
        const publication = node ? formatPublication(node.publication) : null
        const letter = index === 0 ? 'A' : 'B'

        return (
          <p key={`${letter}-${pin.node_id}`}>
            <span
              className={letter === 'B' ? 'slot-letter slot-b' : 'slot-letter'}
              aria-hidden="true"
            >
              {letter}
            </span>{' '}
            {title ? (
              <>
                {title.isUrlFallback ? (
                  <span className="fallback-label">URL</span>
                ) : null}
                {title.text}
              </>
            ) : (
              <>Node {pin.node_id}</>
            )}
            <span className="field-note">
              {' '}
              · {node ? sourceName(node) : 'Source metadata not loaded'}
              {publication ? ` · ${publication.compactText}` : ''}
              {pin.snapshot_id ? ` · Snapshot ${pin.snapshot_id}` : ''}
            </span>
          </p>
        )
      })}
    </div>
  )
}

function StatementText({
  statement,
  citationNumbers,
  answer,
  onOpenCitation,
  nodeById,
  candidateById,
  selectedNodeIds,
}: {
  statement: AnswerStatement
  citationNumbers: Map<string, number>
  answer: AnswerResult
  onOpenCitation(citationId: string): void
  nodeById: Map<string, SourceNode>
  candidateById: Map<string, AdditionalCandidate>
  selectedNodeIds: Set<string>
}) {
  return (
    <li>
      {statement.text}
      {statement.citation_ids.map((citationId, index) => {
        const number = citationNumbers.get(citationId)
        const citation = answer.citations.find(
          (item) => item.id === citationId,
        )
        if (number === undefined || !citation) {
          return null
        }
        const additional = !selectedNodeIds.has(citation.node_id)
        const title = citationTitle(citation, nodeById, candidateById)
        return (
          <button
            type="button"
            key={`${citationId}-${index}`}
            className="citation-marker"
            onClick={() => onOpenCitation(citationId)}
            aria-label={`Open citation ${number}: ${title}${
              additional ? ' (additional source)' : ' (selected source)'
            }`}
          >
            {number}
          </button>
        )
      })}
    </li>
  )
}

function JobActivity({ job }: { job: JobView }) {
  const status = jobStatusLabel(job.status)

  return (
    <section className="answer-activity" aria-label="Question job activity">
      <div className="badge-row">
        <h3>Job activity</h3>
        <span className="badge badge-neutral">{status}</span>
        {job.stage ? (
          <span className="field-note">Stage: {job.stage}</span>
        ) : null}
      </div>
      {job.error ? (
        <div className="state-card state-error" role="alert">
          <p>{job.error}</p>
        </div>
      ) : null}
      {job.status === 'queued' || job.status === 'running' ? (
        <p className="field-note" role="status">
          Waiting for verified activity events from the gateway. No progress is
          simulated.
        </p>
      ) : null}
      {job.events.length === 0 ? (
        <p className="empty-list-note">
          No verified activity events were reported for this job.
        </p>
      ) : (
        <ol className="job-events">
          {job.events.map((event) => (
            <li key={`${event.seq}-${event.at}`}>
              <span className="field-note">#{event.seq}</span>{' '}
              <strong>{event.stage}</strong>{' '}
              <span>{event.message}</span>{' '}
              <span className="field-note">
                {formatRetrievedAt(event.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function AnswerPanel({
  record,
  nodeById,
  candidateById,
  onOpenCitation,
  onToggleCandidate,
  selectedCandidateIds,
  onAddDiscoveries,
  adding,
  addError,
  currentGraphRevision,
  validationError,
}: AnswerPanelProps) {
  const headingBaseId = useId()
  const answer = record.answer
  const validationErrors = validationError ?? []
  const hasValidationError = validationErrors.length > 0
  const usableAnswer = answer !== null && !hasValidationError ? answer : null

  const pins = usableAnswer
    ? usableAnswer.selected_nodes
    : record.nodeIds.map((nodeId) => ({
        node_id: nodeId,
        snapshot_id: null,
      }))
  const displayedRevision = usableAnswer
    ? usableAnswer.graph_revision
    : record.graphRevision
  const selectedNodeIds = new Set(
    (usableAnswer?.selected_nodes ?? []).map((pin) => pin.node_id),
  )
  const citationNumbers = new Map(
    (usableAnswer?.citations ?? []).map(
      (citation, index) => [citation.id, index + 1] as const,
    ),
  )

  let resolvedAdditionalCandidates: AdditionalCandidate[] = []
  let missingCandidateIds: string[] = []
  if (usableAnswer) {
    const candidatePool = new Map<string, AdditionalCandidate>(candidateById)
    for (const candidate of usableAnswer.additional_candidates ?? []) {
      candidatePool.set(candidate.candidate_id, candidate)
    }
    const candidateIds = [
      ...new Set(
        usableAnswer.additional_candidate_ids.length > 0
          ? usableAnswer.additional_candidate_ids
          : (usableAnswer.additional_candidates ?? []).map(
              (candidate) => candidate.candidate_id,
            ),
      ),
    ]
    resolvedAdditionalCandidates = candidateIds
      .map((candidateId) => candidatePool.get(candidateId))
      .filter(
        (candidate): candidate is AdditionalCandidate =>
          candidate !== undefined,
      )
    missingCandidateIds = candidateIds.filter(
      (candidateId) => !candidatePool.has(candidateId),
    )
  }

  return (
    <section className="answer-panel" aria-label="Answer">
      <div className="answer-header">
        <h2>Answer</h2>
        <span className="badge badge-soft">
          Graph revision {displayedRevision}
        </span>
      </div>

      <div>
        <p className="field-label">Question</p>
        <p className="answer-question">
          {record.question.trim().length > 0
            ? `“${record.question}”`
            : 'No question text was supplied.'}
        </p>
      </div>

      <PinnedPair
        pins={pins}
        nodeById={nodeById}
        pinned={usableAnswer !== null}
      />

      {hasValidationError ? (
        <div className="state-card state-error answer-validation" role="alert">
          <p>
            The answer payload failed validation, so no statements, citations,
            or additional discoveries from it were rendered.
          </p>
          <details>
            <summary>Validation details</summary>
            <ul>
              {validationErrors.map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      {!hasValidationError && usableAnswer ? (
        <>
          <div className="badge-row">
            <span className={outcomeBadgeClass(usableAnswer.outcome)}>
              {outcomeLabel(usableAnswer.outcome)}
            </span>
            <span className="field-note">
              Completed {formatRetrievedAt(usableAnswer.completed_at)}
            </span>
            {usableAnswer.model_identity ? (
              <span className="field-note">
                Model: {usableAnswer.model_identity}
              </span>
            ) : null}
          </div>

          {usableAnswer.graph_revision !== currentGraphRevision ? (
            <div className="answer-stale" role="status">
              <strong>Stale revision.</strong> This answer is pinned to graph
              revision {usableAnswer.graph_revision}; the workspace is now at
              revision {currentGraphRevision}. Later graph changes are not
              reflected in this answer.
            </div>
          ) : null}

          {usableAnswer.outcome === 'insufficient_evidence' ? (
            <div className="field-note" role="status">
              <strong>Insufficient evidence.</strong> The gateway reported that
              the selected sources did not provide enough validated evidence to
              answer this question.
              {usableAnswer.limitations.length > 0
                ? ' The supplied limitations are listed below.'
                : ''}
            </div>
          ) : null}

          <section
            className="workspace-section"
            aria-labelledby={`${headingBaseId}-statements`}
          >
            <h3 id={`${headingBaseId}-statements`} className="detail-section-heading">
              Statements
            </h3>
            {usableAnswer.outcome === 'insufficient_evidence' ? (
              usableAnswer.statements.length > 0 ? (
                <p className="field-error" role="alert">
                  The payload included statements for an insufficient-evidence
                  outcome. They were not rendered.
                </p>
              ) : (
                <p className="empty-list-note">
                  No answer statements were supplied for this outcome.
                </p>
              )
            ) : usableAnswer.statements.length === 0 ? (
              <p className="empty-list-note">
                No answer statements were supplied.
              </p>
            ) : (
              <ol className="answer-statements">
                {usableAnswer.statements.map((statement, index) => (
                  <StatementText
                    key={`${index}-${statement.text}`}
                    statement={statement}
                    citationNumbers={citationNumbers}
                    answer={usableAnswer}
                    onOpenCitation={onOpenCitation}
                    nodeById={nodeById}
                    candidateById={candidateById}
                    selectedNodeIds={selectedNodeIds}
                  />
                ))}
              </ol>
            )}
          </section>

          <section
            className="workspace-section"
            aria-labelledby={`${headingBaseId}-citations`}
          >
            <h3 id={`${headingBaseId}-citations`} className="detail-section-heading">
              Citations
            </h3>
            {usableAnswer.citations.length === 0 ? (
              <p className="empty-list-note">
                No citations were supplied.
              </p>
            ) : (
              <ul className="citation-list">
                {usableAnswer.citations.map((citation, index) => {
                  const additional = !selectedNodeIds.has(citation.node_id)
                  const title = citationTitle(
                    citation,
                    nodeById,
                    candidateById,
                  )
                  const meta = sourceMeta(
                    citation,
                    nodeById,
                    candidateById,
                  )
                  return (
                    <li className="citation-item" key={citation.id}>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => onOpenCitation(citation.id)}
                        aria-label={`Open citation ${index + 1}: ${title}${
                          additional
                            ? ' (additional source)'
                            : ' (selected source)'
                        }`}
                      >
                        <span className="citation-marker">
                          {index + 1}
                        </span>
                        {title}
                      </button>
                      <div className="badge-row">
                        <span
                          className={
                            additional
                              ? 'badge badge-cross-link'
                              : 'badge badge-neutral'
                          }
                        >
                          {additional ? 'Additional source' : 'Selected source'}
                        </span>
                        <span className="field-note">
                          Snapshot {citation.snapshot_id}
                        </span>
                      </div>
                      {meta ? <p className="citation-meta">{meta}</p> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section
            className="workspace-section answer-limitations"
            aria-labelledby={`${headingBaseId}-limitations`}
          >
            <h3 id={`${headingBaseId}-limitations`} className="detail-section-heading">
              Limitations
            </h3>
            {usableAnswer.limitations.length === 0 ? (
              <p className="empty-list-note">
                No limitations were supplied by the gateway.
              </p>
            ) : (
              <ul className="limitation-note">
                {usableAnswer.limitations.map((limitation, index) => (
                  <li key={`${index}-${limitation}`}>{limitation}</li>
                ))}
              </ul>
            )}
          </section>

          {missingCandidateIds.length > 0 ? (
            <p className="answer-validation" role="alert">
              {missingCandidateIds.length} additional candidate record
              {missingCandidateIds.length === 1 ? ' was' : 's were'} referenced
              but not supplied. Missing IDs: {missingCandidateIds.join(', ')}.
              No details were invented.
            </p>
          ) : null}

          <AdditionalDiscoveries
            candidates={resolvedAdditionalCandidates}
            selectedIds={selectedCandidateIds}
            graphRevision={usableAnswer.graph_revision}
            currentGraphRevision={currentGraphRevision}
            adding={adding}
            error={addError}
            onToggle={onToggleCandidate}
            onAdd={onAddDiscoveries}
          />
        </>
      ) : null}

      {!hasValidationError && !usableAnswer && record.error ? (
        <ErrorNotice error={record.error} />
      ) : null}

      {!hasValidationError && !usableAnswer && !record.error && record.job ? (
        <p className="field-note" role="status">
          The question request is in progress. Only verified job events are
          shown; no answer text is simulated.
        </p>
      ) : null}

      {record.job ? <JobActivity job={record.job} /> : null}

      {!hasValidationError &&
      !usableAnswer &&
      !record.error &&
      !record.job ? (
        <div className="state-card state-empty">
          <p>
            No answer yet. Select exactly two distinct sources and submit a
            question to start a pinned request.
          </p>
        </div>
      ) : null}
    </section>
  )
}
