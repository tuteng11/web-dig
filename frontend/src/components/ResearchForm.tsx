import { useId, useRef, useState, type FormEvent } from 'react'
import type { AppMode, DemoTransport } from '../config'
import type { UiError } from '../domain/errors'

const QUESTION_LIMIT = 2000
const URL_LIMIT = 2048

function codePointLength(value: string): number {
  return Array.from(value).length
}

function validateQuestion(value: string): string | null {
  if (value.trim().length === 0) {
    return 'Enter the question you want to investigate.'
  }

  const length = codePointLength(value)
  if (length > QUESTION_LIMIT) {
    return `The question is ${length.toLocaleString()} characters long. Keep it to ${QUESTION_LIMIT.toLocaleString()} characters or fewer.`
  }

  return null
}

function validateSourceUrl(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Enter the HTTP(S) URL of the source you want to trace.'
  }

  if (codePointLength(value) > URL_LIMIT) {
    return `The source URL is longer than the ${URL_LIMIT.toLocaleString()}-character limit.`
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'Enter an absolute URL, including http:// or https://.'
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only absolute HTTP(S) source URLs are supported.'
  }

  if (parsed.hostname.length === 0) {
    return 'The source URL needs a host name.'
  }

  return null
}

interface ResearchFormProps {
  mode: AppMode
  demoTransport: DemoTransport
  busy: boolean
  error: UiError | null
  notice?: string | null
  onSubmit(input: { question: string; sourceUrl: string }): void
  onLoadDemo(): void
  initialQuestion?: string
}

