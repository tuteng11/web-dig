import { useMemo } from 'react'
import type {
  GraphResult,
  OriginStatus,
} from '../contracts/newsTrace'
import type { JobEvent, JobKind, JobStatus } from '../contracts/http'
import { displayNodeTitle } from '../domain/nodes'
import { jobIsActive, type JobView } from './jobView'

interface JobProgressProps {
  phase: 'loading' | 'ready' | 'error'
  graph: GraphResult | null
  job: JobView | null
  onCancel?: () => void
  originNotice?: string | null
}

const KIND_LABEL: Record<JobKind, string> = {
  discovery: 'Discovery',
  expansion: 'Expansion',
  question: 'Question',
  add_discoveries: 'Add discoveries',
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const STATUS_CLASS: Record<JobStatus, string> = {
  queued: 'badge badge-soft',
  running: 'badge badge-provisional',
  completed: 'badge badge-validated',
  failed: 'badge badge-uncertain',
  cancelled: 'badge badge-neutral',
}

const ORIGIN_STATUS_LABEL: Record<OriginStatus, string> = {
  resolved_within_results: 'resolved within these results',
  provisional: 'provisional within these results',
  unresolved: 'unresolved',
}

function formatDateTime(value: string): string | null {
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) {
    return null
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(instant))
}

/**
 * Polling responses may repeat events or deliver them with equal sequence
 * numbers. The UI shows every distinct backend event once, in sequence order,
 * and never synthesizes local progress.
 */
function orderedSafeEvents(events: JobEvent[]): JobEvent[] {
  const seen = new Set<number>()
  const safe: JobEvent[] = []

  for (const event of events) {
    if (!Number.isInteger(event.seq) || event.seq < 0) {
      continue
    }
    if (typeof event.message !== 'string' || event.message.trim().length === 0) {
      continue
    }
    if (seen.has(event.seq)) {
      continue
    }
    seen.add(event.seq)
    safe.push(event)
  }

  safe.sort((a, b) => a.seq - b.seq)
  return safe
}

function statusDescription(job: JobView): string {
  const stage =
    typeof job.stage === 'string' && job.stage.trim().length > 0
      ? job.stage.trim()
      : null

  switch (job.status) {
    case 'queued':
      return 'Queued. The backend has not reported that work has started.'
    case 'running':
      return stage
        ? `Running. Last reported stage: ${stage}.`
        : 'Running. The backend has not reported a stage name.'
    case 'completed':
      return 'Completed. The backend reported a terminal success status.'
    case 'failed':
      return 'Failed. The backend reported a terminal failure.'
    case 'cancelled':
      return 'Cancelled. No further job events are expected.'
  }
}

