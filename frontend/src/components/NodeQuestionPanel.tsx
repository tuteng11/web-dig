import { useId, useState, type FormEvent } from 'react'
import type { SourceNode } from '../contracts/newsTrace'
import type { UiError } from '../domain/errors'
import { formatPublication } from '../domain/format'
import { displayNodeTitle, sourceName } from '../domain/nodes'

export interface NodeQuestionPanelProps {
  a: SourceNode | null
  b: SourceNode | null
  graphRevision: number
  busy: boolean
  error: UiError | null
  onAsk(question: string): void
  retainedAnswerNotice?: string | null
}

const MAX_QUESTION_CODE_POINTS = 2000

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

function PairSummarySlot({
  letter,
  node,
}: {
  letter: 'A' | 'B'
  node: SourceNode | null
}) {
  const title = node ? displayNodeTitle(node) : null
  const publication = node ? formatPublication(node.publication) : null

  return (
    <p>
      <span
        className={letter === 'B' ? 'slot-letter slot-b' : 'slot-letter'}
        aria-hidden="true"
      >
        {letter}
      </span>{' '}
      {node && title && publication ? (
        <>
          <strong>
            {title.isUrlFallback ? 'URL: ' : ''}
            {title.text}
          </strong>
          <span className="field-note">
            {' '}
            · {sourceName(node)} · {publication.compactText}
          </span>
        </>
      ) : (
        <span className="field-note">Slot {letter} not selected</span>
      )}
    </p>
  )
}

export function NodeQuestionPanel({
  a,
  b,
  graphRevision,
  busy,
  error,
  onAsk,
  retainedAnswerNotice,
}: NodeQuestionPanelProps) {
  const inputId = useId()
  const helpId = useId()
  const [question, setQuestion] = useState('')
  const [touched, setTouched] = useState(false)

  const codePoints = Array.from(question).length
  const trimmed = question.trim()
  const pairComplete = a !== null && b !== null && a.id !== b.id
  const overLimit = codePoints > MAX_QUESTION_CODE_POINTS
  const questionPresent = trimmed.length > 0
  const canAsk = pairComplete && questionPresent && !overLimit && !busy
  const showRequiredError = touched && !questionPresent && !overLimit

  const disabledReason = !pairComplete
    ? 'Select exactly two distinct sources to enable question submission.'
    : !questionPresent
      ? 'Enter a question to enable submission.'
      : overLimit
        ? `Shorten the question to ${MAX_QUESTION_CODE_POINTS} code points or fewer.`
        : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched(true)
    if (canAsk) {
      onAsk(trimmed)
    }
  }

  return (
    <section className="question-panel" aria-labelledby={`${inputId}-heading`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Ask</p>
          <h2 id={`${inputId}-heading`}>Ask about selected sources</h2>
        </div>
      </div>

      <div className="pair-summary">
        <p className="field-label">Current pair</p>
        <PairSummarySlot letter="A" node={a} />
        <PairSummarySlot letter="B" node={b} />
      </div>

      <p className="field-note">
        Submitting sends the two node IDs and the displayed graph revision (
        {graphRevision}). The gateway pins those source versions. Changing the
        selected pair later will not relabel an existing answer.
      </p>

      {retainedAnswerNotice ? (
        <p className="field-note" role="status">
          {retainedAnswerNotice}
        </p>
      ) : null}

      <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor={inputId}>
          Question
        </label>
        <textarea
          id={inputId}
          className="question-input"
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onBlur={() => setTouched(true)}
          disabled={busy}
          aria-invalid={overLimit || showRequiredError}
          aria-describedby={helpId}
          placeholder="What changed between these reports?"
        />
        <div className="question-actions">
          <p className="field-note" id={helpId}>
            1–2000 code points. Your draft stays in this page only and is not
            stored in the URL.
          </p>
          <p
            className={overLimit ? 'field-error' : 'field-note'}
            aria-live="polite"
          >
            {codePoints}/{MAX_QUESTION_CODE_POINTS}
          </p>
        </div>
        {showRequiredError ? (
          <p className="field-error" role="alert">
            Enter a question.
          </p>
        ) : null}
        {overLimit ? (
          <p className="field-error" role="alert">
            The question is {codePoints} code points long. Limit it to{' '}
            {MAX_QUESTION_CODE_POINTS}.
          </p>
        ) : null}

        <div className="question-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={!canAsk}
            aria-busy={busy}
            title={disabledReason ?? undefined}
          >
            {busy ? 'Submitting question…' : 'Ask question'}
          </button>
          {disabledReason ? (
            <p className="field-note" role="note">
              {disabledReason}
            </p>
          ) : null}
        </div>
        <p className="limitation-note">
          This control submits one pinned request through the gateway. It does
          not simulate typing, progress, or an answer.
        </p>
      </form>

      {error ? (
        <div className="question-error">
          <h3>Question request failed</h3>
          <ErrorNotice error={error} />
          <p className="field-note">
            The selected pair and draft question remain available for an
            explicit retry.
          </p>
        </div>
      ) : null}
    </section>
  )
}
