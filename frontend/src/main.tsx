import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, ChevronRight,
  CircleAlert, Clock3, Database, FileText, FlaskConical, GitCompare, GitFork, Globe2,
  Layers3, Link2, LoaderCircle, Radar, Search, ShieldCheck, X,
} from 'lucide-react'
import { formatDate, getHealth, getSource, submitTrace, type Health, type Source, type Trace } from './api'
import SourceGraph from './graph'
import './styles.css'

const examples = [
  'Did NASA spend millions on a space pen?',
  'Do we only use 10% of our brains?',
]

const stages = [
  'Searching for reporting and primary evidence',
  'Extracting and ranking relevant passages',
  'Comparing wording and checking references',
]

function tone(stance: Source['stance']) {
  return ({ Supports: 'green', 'Adds context': 'blue', Contradicts: 'rose', 'Repeats claim': 'amber', Unclear: 'neutral' })[stance]
}

function SourceIcon({ source, size = 18 }: { source: Source; size?: number }) {
  const Icon = source.kind === 'Primary evidence' ? BookOpen : source.kind === 'Fact check' ? ShieldCheck : FileText
  return <Icon size={size} />
}

function App() {
  const [input, setInput] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [pending, setPending] = useState<Trace['mode'] | null>(null)
  const [stage, setStage] = useState(0)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<Source | null>(null)
  const [inspectorWarning, setInspectorWarning] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const activeSelection = useRef(0)
  const queryRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const inspectorRef = useRef<HTMLDialogElement>(null)
  const scrollOnLoad = useRef(false)

  async function run(claim: string, mode: Trace['mode'], scroll = false) {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setError('')
    setPending(mode)
    setStage(0)
    try {
      const result = await submitTrace(claim, mode, controller.signal)
      if (controller.signal.aborted) return
      scrollOnLoad.current = scroll
      setTrace(result)
      setSelection(null)
      activeSelection.current++
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'The trace failed. Try again.')
    } finally {
      if (!controller.signal.aborted) setPending(null)
    }
  }

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {})
    void run('', 'demo')
    return () => activeRequest.current?.abort()
  }, [])

  useEffect(() => {
    if (pending !== 'live') return
    const timer = window.setInterval(() => setStage(value => Math.min(value + 1, stages.length - 1)), 6500)
    return () => window.clearInterval(timer)
  }, [pending])

  useEffect(() => {
    if (trace && scrollOnLoad.current) {
      scrollOnLoad.current = false
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [trace])

  useEffect(() => {
    const dialog = inspectorRef.current
    if (selection && dialog && !dialog.open) dialog.showModal()
    if (!selection && dialog?.open) dialog.close()
  }, [selection])

  async function inspect(source: Source) {
    const requestId = ++activeSelection.current
    setSelection(source)
    setInspectorWarning('')
    try {
      const detail = await getSource(source.id, trace?.trace_id)
      if (requestId === activeSelection.current) setSelection(detail)
    } catch {
      if (requestId === activeSelection.current) setInspectorWarning('Showing the source details returned with this trace.')
    }
  }

  function closeInspector() {
    activeSelection.current++
    setSelection(null)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (input.trim()) void run(input.trim(), 'live', true)
  }

  const sources = trace?.sources || []
  const earliest = sources.find(source => source.id === trace?.earliest_id)
  const original = sources.find(source => source.id === trace?.original_id)
  const sameEarliestDate = earliest && sources.filter(source => source.published === earliest.published).length > 1
  const verdictTone = trace?.verdict === 'Supported' ? 'green' : trace?.verdict === 'Contradicted' ? 'rose'
    : trace?.verdict === 'Insufficient Evidence' ? 'neutral' : 'amber'

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a href="#top" className="brand" aria-label="Traceback home"><span className="brand-icon"><Radar size={22} /></span>Traceback<span className="brand-period">.</span></a>
          <nav aria-label="Main navigation">
            <a href="#top" onClick={() => queryRef.current?.focus()}><Search size={14} /> Investigate</a>
            <a href="#investigation"><Layers3 size={14} /> Evidence</a>
          </nav>
          <span className={`service ${health?.live_configured ? 'connected' : ''}`} title={health?.live_configured ? 'Live credentials configured' : 'A verified demo is available'}>
            <span /> {health?.live_configured ? 'Live configured' : health ? 'Demo available' : 'API status unknown'}
          </span>
        </div>
      </header>

      <main className="shell" id="top">
        <section className="hero">
          <div className="hero-art" aria-hidden="true"><div/><div/><div/><div/><span/><b/><i/></div>
          <div className="hero-content">
            <h1>Every claim has a<br className="hero-break" /> history. <em>Trace it.</em></h1>
            <p>Follow a headline, rumor, or article back to the evidence behind it.</p>
            <form className="search-form" onSubmit={submit}>
              <Search size={20} aria-hidden="true" />
              <input ref={queryRef} value={input} onChange={event => setInput(event.target.value)} placeholder="Enter a claim, headline, or article URL" aria-label="Claim, headline, or article URL" maxLength={1000} required />
              <button type="submit" className="primary" disabled={pending === 'live'}>
                {pending === 'live' ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={17} />} <span>Trace claim</span>
              </button>
            </form>
            <div className="examples">
              <button className="example cached" onClick={() => void run('', 'demo', true)}><FlaskConical size={13} /> Climate deadline demo <ArrowDownRight size={13} /></button>
              {examples.map(example => <button className="example" key={example} onClick={() => { setInput(example); queryRef.current?.focus() }}>{example}</button>)}
            </div>
            <div className="status-message" aria-live="polite">
              {pending === 'live' && <span className="loading"><LoaderCircle size={15} className="spin" /> {stages[stage]} <small>· Estimated progress</small></span>}
              {pending === 'demo' && !trace && <span className="loading"><LoaderCircle size={15} className="spin" /> Loading the verified case</span>}
              {error && <span className="error" role="alert"><CircleAlert size={16} /> {error}</span>}
            </div>
          </div>
        </section>

        {trace && (
          <section className="investigation" id="investigation" ref={resultsRef}>
            <div className="section-bar">
              <div className="section-label"><Activity size={17} /> Investigation</div>
              <div className="section-meta"><span className="mode"><span />{trace.mode === 'demo' ? 'Cached demo' : 'Live trace'}</span><span className="meta-divider" /><span>{sources.length} {sources.length === 1 ? 'source' : 'sources'}</span></div>
            </div>
            <div className="assessment card">
              <div className="assessment-body">
                <div className="label">Claim under review</div>
                <h2>“{trace.claim}”</h2>
                {trace.input_url && <a href={trace.input_url} target="_blank" rel="noreferrer" className="subtle-link"><Link2 size={14} /> Submitted article <ArrowUpRight size={13} /></a>}
                <div className="assessment-copy">
                  <div className="label">Evidence assessment</div>
                  <p>{trace.summary}</p>
                  {trace.citations.length > 0 && <div className="citations" aria-label="Assessment citations">
                    {trace.citations.map((id, index) => {
                      const source = sources.find(entry => entry.id === id)
                      return source && <a key={id} href={source.url} target="_blank" rel="noreferrer"><span>{index + 1}</span>{source.publisher}<ArrowUpRight size={12} /></a>
                    })}
                  </div>}
                </div>
              </div>
              <aside className="assessment-aside">
                <div><div className="label">Assessment</div><div className={`verdict ${verdictTone}`}><CircleAlert size={15} /> {trace.verdict}</div></div>
                <div><div className="label">Earliest dated source found</div>
                  {earliest ? <button className="aside-source" onClick={() => void inspect(earliest)}>{earliest.publisher} <ChevronRight size={14} /></button> : <strong>Date unavailable</strong>}
                  {earliest && <small>{formatDate(earliest.published)}{sameEarliestDate ? ' · shared date' : ''}</small>}
                </div>
                <div><div className="label">Original evidence</div>
                  {original ? <button className="aside-source" onClick={() => void inspect(original)}>{original.publisher} <ChevronRight size={14} /></button> : <strong>Unidentified</strong>}
                  {original && <small>{original.kind}</small>}
                </div>
              </aside>
            </div>

            {sources.length > 0 && (
              <>
                <div className="visual-grid">
                  <section className="card timeline-panel" aria-labelledby="timeline-title">
                    <div className="panel-header"><div className="panel-icon"><Clock3 size={18} /></div><div><h3 id="timeline-title">Source timeline</h3><p>Publication dates across the trace</p></div></div>
                    <ol className="timeline">
                      {sources.map((source, index) => (
                        <li key={source.id}>
                          <button onClick={() => void inspect(source)}>
                            <span className={`timeline-dot ${source.id === trace.original_id ? 'origin-dot' : ''}`} />
                            <span className="timeline-date">{formatDate(source.published, true)}{source.published && <small>{source.published.slice(0, 4)}</small>}</span>
                            <span className="timeline-text"><strong>{source.publisher}</strong><small>{source.kind}</small></span>
                            <ChevronRight size={15} className="timeline-chevron" aria-hidden="true" />
                            <span className="sr-only">Source {index + 1}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section className="card graph-panel" aria-labelledby="graph-title">
                    <div className="panel-header"><div className="panel-icon"><GitFork size={18} /></div><div><h3 id="graph-title">Source relationships</h3><p>Verified references across sources</p></div></div>
                    <SourceGraph key={`${trace.mode}:${sources.map(source => source.id).join(',')}`} trace={trace} selected={selection?.id || null} onSelect={inspect} />
                  </section>
                </div>
                <section className="card comparison" aria-labelledby="comparison-title">
                  <div className="panel-header"><div className="panel-icon"><GitCompare size={18} /></div><div><h3 id="comparison-title">How the claim changed</h3><p>How each source framed the evidence</p></div></div>
                  <div className="comparison-rows">
                    {sources.map(source => (
                      <button onClick={() => void inspect(source)} key={source.id} className="compare-row">
                        <span className="compare-publisher"><SourceIcon source={source} size={15} /> {source.publisher}</span>
                        <span>{source.wording || source.title}</span>
                        <span className={`tag ${tone(source.stance)}`}>{source.stance}</span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="source-section" aria-labelledby="evidence-title">
                  <div className="panel-header"><div className="panel-icon"><Layers3 size={18} /></div><div><h3 id="evidence-title">Evidence library</h3><p>Open any source to inspect its passage and supporting context</p></div></div>
                  <div className="source-grid">
                    {sources.map(source => (
                      <article className="card source-card" key={source.id}>
                        <div className="source-top"><span className="source-type"><SourceIcon source={source} size={15} />{source.kind}</span><span className={`tag ${tone(source.stance)}`}>{source.stance}</span></div>
                        <h4><button onClick={() => void inspect(source)}>{source.title}</button></h4>
                        <div className="source-meta"><Globe2 size={13} />{source.domain}<span />{formatDate(source.published)}</div>
                        <blockquote>{source.excerpt_type === 'Verified quotation' ? `“${source.excerpt}”` : source.excerpt}</blockquote>
                        {source.interpretation && <p>{source.interpretation}</p>}
                        <div className="source-actions"><button onClick={() => void inspect(source)}>Inspect evidence <ArrowRight size={14} /></button><a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.title}`}><ArrowUpRight size={17} /></a></div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
            {trace.warnings.length > 0 && <ul className="warnings">{trace.warnings.map(warning => <li key={warning}><CircleAlert size={15} /> {warning}</li>)}</ul>}
            <div className="pipeline"><Database size={17} /><div><strong>{trace.retrieval}</strong><small>{trace.mode === 'demo' ? `Publisher links verified ${formatDate(trace.evidence_cutoff)}` : `${trace.stored_sources} Delta source rows · ${trace.stored_passages} Delta passage rows`}</small></div></div>
          </section>
        )}
      </main>
      <footer className="shell"><span>Traceback<span className="brand-period">.</span></span><a href="#top">Back to search <ArrowDown size={14} className="rotate-180" /></a></footer>

      <dialog className="inspector" aria-label="Evidence inspector" ref={inspectorRef} onClose={closeInspector} onClick={event => { if (event.target === event.currentTarget) closeInspector() }}>
        {selection && <div className="inspector-body">
          <div className="inspector-top"><span><FileText size={17} /> Evidence inspector</span><button aria-label="Close inspector" onClick={closeInspector}><X size={22} /></button></div>
          <div className="source-top"><span className="source-type"><SourceIcon source={selection} size={16} />{selection.kind}</span><span className={`tag ${tone(selection.stance)}`}>{selection.stance}</span></div>
          <h2>{selection.title}</h2>
          <div className="source-meta"><Globe2 size={14} /> {selection.domain} <span /> {formatDate(selection.published)}</div>
          {selection.date_basis && <small className="date-basis">{selection.date_basis}</small>}
          <a className="open-source" href={selection.url} target="_blank" rel="noreferrer">Open publisher page <ArrowUpRight size={15} /></a>
          <h3>{selection.excerpt_type}</h3>
          <blockquote>{selection.excerpt}</blockquote>
          <h3>What the source establishes</h3>
          <p>{selection.interpretation || 'An interpretation was unavailable for this passage.'}</p>
          {selection.wording && <><h3>How it frames the claim</h3><p>{selection.wording}</p></>}
          {trace?.relationships.some(edge => edge.source === selection.id || edge.target === selection.id) && <>
            <h3>Verified references</h3>
            <ul className="inspector-refs">{trace.relationships.filter(edge => edge.source === selection.id || edge.target === selection.id).map(edge => {
              const other = sources.find(source => source.id === (edge.source === selection.id ? edge.target : edge.source))
              return other && <li key={`${edge.source}-${edge.target}`}><button onClick={() => void inspect(other)}>{edge.source === selection.id ? 'References' : 'Referenced by'} {other.publisher} <ArrowRight size={13} /></button><small>{edge.proof}</small></li>
            })}</ul>
          </>}
          {inspectorWarning && <small className="date-basis" role="status">{inspectorWarning}</small>}
        </div>}
      </dialog>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