export function ResearchForm({
  mode,
  demoTransport,
  busy,
  error,
  notice = null,
  onSubmit,
  onLoadDemo,
  initialQuestion,
}: ResearchFormProps) {
  const [question, setQuestion] = useState(initialQuestion ?? '')
  const [sourceUrl, setSourceUrl] = useState('')
  const [questionTouched, setQuestionTouched] = useState(false)
  const [urlTouched, setUrlTouched] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const questionRef = useRef<HTMLTextAreaElement | null>(null)
  const urlRef = useRef<HTMLInputElement | null>(null)

  const questionId = useId()
  const urlId = useId()
  const questionHintId = useId()
  const questionErrorId = useId()
  const urlHintId = useId()
  const urlErrorId = useId()

  const questionCount = codePointLength(question)
  const questionError =
    questionTouched || submitAttempted ? validateQuestion(question) : null
  const urlError = urlTouched || submitAttempted ? validateSourceUrl(sourceUrl) : null
  const questionDescribedBy = questionError
    ? `${questionHintId} ${questionErrorId}`
    : questionHintId
  const urlDescribedBy = urlError ? `${urlHintId} ${urlErrorId}` : urlHintId

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) {
      return
    }

    setSubmitAttempted(true)
    const nextQuestionError = validateQuestion(question)
    const nextUrlError = validateSourceUrl(sourceUrl)

    if (nextQuestionError) {
      questionRef.current?.focus()
      return
    }
    if (nextUrlError) {
      urlRef.current?.focus()
      return
    }

    onSubmit({
      question: question.trim(),
      sourceUrl: sourceUrl.trim(),
    })
  }

  return (
    <form
      className="research-form"
      onSubmit={handleSubmit}
      noValidate
      aria-busy={busy}
      aria-label="Start a research trace"
    >
      <div className="tb-form-heading">
        <p className="tb-eyebrow">New research</p>
        <h2>Start with a question and a source</h2>
        <p className="tb-form-lede">
          Traceback follows the visible source trail back toward its earliest
          evidence. Results are limited to sources the research service can
          retrieve; a missing source is not proof that it does not exist.
        </p>
      </div>

      <div className="demo-callout">
        <div className="tb-demo-copy">
          <div className="node-badges">
            <span className="badge badge-provisional">
              {demoTransport === 'gateway'
                ? 'Synthetic demo · gateway'
                : 'Synthetic demo · bundled'}
            </span>
            <span className="badge badge-neutral">
              {mode === 'fixture' ? 'Fixture mode' : 'Live mode'}
            </span>
          </div>
          <p>
            {mode === 'fixture'
              ? demoTransport === 'gateway'
                ? 'This workspace is running against the synthetic Riverbend fixture served read-only by the configured backend gateway through MCP. Demo graph and node details require the gateway; expansion, questions, and additional-discovery jobs are not implemented in this milestone.'
                : 'This workspace is running against a fully offline bundled synthetic scenario, not live research. The demo below loads the Riverbend battery-storage fixture directly from the local bundle; no backend request is made and the full demo interaction is simulated in the browser.'
              : demoTransport === 'gateway'
                ? 'Live-discovery mode is selected, but the demo below is still an explicit synthetic scenario, served read-only by the configured gateway through MCP. It never substitutes for live results, and demo jobs are not implemented in this milestone.'
                : 'Live-discovery mode is selected, but the demo below is still an explicit, fully offline synthetic scenario from the bundled adapter. It never substitutes for live results.'}
          </p>
          <p className="field-note">
            The demo is independent of the question and URL above.{' '}
            {demoTransport === 'gateway'
              ? 'It reads only the backend fixture graph and node details; it does not fetch the submitted page or run live discovery.'
              : 'It makes no backend request, does not fetch the submitted page, and does not run live discovery.'}
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={onLoadDemo}
          disabled={busy}
        >
          Load synthetic Riverbend demo
        </button>
      </div>

      {mode === 'live' ? (
        <p className="field-note">
          Live mode sends the question and source URL to the configured gateway.
          Gateway or provider failures are reported as errors; synthetic data is
          never substituted silently.
        </p>
      ) : null}

      {notice ? (
        <p className="field-note" role="status">
          {notice}
        </p>
      ) : null}

      {error ? (
        <div className="field-error" role="alert">
          <strong>The research request could not be started.</strong>
          <p>{error.message}</p>
          <p className="error-meta">
            <span>{error.code}</span>
            {error.retryable ? ' · retryable' : ' · not reported as retryable'}
            {error.requestId ? ` · request ${error.requestId}` : ''}
          </p>
          {error.details.length > 0 ? (
            <details className="tb-error-details">
              <summary>Error details</summary>
              <ul>
                {error.details.map((detail, index) => (
                  <li key={`${index}-${detail}`}>{detail}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="form-grid">
        <div className="tb-form-field" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label" htmlFor={questionId}>
            Research question
          </label>
          <textarea
            ref={questionRef}
            id={questionId}
            name="question"
            className="textarea"
            rows={4}
            value={question}
            required
            aria-required="true"
            aria-invalid={questionError !== null}
            aria-describedby={questionDescribedBy}
            placeholder="What do you want to trace, and what would count as evidence?"
            autoComplete="off"
            onBlur={() => setQuestionTouched(true)}
            onChange={(event) => setQuestion(event.currentTarget.value)}
          />
          <p id={questionHintId} className="field-note">
            {questionCount.toLocaleString()} /{' '}
            {QUESTION_LIMIT.toLocaleString()} characters (Unicode code points).
            Your question stays in this tab and is not written to the browser
            address bar.
          </p>
          {questionError ? (
            <p id={questionErrorId} className="field-error">
              {questionError}
            </p>
          ) : null}
        </div>

        <div className="tb-form-field" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label" htmlFor={urlId}>
            Source URL
          </label>
          <input
            ref={urlRef}
            id={urlId}
            name="sourceUrl"
            type="url"
            className="text-input"
            value={sourceUrl}
            required
            aria-required="true"
            aria-invalid={urlError !== null}
            aria-describedby={urlDescribedBy}
            placeholder="https://example.com/the-article"
            autoComplete="url"
            spellCheck={false}
            onBlur={() => setUrlTouched(true)}
            onChange={(event) => setSourceUrl(event.currentTarget.value)}
          />
          <p id={urlHintId} className="field-note">
            An absolute HTTP(S) URL, up to {URL_LIMIT.toLocaleString()}{' '}
            characters. The submitted URL is not written to the browser address
            bar.
          </p>
          {urlError ? (
            <p id={urlErrorId} className="field-error">
              {urlError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="tb-form-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Starting research…' : 'Start research'}
        </button>
        <p className="field-note">
          Research is scoped to this run and the sources the service can reach.
          The tree does not claim that an unreachable source does not exist.
        </p>
      </div>
    </form>
  )
}