function plural(count: number, singular: string, pluralWord: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralWord}`
}

export function JobProgress({
  phase,
  graph,
  job,
  onCancel,
  originNotice = null,
}: JobProgressProps) {
  const events = useMemo(
    () => orderedSafeEvents(job?.events ?? []),
    [job?.events],
  )

  const active = jobIsActive(job)
  const warnings = graph?.warnings ?? []
  const omittedCount =
    typeof graph?.omitted_count === 'number' &&
    Number.isFinite(graph.omitted_count)
      ? graph.omitted_count
      : null
  const truncated = graph?.truncated === true
  const hasTruncation = truncated || (omittedCount !== null && omittedCount > 0)
  const origin = graph?.origin_assessment ?? null
  const unplacedIds = new Set(graph?.undated_node_ids ?? [])
  const originCandidates = (origin?.earliest_candidate_ids ?? []).map((id) => {
    const node = graph?.nodes.find((candidate) => candidate.id === id)
    return {
      id,
      label: node
        ? displayNodeTitle(node).text
        : `${id} (node not present in the loaded graph)`,
    }
  })
  const originSearchTime = origin ? formatDateTime(origin.searched_at) : null
  const graphLimits = graph?.limits
  const limitParts: string[] = []
  if (typeof graphLimits?.max_nodes === 'number') {
    limitParts.push(`${graphLimits.max_nodes.toLocaleString()} nodes`)
  }
  if (typeof graphLimits?.max_relationships === 'number') {
    limitParts.push(`${graphLimits.max_relationships.toLocaleString()} relationships`)
  }

  return (
    <section
      className="job-progress"
      aria-label={
        job ? `${KIND_LABEL[job.kind]} job progress` : 'Research graph status'
      }
    >
      {originNotice ? (
        <p className="origin-notice" role="status">
          {originNotice}
        </p>
      ) : null}

      {phase === 'loading' && !graph ? (
        <p className="loading-placeholder" role="status" aria-live="polite">
          Loading the research graph through the gateway. No progress percentage
          is estimated.
        </p>
      ) : null}

      {!graph && phase !== 'loading' ? (
        <div className="state-card state-error" role="alert">
          <h3 className="tb-job-heading">Graph unavailable</h3>
          <p>
            The research graph could not be loaded. No synthetic or fallback
            data is displayed in its place.
          </p>
        </div>
      ) : null}

      {graph && phase === 'error' ? (
        <p className="field-error" role="alert">
          The latest graph refresh failed. The displayed graph is revision{' '}
          {graph.graph_revision} from the last successful load.
        </p>
      ) : null}

      {job ? (
        <div className="tb-job-section workspace-section">
          <div className="tb-job-header">
            <div className="node-badges">
              <span className={STATUS_CLASS[job.status]}>
                {STATUS_LABEL[job.status]}
              </span>
              <span className="badge badge-soft">{KIND_LABEL[job.kind]}</span>
            </div>
            {active && onCancel ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={onCancel}
              >
                Cancel job
              </button>
            ) : null}
          </div>

          <p className="tb-job-status" role="status" aria-live="polite">
            {statusDescription(job)}
          </p>
          <p className="field-note">
            Stage:{' '}
            {typeof job.stage === 'string' && job.stage.trim().length > 0
              ? job.stage.trim()
              : 'not reported'}{' '}
            · Job ID: <span className="tb-mono">{job.id}</span>
          </p>

          {job.error ? (
            <p className="field-error" role="alert">
              {job.error}
            </p>
          ) : null}

          <h3 className="tb-job-heading">Job activity</h3>
          {events.length > 0 ? (
            <ol className="job-events">
              {events.map((event) => {
                const eventTime = formatDateTime(event.at)
                return (
                  <li key={`${event.seq}-${event.stage}-${event.message}`}>
                    <span className="tb-event-stage">
                      {typeof event.stage === 'string' &&
                      event.stage.trim().length > 0
                        ? event.stage.trim()
                        : 'Unlabelled stage'}
                    </span>
                    <span className="tb-event-message">{event.message}</span>
                    <span className="tb-event-time">
                      {eventTime ? (
                        <time dateTime={event.at}>{eventTime}</time>
                      ) : (
                        'Time unavailable'
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="empty-list-note">
              {job.status === 'queued' || job.status === 'running'
                ? 'No activity events have been reported yet.'
                : 'The backend returned no activity events for this job.'}
            </p>
          )}
          <p className="field-note">
            Only activity events returned by the backend are listed. No local
            progress estimate is added.
          </p>
        </div>
      ) : null}

      {graph ? (
        <div className="tb-job-section workspace-section">
          <h3 className="tb-job-heading">Graph status</h3>
          <p className="field-note">
            Revision {graph.graph_revision} ·{' '}
            {plural(graph.nodes.length, 'loaded source', 'loaded sources')} ·{' '}
            {plural(graph.relationships.length, 'relationship', 'relationships')}
          </p>

          {hasTruncation ? (
            <p className="tb-job-warning" role="note">
              {truncated
                ? 'The backend marked this graph as truncated.'
                : 'The backend reported omitted sources.'}{' '}
              {omittedCount !== null
                ? `${plural(omittedCount, 'source was', 'sources were')} omitted from the response.`
                : 'The omitted source count was not reported.'}
            </p>
          ) : null}

          {limitParts.length > 0 ? (
            <p className="field-note">
              Backend response guardrails: {limitParts.join(' · ')}.
            </p>
          ) : null}

          {warnings.length > 0 ? (
            <details className="tb-graph-warnings">
              <summary>Graph warnings ({warnings.length})</summary>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {origin ? (
            <details className="tb-origin-assessment">
              <summary>
                Origin assessment: {ORIGIN_STATUS_LABEL[origin.status]}
              </summary>
              <p>{origin.rationale}</p>
              {originCandidates.length > 0 ? (
                <p className="field-note">
                  Earliest candidate
                  {originCandidates.length === 1 ? '' : 's'}:{' '}
                  {originCandidates
                    .map((candidate) => candidate.label)
                    .join(' · ')}
                </p>
              ) : null}
              {originSearchTime ? (
                <p className="field-note">Assessed: {originSearchTime}</p>
              ) : null}
              {(origin.coverage_notes?.length ?? 0) > 0 ? (
                <ul>
                  {origin.coverage_notes?.map((note, index) => (
                    <li key={`${index}-${note}`}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="field-note">
                  No additional coverage notes were supplied.
                </p>
              )}
              {graph.root_node_id && unplacedIds.has(graph.root_node_id) ? (
                <p className="field-note">
                  The origin candidate is time-uncertain. It remains in the
                  time-uncertain lane and is not assigned an invented date.
                </p>
              ) : null}
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
