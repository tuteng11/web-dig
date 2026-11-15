import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowDown,
  CircleAlert,
  Database,
  FileSearch,
  GitFork,
  LoaderCircle,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import type {
  GraphResult,
  NodeDetails as NodeDetailsPayload,
  SourceNode,
} from './contracts/newsTrace'
import type {
  AdditionalCandidate,
  AnswerResult,
  GraphMutationResult,
  JobEnvelope,
  JobKind,
} from './contracts/http'
import { isTerminalJob } from './contracts/http'
import {
  createGatewayClient,
  newRequestId,
  type NewsTraceClient,
} from './api/gateway'
import { createFixtureClient } from './api/fixture'
import {
  parseDemoTransport,
  readRuntimeConfig,
  type DemoTransport,
} from './config'
import { buildChronologicalLayout } from './domain/layout'
import { jobResponseMismatch } from './domain/jobResponses'
import {
  createMutationIdTracker,
  createSubmissionGate,
  mutationSignature,
} from './domain/mutationGate'
import {
  EMPTY_FILTERS,
  filterGraphNodes,
  filterToQueryString,
  filtersFromQueryString,
  type NodeFilters,
} from './domain/filtering'
import { applyGraphCaps } from './domain/caps'
import { validateAnswerResult } from './domain/answers'
import {
  malformedGraphError,
  malformedNodeDetailsError,
  toUiError,
  type UiError,
} from './domain/errors'
import { validateGraphResult, validateNodeDetails } from './domain/validation'
import { displayNodeTitle } from './domain/nodes'
import { ResearchForm } from './components/ResearchForm'
import { ResearchHeader } from './components/ResearchHeader'
import { JobProgress } from './components/JobProgress'
import { SourceList } from './components/SourceList'
import { TreeExplorer } from './components/TreeExplorer'
import { NodeDetails, type DetailState } from './components/NodeDetails'
import { PairSelectionTray } from './components/PairSelectionTray'
import { NodeQuestionPanel } from './components/NodeQuestionPanel'
import { AnswerPanel } from './components/AnswerPanel'
import { CitationDrawer } from './components/CitationDrawer'
import type { JobView } from './components/jobView'
import { useJobPolling } from './hooks/useJobPolling'

type MobileTab = 'tree' | 'sources' | 'ask'
type SelectionSlot = 'a' | 'b'
type JobPurpose = 'start' | 'expand' | 'question' | 'add_discoveries'
type GraphPhase = 'idle' | 'loading' | 'ready' | 'error'

const GATEWAY_DEMO_NOTICE =
  'Graph and node details come from the backend fixture through MCP. Expansion, question, and additional-discovery jobs are not implemented in this milestone, so this demo is read-only.'

interface PairSelection {
  a: string | null
  b: string | null
}

interface SessionInfo {
  researchId: string
  question: string
  sourceUrl: string | null
  fixture: boolean
  transport: DemoTransport | null
}

interface ActiveJob {
  purpose: JobPurpose
  context: {
    researchId: string
    question?: string
    sourceUrl?: string | null
    nodeIds?: [string, string]
    graphRevision?: number
    previousRoot?: string | null
    previousRevision?: number
    answerId?: string
    candidateIds?: string[]
  }
  view: JobView
  raw: JobEnvelope
}

interface AnswerRecord {
  localId: string
  question: string
  nodeIds: [string, string]
  graphRevision: number
  answer: AnswerResult | null
  job: JobView | null
  error: UiError | null
  validationErrors: string[] | null
}

interface GraphRequest {
  researchId: string
  fixture: boolean
  transport: DemoTransport
  question: string
  sourceUrl: string | null
  resetWorkspace: boolean
  minRevision?: number
}

function transportForSession(
  session: SessionInfo | null,
  fallback: DemoTransport,
): DemoTransport {
  if (!session || !session.fixture) {
    return 'gateway'
  }
  return session.transport ?? fallback
}

function jobView(job: JobEnvelope): JobView {
  return {
    id: job.job_id,
    kind: job.kind,
    status: job.status,
    stage: job.stage ?? null,
    events: job.events,
    error: job.error?.message ?? null,
  }
}

function purposeForKind(kind: JobKind): JobPurpose {
  switch (kind) {
    case 'discovery':
      return 'start'
    case 'expansion':
      return 'expand'
    case 'question':
      return 'question'
    case 'add_discoveries':
      return 'add_discoveries'
  }
}

function jobError(job: JobEnvelope, fallback: string): UiError {
  if (job.error) {
    return {
      code: job.error.code,
      message: job.error.message,
      retryable: job.error.retryable,
      requestId: null,
      details: [],
    }
  }
  return {
    code: job.status === 'cancelled' ? 'JOB_CANCELLED' : 'JOB_FAILED',
    message: fallback,
    retryable: job.status !== 'cancelled',
    requestId: null,
    details: [],
  }
}

function malformedResponse(message: string): UiError {
  return {
    code: 'MALFORMED_RESPONSE',
    message,
    retryable: false,
    requestId: null,
    details: [],
  }
}

function buildOriginNotice(
  previousRoot: string | null | undefined,
  previousRevision: number | undefined,
  nextGraph: GraphResult,
  mutation: GraphMutationResult | null,
): string | null {
  const titleFor = (nodeId: string | null): string => {
    const node = nextGraph.nodes.find((entry) => entry.id === nodeId)
    return node ? displayNodeTitle(node).text : 'Not available'
  }

  if (previousRoot !== undefined && previousRoot !== nextGraph.root_node_id) {
    return `Origin changed to revision ${nextGraph.graph_revision}: the earliest evidence is now “${titleFor(nextGraph.root_node_id)}”. The previous root was “${titleFor(previousRoot)}”. Node identities and selections are preserved; existing answers stay pinned to revision ${previousRevision ?? 'unknown'}.`
  }

  const added = mutation?.added_node_ids.length ?? 0
  if (added > 0) {
    return `Graph updated to revision ${nextGraph.graph_revision}: ${added} source${added === 1 ? '' : 's'} added. Existing selections and answers were preserved.`
  }

  if (previousRevision !== undefined && previousRevision !== nextGraph.graph_revision) {
    return `Graph updated to revision ${nextGraph.graph_revision}. Existing selections and answers were preserved.`
  }

  return null
}

function GraphUnavailable({
  error,
  onRetry,
}: {
  error: UiError
  onRetry: () => void
}) {
  return (
    <section className="state-card state-error" role="alert" data-testid="graph-error">
      <p className="eyebrow">Graph load</p>
      <h2>Research graph unavailable</h2>
      <p>{error.message}</p>
      <p className="error-meta">
        <span className="error-code">{error.code}</span>
        {error.retryable ? ' · retryable' : ' · not reported as retryable'}
        {error.requestId ? ` · request ${error.requestId}` : ''}
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
      <button type="button" className="button button-primary" onClick={onRetry}>
        Retry graph load
      </button>
      <p className="limitation-note">
        No fallback graph or fabricated source data is displayed.
      </p>
    </section>
  )
}

export default function App() {
  const config = useMemo(() => readRuntimeConfig(), [])
  const fixtureClient = useMemo(() => createFixtureClient(), [])
  const liveClient = useMemo(
    () => createGatewayClient({ base: config.apiBase }),
    [config.apiBase],
  )

  const [graph, setGraph] = useState<GraphResult | null>(null)
  const [graphPhase, setGraphPhase] = useState<GraphPhase>('idle')
  const [graphError, setGraphError] = useState<UiError | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null)
  const [startError, setStartError] = useState<UiError | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)
  const [originNotice, setOriginNotice] = useState<string | null>(null)
  const [filters, setFilters] = useState<NodeFilters>(() =>
    filtersFromQueryString(window.location.search),
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<DetailState>({ status: 'idle' })
  const [detailRetryKey, setDetailRetryKey] = useState(0)
  const [selection, setSelection] = useState<PairSelection>({ a: null, b: null })
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<MobileTab>('tree')
  const [showAllNodes, setShowAllNodes] = useState(false)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [questionError, setQuestionError] = useState<UiError | null>(null)
  const [expandError, setExpandError] = useState<UiError | null>(null)
  const [addError, setAddError] = useState<UiError | null>(null)
  const [candidateSelections, setCandidateSelections] = useState<
    Record<string, string[]>
  >({})
  const [citationView, setCitationView] = useState<{
    answer: AnswerResult
    activeCitationId: string | null
  } | null>(null)
  const [startSubmitting, setStartSubmitting] = useState(false)
  const [questionSubmitting, setQuestionSubmitting] = useState(false)
  const [expandSubmitting, setExpandSubmitting] = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)

  const graphRef = useRef<GraphResult | null>(null)
  const sessionRef = useRef<SessionInfo | null>(null)
  const activeJobRef = useRef<ActiveJob | null>(null)
  const submissionGateRef = useRef(createSubmissionGate())
  const mutationIdsRef = useRef(createMutationIdTracker(newRequestId))
  const sessionEpochRef = useRef(0)
  const finishedJobsRef = useRef<Set<string>>(new Set())
  const graphAbortRef = useRef<AbortController | null>(null)
  const lastGraphRequestRef = useRef<GraphRequest | null>(null)
  const bootRef = useRef(false)
  const bootJobRef = useRef(false)
  const urlStateAppliedRef = useRef(false)
  const initialNodeRef = useRef(
    new URLSearchParams(window.location.search).get('node'),
  )
  const initialSelectionRef = useRef({
    a: new URLSearchParams(window.location.search).get('a'),
    b: new URLSearchParams(window.location.search).get('b'),
  })
  const finishJobRef = useRef<(job: JobEnvelope) => void>(() => {})

  graphRef.current = graph
  sessionRef.current = session
  activeJobRef.current = activeJob

  const reportPurposeError = useCallback(
    (purpose: JobPurpose, error: UiError) => {
      if (purpose === 'start') {
        setStartError(error)
      } else if (purpose === 'question') {
        setQuestionError(error)
      } else if (purpose === 'expand') {
        setExpandError(error)
      } else {
        setAddError(error)
      }
    },
    [],
  )

  const client =
    session !== null && session.fixture && session.transport === 'bundled'
      ? fixtureClient
      : liveClient

  const seedNode = graph
    ? graph.nodes.find((node) => node.id === graph.seed_node_id) ?? null
    : null
  const rootNode =
    graph && graph.root_node_id
      ? graph.nodes.find((node) => node.id === graph.root_node_id) ?? null
      : null

  const nodeById = useMemo(() => {
    const map = new Map<string, SourceNode>()
    for (const node of graph?.nodes ?? []) {
      map.set(node.id, node)
    }
    return map
  }, [graph])

  const layout = useMemo(
    () => (graph ? buildChronologicalLayout(graph) : null),
    [graph],
  )

  const filtered = useMemo(
    () =>
      graph
        ? filterGraphNodes(graph, filters)
        : { matchedIds: new Set<string>(), contextIds: new Set<string>() },
    [graph, filters],
  )

  const caps = useMemo(
    () =>
      graph
        ? applyGraphCaps(graph, showAllNodes)
        : {
            nodeIds: new Set<string>(),
            edgeRelationshipIds: new Set<string>(),
            hiddenCount: 0,
            capReached: false,
          },
    [graph, showAllNodes],
  )

  const aNode = selection.a ? nodeById.get(selection.a) ?? null : null
  const bNode = selection.b ? nodeById.get(selection.b) ?? null : null
  const pendingNode = pendingNodeId ? nodeById.get(pendingNodeId) ?? null : null

  const latestAnswer = answers.length > 0 ? answers[answers.length - 1] : null
  const previousAnswers = answers.slice(0, -1).reverse()

  const latestCandidates = useMemo(() => {
    const map = new Map<string, AdditionalCandidate>()
    for (const candidate of latestAnswer?.answer?.additional_candidates ?? []) {
      map.set(candidate.candidate_id, candidate)
    }
    return map
  }, [latestAnswer])

  const citationCandidates = useMemo(() => {
    const map = new Map<string, AdditionalCandidate>()
    for (const candidate of citationView?.answer.additional_candidates ?? []) {
      map.set(candidate.candidate_id, candidate)
    }
    return map
  }, [citationView])

  const loadGraph = useCallback(
    async (request: GraphRequest): Promise<GraphResult | null> => {
      const epoch = sessionEpochRef.current
      graphAbortRef.current?.abort()
      const controller = new AbortController()
      graphAbortRef.current = controller
      lastGraphRequestRef.current = request
      const isStale = () =>
        controller.signal.aborted || sessionEpochRef.current !== epoch
      setGraphPhase('loading')
      setGraphError(null)
      if (request.resetWorkspace) {
        setGraph(null)
        setAnswers([])
        setSelection({ a: null, b: null })
        setPendingNodeId(null)
        setSelectedNodeId(null)
        setDetailState({ status: 'idle' })
        setOriginNotice(null)
        setQuestionError(null)
        setExpandError(null)
        setAddError(null)
        setCandidateSelections({})
        setShowAllNodes(false)
      }

      const requestClient =
        request.fixture && request.transport === 'bundled'
          ? fixtureClient
          : liveClient
      try {
        const raw = await requestClient.getGraph(
          request.researchId,
          controller.signal,
        )
        if (isStale()) {
          return null
        }
        const validation = validateGraphResult(raw, request.researchId)
        if (!validation.ok) {
          setGraphPhase('error')
          setGraphError(malformedGraphError(validation.errors))
          return null
        }
        let nextGraph = validation.value
        let gatewayRevisionNotice: string | null = null
        if (
          request.fixture &&
          typeof request.minRevision === 'number' &&
          nextGraph.graph_revision < request.minRevision
        ) {
          if (request.transport === 'bundled') {
            try {
              const expansion = await requestClient.expandNode(
                request.researchId,
                {
                  node_id: nextGraph.seed_node_id,
                  graph_revision: nextGraph.graph_revision,
                  request_id: newRequestId(),
                },
                controller.signal,
              )
              if (isStale()) {
                return null
              }
              if (expansion.status === 'completed') {
                const refreshed = await requestClient.getGraph(
                  request.researchId,
                  controller.signal,
                )
                if (isStale()) {
                  return null
                }
                const revalidation = validateGraphResult(
                  refreshed,
                  request.researchId,
                )
                if (revalidation.ok) {
                  nextGraph = revalidation.value
                }
              }
            } catch {
              // Resume best-effort: an unavailable expansion keeps the current
              // revision and never invents nodes.
            }
          } else {
            gatewayRevisionNotice = `The read-only gateway demo serves graph revision ${nextGraph.graph_revision}, but this link requested revision ${request.minRevision}. Expansion is not implemented for the gateway transport, so no bundled fallback was substituted.`
          }
        }
        if (isStale()) {
          return null
        }
        if (
          !request.resetWorkspace &&
          graphRef.current !== null &&
          graphRef.current.research_id === nextGraph.research_id &&
          nextGraph.graph_revision < graphRef.current.graph_revision
        ) {
          return graphRef.current
        }
        setGraph(nextGraph)
        setGraphPhase('ready')
        if (gatewayRevisionNotice !== null) {
          setOriginNotice(gatewayRevisionNotice)
        }
        setSession({
          researchId: request.researchId,
          question: request.question,
          sourceUrl: request.sourceUrl,
          fixture: request.fixture,
          transport: request.fixture ? request.transport : null,
        })
        setMobileTab('tree')
        return nextGraph
      } catch (error) {
        if (isStale()) {
          return null
        }
        setGraphPhase('error')
        setGraphError(
          toUiError(error, 'The research graph could not be loaded.'),
        )
        return null
      }
    },
    [fixtureClient, liveClient],
  )

  const loadDemo = useCallback(
    async (
      transport: DemoTransport = config.demoTransport,
      minRevision = 1,
    ) => {
      sessionEpochRef.current += 1
      submissionGateRef.current.reset()
      mutationIdsRef.current.clear()
      setStartSubmitting(false)
      setQuestionSubmitting(false)
      setExpandSubmitting(false)
      setAddSubmitting(false)
      setStartError(null)
      setFormNotice(null)
      const nextGraph = await loadGraph({
        researchId: config.fixtureResearchId,
        fixture: true,
        transport,
        question: 'Synthetic demo — Riverbend battery storage case',
        sourceUrl: null,
        resetWorkspace: true,
        minRevision,
      })
      if (nextGraph) {
        const seed = nextGraph.nodes.find(
          (node) => node.id === nextGraph.seed_node_id,
        )
        setSession((previous) =>
          previous
            ? { ...previous, sourceUrl: seed?.requested_url ?? null }
            : previous,
        )
      }
    },
    [config.demoTransport, config.fixtureResearchId, loadGraph],
  )

  const submitLive = useCallback(
    async (input: { question: string; sourceUrl: string }) => {
      if (activeJobRef.current) {
        return
      }
      const gate = submissionGateRef.current
      const token = gate.begin()
      if (token === null) {
        return
      }
      setStartSubmitting(true)
      try {
        setStartError(null)
        setFormNotice(null)
        setAnswers([])
        setSelectedNodeId(null)
        setSelection({ a: null, b: null })
        setPendingNodeId(null)
        setDetailState({ status: 'idle' })
        setOriginNotice(null)
        setQuestionError(null)
        setExpandError(null)
        setAddError(null)
        setCandidateSelections({})
        setFilters(EMPTY_FILTERS)

        if (config.mode === 'fixture') {
          setFormNotice(
            'Live discovery is unavailable while fixture mode is active. Use “Load synthetic Riverbend demo” to explore the demo, or set VITE_FIXTURE_MODE=false and connect the gateway for live research.',
          )
          return
        }

        graphAbortRef.current?.abort()
        graphAbortRef.current = null
        setGraphPhase('idle')
        setGraphError(null)
        sessionEpochRef.current += 1
        const epoch = sessionEpochRef.current
        const signature = mutationSignature('start', {
          question: input.question,
          sourceUrl: input.sourceUrl,
        })
        const requestId = mutationIdsRef.current.forPayload(signature)
        try {
          const job = await liveClient.startResearch(
            {
              question: input.question,
              source_url: input.sourceUrl,
              request_id: requestId,
            },
            undefined,
          )
          if (sessionEpochRef.current !== epoch) {
            return
          }
          const mismatch = jobResponseMismatch(job, {
            kind: 'discovery',
            requestId,
          })
          if (mismatch !== null) {
            reportPurposeError(
              'start',
              malformedResponse(
                `The gateway returned a job response that does not match this request: ${mismatch}`,
              ),
            )
            return
          }
          mutationIdsRef.current.settle(signature)
          const active: ActiveJob = {
            purpose: 'start',
            context: {
              researchId: job.research_id,
              question: input.question,
              sourceUrl: input.sourceUrl,
            },
            view: jobView(job),
            raw: job,
          }
          setActiveJob(active)
          activeJobRef.current = active
          if (isTerminalJob(job)) {
            await finishJobRef.current(job)
          }
        } catch (error) {
          if (sessionEpochRef.current !== epoch) {
            return
          }
          setStartError(
            toUiError(
              error,
              'Live discovery could not start. The gateway may not be wired yet.',
            ),
          )
        }
      } finally {
        if (gate.end(token)) {
          setStartSubmitting(false)
        }
      }
    },
    [config.mode, liveClient, reportPurposeError],
  )

  const retryGraph = useCallback(() => {
    if (lastGraphRequestRef.current) {
      void loadGraph(lastGraphRequestRef.current)
      return
    }
    if (sessionRef.current) {
      void loadGraph({
        researchId: sessionRef.current.researchId,
        fixture: sessionRef.current.fixture,
        transport: transportForSession(
          sessionRef.current,
          config.demoTransport,
        ),
        question: sessionRef.current.question,
        sourceUrl: sessionRef.current.sourceUrl,
        resetWorkspace: false,
      })
    }
  }, [config.demoTransport, loadGraph])

  const finishJob = useCallback(
    async (job: JobEnvelope) => {
      const active = activeJobRef.current
      if (!active || active.view.id !== job.job_id) {
        return
      }
      if (finishedJobsRef.current.has(job.job_id)) {
        return
      }
      const epoch = sessionEpochRef.current
      const activeJobId = active.view.id
      const isStillCurrent = () =>
        sessionEpochRef.current === epoch &&
        activeJobRef.current?.view.id === activeJobId
      const expectedResearchId =
        sessionRef.current?.researchId ?? active.context.researchId
      if (job.research_id !== expectedResearchId) {
        finishedJobsRef.current.add(job.job_id)
        if (!isStillCurrent()) {
          return
        }
        setOriginNotice(
          'The completed job belongs to a different research session, so its result was ignored. The current graph and answers were not changed.',
        )
        setActiveJob(null)
        activeJobRef.current = null
        return
      }
      finishedJobsRef.current.add(job.job_id)

      if (job.status === 'failed' || job.status === 'cancelled') {
        const error = jobError(
          job,
          active.purpose === 'question'
            ? 'The question job did not complete.'
            : 'The research job did not complete.',
        )
        if (!isStillCurrent()) {
          return
        }
        if (active.purpose === 'start') {
          setStartError(error)
          setGraphPhase('idle')
        } else if (active.purpose === 'question') {
          setQuestionError(error)
        } else if (active.purpose === 'expand') {
          setExpandError(error)
        } else {
          setAddError(error)
        }
        setActiveJob(null)
        activeJobRef.current = null
        return
      }

      if (job.status !== 'completed') {
        finishedJobsRef.current.delete(job.job_id)
        return
      }

      if (active.purpose === 'start') {
        const question =
          active.context.question ?? 'Resumed research question'
        const sourceUrl = active.context.sourceUrl ?? null
        const nextGraph = await loadGraph({
          researchId: job.research_id,
          fixture: false,
          transport: 'gateway',
          question,
          sourceUrl,
          resetWorkspace: false,
        })
        if (!isStillCurrent()) {
          return
        }
        setActiveJob(null)
        activeJobRef.current = null
        if (!nextGraph) {
          setStartError(
            toUiError(
              new Error('Graph unavailable after the discovery job.'),
              'The discovery job completed, but its graph could not be loaded.',
            ),
          )
        }
        return
      }

      if (active.purpose === 'question') {
        const context = active.context
        const answerNodeIds: [string, string] =
          context.nodeIds ??
          ((job.result as AnswerResult | null)?.selected_nodes
            ?.slice(0, 2)
            .map((pin) => pin.node_id) as [string, string] | undefined) ?? [
            '',
            '',
          ]
        const graphRevision =
          context.graphRevision ??
          (job.result as AnswerResult | null)?.graph_revision ??
          graphRef.current?.graph_revision ??
          0
        const question =
          context.question ??
          (job.result as AnswerResult | null)?.question ??
          'Resumed node question'
        const recordId = `${job.job_id}-${Date.now()}`
        const rawResult = job.result
        if (!isStillCurrent()) {
          return
        }
        if (!rawResult || typeof rawResult !== 'object') {
          setAnswers((previous) => [
            ...previous,
            {
              localId: recordId,
              question,
              nodeIds: answerNodeIds,
              graphRevision,
              answer: null,
              job: jobView(job),
              error: {
                code: 'MALFORMED_RESPONSE',
                message:
                  'The question job completed without a readable answer payload.',
                retryable: false,
                requestId: null,
                details: [],
              },
              validationErrors: null,
            },
          ])
          setQuestionError(null)
          setActiveJob(null)
          activeJobRef.current = null
          return
        }

        const result = rawResult as AnswerResult
        const candidateIds = new Set(
          (result.additional_candidates ?? []).map(
            (candidate) => candidate.candidate_id,
          ),
        )
        const knownNodeIds = new Set<string>([
          ...(graphRef.current?.nodes.map((node) => node.id) ?? []),
          ...candidateIds,
        ])
        const validation = validateAnswerResult(result, {
          researchId: job.research_id,
          graphRevision,
          nodeIds: answerNodeIds,
          knownNodeIds,
          knownCandidateIds: candidateIds,
        })
        if (!validation.ok) {
          setAnswers((previous) => [
            ...previous,
            {
              localId: recordId,
              question,
              nodeIds: answerNodeIds,
              graphRevision,
              answer: null,
              job: jobView(job),
              error: null,
              validationErrors: validation.errors,
            },
          ])
          setQuestionError(null)
        } else {
          setAnswers((previous) => [
            ...previous,
            {
              localId: recordId,
              question,
              nodeIds: answerNodeIds,
              graphRevision,
              answer: validation.value,
              job: jobView(job),
              error: null,
              validationErrors: null,
            },
          ])
          setQuestionError(null)
        }
        setActiveJob(null)
        activeJobRef.current = null
        return
      }

      const mutation = job.result as GraphMutationResult | null
      const previousGraph = graphRef.current
      const nextGraph = await loadGraph({
        researchId: job.research_id,
        fixture: sessionRef.current?.fixture ?? false,
        transport: transportForSession(
          sessionRef.current,
          config.demoTransport,
        ),
        question: sessionRef.current?.question ?? 'Research workspace',
        sourceUrl: sessionRef.current?.sourceUrl ?? null,
        resetWorkspace: false,
      })
      if (!isStillCurrent()) {
        return
      }
      if (!nextGraph) {
        const error = toUiError(
          new Error('Graph refresh failed.'),
          'The job completed, but the updated graph could not be loaded. The existing tree was kept.',
        )
        if (active.purpose === 'expand') {
          setExpandError(error)
        } else {
          setAddError(error)
        }
        setActiveJob(null)
        activeJobRef.current = null
        return
      }

      const notice = buildOriginNotice(
        previousGraph?.root_node_id ?? null,
        previousGraph?.graph_revision,
        nextGraph,
        mutation,
      )
      setOriginNotice(notice)

      if (active.purpose === 'add_discoveries') {
        const addedIds = mutation?.added_node_ids ?? []
        const firstAdded = addedIds.find((id) =>
          nextGraph.nodes.some((node) => node.id === id),
        )
        if (firstAdded) {
          setSelectedNodeId(firstAdded)
          setMobileTab('ask')
        }
      }
      setActiveJob(null)
      activeJobRef.current = null
    },
    [config.demoTransport, loadGraph],
  )
  finishJobRef.current = finishJob

  const polling = useJobPolling({
    client: client as NewsTraceClient,
    jobId: activeJob?.view.id ?? null,
    enabled: activeJob !== null && !isTerminalJob(activeJob.raw),
    initialJob: activeJob?.raw,
    onJob: (job) => {
      setActiveJob((previous) =>
        previous ? { ...previous, raw: job, view: jobView(job) } : previous,
      )
    },
    onTerminal: (job) => {
      void finishJobRef.current(job)
    },
  })

  useEffect(() => {
    if (polling.error && activeJob) {
      const error = toUiError(
        polling.error,
        'Job status could not be polled. The existing workspace was kept.',
      )
      if (activeJob.purpose === 'question') {
        setQuestionError(error)
      } else if (activeJob.purpose === 'expand') {
        setExpandError(error)
      } else if (activeJob.purpose === 'add_discoveries') {
        setAddError(error)
      } else {
        setStartError(error)
      }
    }
  }, [polling.error, activeJob])

  useEffect(() => {
    if (!graph || !session || !selectedNodeId) {
      setDetailState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setDetailState({ status: 'loading', nodeId: selectedNodeId })
    client
      .getNodeDetails(session.researchId, selectedNodeId, controller.signal)
      .then((raw) => {
        if (controller.signal.aborted) {
          return
        }
        const validation = validateNodeDetails(raw, {
          researchId: session.researchId,
          nodeId: selectedNodeId,
          knownNodeIds: new Set(nodeById.keys()),
        })
        if (!validation.ok) {
          setDetailState({
            status: 'error',
            nodeId: selectedNodeId,
            error: malformedNodeDetailsError(validation.errors),
          })
          return
        }
        setDetailState({
          status: 'ready',
          nodeId: selectedNodeId,
          details: validation.value as NodeDetailsPayload,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        setDetailState({
          status: 'error',
          nodeId: selectedNodeId,
          error: toUiError(error, 'The node details could not be loaded.'),
        })
      })
    return () => controller.abort()
  }, [client, detailRetryKey, graph, nodeById, selectedNodeId, session])

  useEffect(() => {
    if (!graph) {
      return
    }
    const ids = new Set(graph.nodes.map((node) => node.id))
    setSelection((previous) => {
      const a = previous.a && ids.has(previous.a) ? previous.a : null
      const b = previous.b && ids.has(previous.b) ? previous.b : null
      return a === previous.a && b === previous.b ? previous : { a, b }
    })
    setPendingNodeId((previous) =>
      previous && ids.has(previous) ? previous : null,
    )
    setSelectedNodeId((previous) =>
      previous && ids.has(previous) ? previous : null,
    )
  }, [graph])

  useEffect(() => {
    if (bootRef.current) {
      return
    }
    bootRef.current = true
    const params = new URLSearchParams(window.location.search)
    const demo = params.get('demo') === '1'
    const researchId = params.get('research')
    const urlTransport = parseDemoTransport(params.get('transport'))
    const revision = Number.parseInt(params.get('revision') ?? '', 10)
    const minRevision = Number.isInteger(revision) && revision > 0 ? revision : 1
    if (demo) {
      void loadDemo(urlTransport ?? config.demoTransport, minRevision)
    } else if (researchId) {
      const fixture = researchId === config.fixtureResearchId
      void loadGraph({
        researchId,
        fixture,
        transport: fixture
          ? urlTransport ?? config.demoTransport
          : 'gateway',
        question: 'Resumed research workspace',
        sourceUrl: null,
        resetWorkspace: true,
        minRevision: fixture ? minRevision : undefined,
      })
    }
    // Boot only once, even in React StrictMode. The graph/session dependencies
    // are intentionally excluded so a URL update cannot trigger a second load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!graph || urlStateAppliedRef.current) {
      return
    }
    urlStateAppliedRef.current = true
    const nodeId = initialNodeRef.current
    if (nodeId && graph.nodes.some((node) => node.id === nodeId)) {
      setSelectedNodeId(nodeId)
      setMobileTab('ask')
    }
    const initial = initialSelectionRef.current
    const ids = new Set(graph.nodes.map((node) => node.id))
    const a = initial.a && ids.has(initial.a) ? initial.a : null
    const b = initial.b && ids.has(initial.b) ? initial.b : null
    if (a || b) {
      setSelection({ a, b })
    }
  }, [graph])

  useEffect(() => {
    if (!graph || !session || bootJobRef.current) {
      return
    }
    const jobId = new URLSearchParams(window.location.search).get('job')
    if (!jobId) {
      return
    }
    bootJobRef.current = true
    const epoch = sessionEpochRef.current
    const researchId = session.researchId
    client
      .getJob(jobId)
      .then((job) => {
        if (
          sessionEpochRef.current !== epoch ||
          sessionRef.current?.researchId !== researchId ||
          activeJobRef.current !== null ||
          submissionGateRef.current.isHeld()
        ) {
          return
        }
        if (job.research_id !== researchId) {
          setOriginNotice(
            'The job in this link belongs to a different research session and was not resumed.',
          )
          return
        }
        const active: ActiveJob = {
          purpose: purposeForKind(job.kind),
          context: { researchId: job.research_id },
          view: jobView(job),
          raw: job,
        }
        setActiveJob(active)
        activeJobRef.current = active
        if (isTerminalJob(job)) {
          void finishJobRef.current(job)
        }
      })
      .catch((error: unknown) => {
        if (
          sessionEpochRef.current !== epoch ||
          sessionRef.current?.researchId !== researchId ||
          activeJobRef.current !== null ||
          submissionGateRef.current.isHeld()
        ) {
          return
        }
        const uiError = toUiError(error, 'The pending job could not be resumed.')
        if (uiError.code !== 'NOT_FOUND') {
          setStartError(uiError)
        }
      })
  }, [client, graph, session])

  useEffect(() => {
    if (!graph || !session) {
      return
    }
    const params = new URLSearchParams()
    if (session.fixture) {
      params.set('demo', '1')
      if (session.transport !== null) {
        params.set('transport', session.transport)
      }
    } else {
      params.set('research', session.researchId)
    }
    if (graph.graph_revision > 1) {
      params.set('revision', String(graph.graph_revision))
    }
    if (activeJob && !isTerminalJob(activeJob.raw)) {
      params.set('job', activeJob.view.id)
    }
    if (selectedNodeId) {
      params.set('node', selectedNodeId)
    }
    if (selection.a) {
      params.set('a', selection.a)
    }
    if (selection.b) {
      params.set('b', selection.b)
    }
    const filterQuery = filterToQueryString(filters)
    const filterParams = new URLSearchParams(filterQuery)
    filterParams.forEach((value, key) => {
      if (value.length > 0) {
        params.set(key, value)
      }
    })
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
  }, [activeJob, filters, graph, selectedNodeId, selection, session])

  const inspectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setMobileTab('ask')
  }, [])

  const requestSelection = useCallback(
    (nodeId: string) => {
      if (nodeId === selection.a || nodeId === selection.b) {
        return
      }
      if (selection.a === null) {
        setSelection({ a: nodeId, b: selection.b })
        setPendingNodeId(null)
        return
      }
      if (selection.b === null) {
        setSelection({ a: selection.a, b: nodeId })
        setPendingNodeId(null)
        return
      }
      setPendingNodeId(nodeId)
    },
    [selection],
  )

  const clearPair = useCallback(() => {
    setSelection({ a: null, b: null })
    setPendingNodeId(null)
  }, [])

  const clearSlot = useCallback((slot: SelectionSlot) => {
    setSelection((previous) =>
      slot === 'a'
        ? { a: null, b: previous.b }
        : { a: previous.a, b: null },
    )
    setPendingNodeId(null)
  }, [])

  const swapPair = useCallback(() => {
    setSelection((previous) =>
      previous.a && previous.b
        ? { a: previous.b, b: previous.a }
        : previous,
    )
    setPendingNodeId(null)
  }, [])

  const replaceSlot = useCallback(
    (slot: SelectionSlot) => {
      if (!pendingNodeId) {
        return
      }
      const replacement = pendingNodeId
      setSelection((previous) =>
        slot === 'a'
          ? {
              a: replacement,
              b: previous.b === replacement ? null : previous.b,
            }
          : {
              a: previous.a === replacement ? null : previous.a,
              b: replacement,
            },
      )
      setPendingNodeId(null)
    },
    [pendingNodeId],
  )

  const askQuestion = useCallback(
    async (question: string) => {
      if (
        !session ||
        !graph ||
        !selection.a ||
        !selection.b ||
        activeJobRef.current
      ) {
        return
      }
      const gate = submissionGateRef.current
      const token = gate.begin()
      if (token === null) {
        return
      }
      setQuestionSubmitting(true)
      setQuestionError(null)
      const nodeIds: [string, string] = [selection.a, selection.b]
      const epoch = sessionEpochRef.current
      try {
        const signature = mutationSignature('question', {
          researchId: session.researchId,
          nodeIds,
          graphRevision: graph.graph_revision,
          question,
        })
        const requestId = mutationIdsRef.current.forPayload(signature)
        const job = await client.askQuestion(session.researchId, {
          node_ids: nodeIds,
          graph_revision: graph.graph_revision,
          question,
          request_id: requestId,
        })
        if (sessionEpochRef.current !== epoch) {
          return
        }
        const mismatch = jobResponseMismatch(job, {
          kind: 'question',
          researchId: session.researchId,
          requestId,
        })
        if (mismatch !== null) {
          reportPurposeError(
            'question',
            malformedResponse(
              `The gateway returned a job response that does not match this request: ${mismatch}`,
            ),
          )
          return
        }
        mutationIdsRef.current.settle(signature)
        const active: ActiveJob = {
          purpose: 'question',
          context: {
            researchId: session.researchId,
            question,
            nodeIds,
            graphRevision: graph.graph_revision,
          },
          view: jobView(job),
          raw: job,
        }
        setActiveJob(active)
        activeJobRef.current = active
        if (isTerminalJob(job)) {
          await finishJobRef.current(job)
        }
      } catch (error) {
        if (sessionEpochRef.current !== epoch) {
          return
        }
        setQuestionError(
          toUiError(
            error,
            'The question could not be submitted. The question backend may not be wired yet.',
          ),
        )
      } finally {
        if (gate.end(token)) {
          setQuestionSubmitting(false)
        }
      }
    },
    [client, graph, selection, session, reportPurposeError],
  )

  const expandNode = useCallback(
    async (nodeId: string) => {
      if (!session || !graph || activeJobRef.current) {
        return
      }
      const gate = submissionGateRef.current
      const token = gate.begin()
      if (token === null) {
        return
      }
      setExpandSubmitting(true)
      setExpandError(null)
      const epoch = sessionEpochRef.current
      try {
        const signature = mutationSignature('expand', {
          researchId: session.researchId,
          nodeId,
          graphRevision: graph.graph_revision,
        })
        const requestId = mutationIdsRef.current.forPayload(signature)
        const job = await client.expandNode(session.researchId, {
          node_id: nodeId,
          graph_revision: graph.graph_revision,
          request_id: requestId,
        })
        if (sessionEpochRef.current !== epoch) {
          return
        }
        const mismatch = jobResponseMismatch(job, {
          kind: 'expansion',
          researchId: session.researchId,
          requestId,
        })
        if (mismatch !== null) {
          reportPurposeError(
            'expand',
            malformedResponse(
              `The gateway returned a job response that does not match this request: ${mismatch}`,
            ),
          )
          return
        }
        mutationIdsRef.current.settle(signature)
        const active: ActiveJob = {
          purpose: 'expand',
          context: {
            researchId: session.researchId,
            previousRoot: graph.root_node_id,
            previousRevision: graph.graph_revision,
          },
          view: jobView(job),
          raw: job,
        }
        setActiveJob(active)
        activeJobRef.current = active
        if (isTerminalJob(job)) {
          await finishJobRef.current(job)
        }
      } catch (error) {
        if (sessionEpochRef.current !== epoch) {
          return
        }
        setExpandError(
          toUiError(
            error,
            'Further discovery could not start. The existing tree was kept.',
          ),
        )
      } finally {
        if (gate.end(token)) {
          setExpandSubmitting(false)
        }
      }
    },
    [client, graph, session, reportPurposeError],
  )

  const toggleCandidate = useCallback(
    (answerId: string, candidateId: string) => {
      setCandidateSelections((previous) => {
        const current = previous[answerId] ?? []
        const next = current.includes(candidateId)
          ? current.filter((id) => id !== candidateId)
          : [...current, candidateId]
        return { ...previous, [answerId]: next }
      })
    },
    [],
  )

  const addDiscoveries = useCallback(
    async (record: AnswerRecord) => {
      if (
        !session ||
        !graph ||
        !record.answer ||
        activeJobRef.current
      ) {
        return
      }
      const selected =
        candidateSelections[record.answer.answer_id] ?? []
      if (selected.length === 0) {
        return
      }
      const gate = submissionGateRef.current
      const token = gate.begin()
      if (token === null) {
        return
      }
      setAddSubmitting(true)
      setAddError(null)
      const candidateIds = [...selected].sort()
      const epoch = sessionEpochRef.current
      try {
        if (record.graphRevision !== graph.graph_revision) {
          setAddError({
            code: 'VERSION_CONFLICT',
            message: `These additional findings were returned for graph revision ${record.graphRevision}. The current graph is revision ${graph.graph_revision}. Ask the question again before adding them.`,
            retryable: false,
            requestId: null,
            details: [],
          })
          return
        }
        const signature = mutationSignature('add_discoveries', {
          researchId: session.researchId,
          answerId: record.answer.answer_id,
          candidateIds,
          graphRevision: graph.graph_revision,
        })
        const requestId = mutationIdsRef.current.forPayload(signature)
        const job = await client.addDiscoveries(session.researchId, {
          answer_id: record.answer.answer_id,
          candidate_ids: candidateIds,
          graph_revision: graph.graph_revision,
          request_id: requestId,
        })
        if (sessionEpochRef.current !== epoch) {
          return
        }
        const mismatch = jobResponseMismatch(job, {
          kind: 'add_discoveries',
          researchId: session.researchId,
          requestId,
        })
        if (mismatch !== null) {
          reportPurposeError(
            'add_discoveries',
            malformedResponse(
              `The gateway returned a job response that does not match this request: ${mismatch}`,
            ),
          )
          return
        }
        mutationIdsRef.current.settle(signature)
        const active: ActiveJob = {
          purpose: 'add_discoveries',
          context: {
            researchId: session.researchId,
            previousRoot: graph.root_node_id,
            previousRevision: graph.graph_revision,
            answerId: record.answer.answer_id,
            candidateIds,
          },
          view: jobView(job),
          raw: job,
        }
        setActiveJob(active)
        activeJobRef.current = active
        if (isTerminalJob(job)) {
          await finishJobRef.current(job)
        }
      } catch (error) {
        if (sessionEpochRef.current !== epoch) {
          return
        }
        setAddError(
          toUiError(
            error,
            'The additional findings could not be added. The tree was not changed.',
          ),
        )
      } finally {
        if (gate.end(token)) {
          setAddSubmitting(false)
        }
      }
    },
    [candidateSelections, client, graph, session, reportPurposeError],
  )

  const cancelActiveJob = useCallback(async () => {
    const active = activeJobRef.current
    if (!active) {
      return
    }
    const jobId = active.view.id
    const epoch = sessionEpochRef.current
    const purpose = active.purpose
    try {
      const job = await client.cancelJob(jobId)
      if (
        sessionEpochRef.current !== epoch ||
        activeJobRef.current?.view.id !== jobId
      ) {
        return
      }
      const expectedResearchId =
        sessionRef.current?.researchId ?? active.context.researchId
      const mismatch = jobResponseMismatch(job, {
        kind: active.view.kind,
        jobId,
        researchId: expectedResearchId,
      })
      if (mismatch !== null) {
        reportPurposeError(
          purpose,
          malformedResponse(
            `The gateway returned a job response that does not match this request: ${mismatch}`,
          ),
        )
        return
      }
      setActiveJob((previous) =>
        previous && previous.view.id === jobId
          ? { ...previous, raw: job, view: jobView(job) }
          : previous,
      )
      if (isTerminalJob(job)) {
        await finishJobRef.current(job)
      }
    } catch (error) {
      if (
        sessionEpochRef.current !== epoch ||
        activeJobRef.current?.view.id !== jobId
      ) {
        return
      }
      reportPurposeError(
        purpose,
        toUiError(error, 'Cancellation could not be requested.'),
      )
    }
  }, [client, reportPurposeError])

  const newResearch = useCallback(() => {
    sessionEpochRef.current += 1
    submissionGateRef.current.reset()
    mutationIdsRef.current.clear()
    setStartSubmitting(false)
    setQuestionSubmitting(false)
    setExpandSubmitting(false)
    setAddSubmitting(false)
    const active = activeJobRef.current
    if (active && !isTerminalJob(active.raw)) {
      void client.cancelJob(active.view.id).catch(() => {
        // Cancellation is best-effort; the server remains authoritative.
      })
    }
    graphAbortRef.current?.abort()
    setGraph(null)
    setGraphPhase('idle')
    setGraphError(null)
    setSession(null)
    setActiveJob(null)
    activeJobRef.current = null
    setStartError(null)
    setFormNotice(null)
    setOriginNotice(null)
    setFilters(EMPTY_FILTERS)
    setSelectedNodeId(null)
    setDetailState({ status: 'idle' })
    setSelection({ a: null, b: null })
    setPendingNodeId(null)
    setMobileTab('tree')
    setShowAllNodes(false)
    setAnswers([])
    setQuestionError(null)
    setExpandError(null)
    setAddError(null)
    setCandidateSelections({})
    setCitationView(null)
    finishedJobsRef.current.clear()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.hash}`,
    )
  }, [client])

  const openCitation = useCallback(
    (answer: AnswerResult, citationId: string) => {
      setCitationView({ answer, activeCitationId: citationId })
    },
    [],
  )

  const phase: 'loading' | 'ready' | 'error' =
    graphPhase === 'error'
      ? 'error'
      : graph
        ? 'ready'
        : 'loading'
  const headerPhase: 'loading' | 'ready' | 'error' = graph
    ? 'ready'
    : graphPhase === 'error'
      ? 'error'
      : 'loading'

  const headerQuestion =
    session?.question ?? activeJob?.context.question ?? ''
  const headerSourceUrl =
    session?.sourceUrl ?? activeJob?.context.sourceUrl ?? null
  const fixtureSession = session?.fixture ?? config.mode === 'fixture'
  // The configured demo transport is only a pre-session fallback. An explicit
  // live session must never inherit a synthetic transport tooltip just because
  // the app is configured in fixture mode.
  const fixtureTransport: DemoTransport | null = session
    ? session.fixture
      ? session.transport
      : null
    : config.mode === 'fixture'
      ? config.demoTransport
      : null
  const showStart =
    !graph && !activeJob && graphPhase !== 'error'
  const showWorkspace = graph !== null && session !== null
  const showStartJob = activeJob?.purpose === 'start'

  const emptyGraph =
    graph !== null &&
    (graph.nodes.length === 0 ||
      (graph.nodes.length === 1 &&
        graph.tree_edges.length === 0 &&
        graph.relationships.length === 0))

  const activeQuestionJob =
    activeJob?.purpose === 'question' ? activeJob.view : null
  const activeExpandJob =
    activeJob?.purpose === 'expand' ? activeJob.view : null
  const activeAddJob =
    activeJob?.purpose === 'add_discoveries' ? activeJob.view : null
  const busyQuestion = activeJob?.purpose === 'question'
  const busyExpand = activeJob?.purpose === 'expand'
  const busyAdd = activeJob?.purpose === 'add_discoveries'

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a href="#top" className="brand" aria-label="Traceback home">
            <span className="brand-icon">
              <Radar size={22} />
            </span>
            Traceback<span className="brand-period">.</span>
          </a>
          <nav aria-label="Main navigation">
            <button
              type="button"
              className="nav-link"
              onClick={() => {
                if (graph || activeJob) {
                  newResearch()
                }
                window.setTimeout(() => {
                  document.getElementById('research-question')?.focus()
                }, 0)
              }}
            >
              <Search size={14} /> Investigate
            </button>
            <a href="#investigation">
              <FileSearch size={14} /> Evidence
            </a>
          </nav>
          <span
            className={`service ${graph ? 'connected' : ''}`}
            title={
              fixtureTransport === 'gateway'
                ? 'Synthetic fixture served read-only by the configured gateway.'
                : fixtureTransport === 'bundled'
                  ? 'Bundled synthetic fixture adapter is active.'
                  : 'Live gateway mode'
            }
          >
            <span />{' '}
            {fixtureSession ? 'Synthetic demo' : graph ? 'Gateway loaded' : 'Live gateway'}
          </span>
        </div>
      </header>

      <main className="shell" id="top">
        {showStart ? (
          <section className="research-home" aria-labelledby="home-heading">
            <div className="hero-art" aria-hidden="true">
              <div />
              <div />
              <div />
              <div />
              <span />
              <b />
              <i />
            </div>
            <div className="home-copy">
              <p className="eyebrow">Investigative source tracing</p>
              <h1 id="home-heading">
                Every story has an origin.
                <br />
                <em>Trace it.</em>
              </h1>
              <p>
                Submit a question and a source URL. Traceback searches related
                posts, news, and web pages, then shows what came first and how
                the evidence connects.
              </p>
              <ResearchForm
                mode={config.mode}
                demoTransport={config.demoTransport}
                busy={startSubmitting}
                error={startError}
                notice={formNotice}
                onSubmit={submitLive}
                onLoadDemo={() => {
                  void loadDemo()
                }}
              />
              <ul className="home-points" aria-label="What this workspace provides">
                <li>
                  <GitFork size={16} /> Chronological tree with traced links,
                  cross-links, and explicit time uncertainty.
                </li>
                <li>
                  <ShieldCheck size={16} /> Exactly two sources can be pinned to
                  a question and cited in the answer.
                </li>
                <li>
                  <Database size={16} /> Fixture data is labelled synthetic;
                  live discovery is never silently substituted.
                </li>
              </ul>
            </div>
          </section>
        ) : null}

        {showStartJob ? (
          <section className="workspace-page" aria-labelledby="job-heading">
            <ResearchHeader
              phase="loading"
              graph={null}
              question={headerQuestion}
              sourceUrl={headerSourceUrl}
              seedNode={null}
              rootNode={null}
              fixture={fixtureSession}
              transport={null}
              demoNotice={null}
              originNotice={null}
              onNewResearch={newResearch}
            />
            <h2 id="job-heading" className="sr-only">
              Research job progress
            </h2>
            <JobProgress
              phase="loading"
              graph={null}
              job={activeJob.view}
              originNotice={null}
              onCancel={cancelActiveJob}
            />
          </section>
        ) : null}

        {graphPhase === 'error' && !graph ? (
          <section className="workspace-page">
            <GraphUnavailable
              error={
                graphError ?? {
                  code: 'UNKNOWN',
                  message: 'The research graph could not be loaded.',
                  retryable: true,
                  requestId: null,
                  details: [],
                }
              }
              onRetry={retryGraph}
            />
            <button
              type="button"
              className="button button-quiet"
              onClick={newResearch}
            >
              Start over
            </button>
          </section>
        ) : null}

        {showWorkspace && graph && session ? (
          <section
            className="workspace-page"
            id="investigation"
            aria-labelledby="investigation-heading"
          >
            <h2 id="investigation-heading" className="sr-only">
              Research workspace
            </h2>
            <ResearchHeader
              phase={headerPhase}
              graph={graph}
              question={session.question}
              sourceUrl={session.sourceUrl}
              seedNode={seedNode}
              rootNode={rootNode}
              fixture={session.fixture}
              transport={session.transport}
              demoNotice={
                session.fixture && session.transport === 'gateway'
                  ? GATEWAY_DEMO_NOTICE
                  : null
              }
              originNotice={originNotice}
              onNewResearch={newResearch}
            />

            <JobProgress
              phase={phase}
              graph={graph}
              job={
                activeJob?.purpose === 'start' ? activeJob.view : null
              }
              originNotice={null}
              onCancel={
                activeJob && !isTerminalJob(activeJob.raw)
                  ? cancelActiveJob
                  : undefined
              }
            />

            {startError ? (
              <div className="state-card state-error" role="alert">
                <h2>Research action failed</h2>
                <p>{startError.message}</p>
                <p className="error-meta">
                  <span className="error-code">{startError.code}</span>
                  {startError.retryable ? ' · retryable' : ''}
                </p>
              </div>
            ) : null}

            {emptyGraph ? (
              <section className="state-card state-empty" role="status">
                <p className="eyebrow">No related sources</p>
                <h2>No related sources were returned</h2>
                <p>
                  The graph contains{' '}
                  {graph.nodes.length === 1
                    ? 'only the submitted source'
                    : 'an empty source collection'}
                  . This is an honest empty result; no sources are being
                  substituted.
                </p>
              </section>
            ) : (
              <>
                <div
                  className="mobile-tabs"
                  role="tablist"
                  aria-label="Workspace views"
                >
                  {(
                    [
                      ['tree', 'Tree'],
                      ['sources', 'Sources'],
                      ['ask', 'Ask'],
                    ] as const
                  ).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      id={`workspace-tab-${tab}`}
                      aria-selected={mobileTab === tab}
                      aria-controls={`panel-${tab}`}
                      className={`mobile-tab${mobileTab === tab ? ' mobile-tab-active' : ''}`}
                      onClick={() => setMobileTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="workspace">
                  <aside
                    id="panel-sources"
                    className="workspace-panel panel-sources"
                    data-mobile-active={mobileTab === 'sources'}
                    role="tabpanel"
                    aria-labelledby="workspace-tab-sources"
                    tabIndex={0}
                  >
                    <SourceList
                      graph={graph}
                      nodes={graph.nodes}
                      rootNodeId={graph.root_node_id}
                      seedNodeId={graph.seed_node_id}
                      unplacedNodeIds={graph.undated_node_ids ?? []}
                      selectedNodeId={selectedNodeId}
                      selectedA={selection.a}
                      selectedB={selection.b}
                      filters={filters}
                      onFiltersChange={setFilters}
                      matchedIds={filtered.matchedIds}
                      contextIds={filtered.contextIds}
                      hiddenCount={caps.hiddenCount}
                      onInspect={inspectNode}
                      onSelect={requestSelection}
                    />
                  </aside>

                  <div
                    id="panel-tree"
                    className="workspace-panel panel-tree"
                    data-mobile-active={mobileTab === 'tree'}
                    role="tabpanel"
                    aria-labelledby="workspace-tab-tree"
                    tabIndex={0}
                  >
                    {layout ? (
                      <TreeExplorer
                        graph={graph}
                        layout={layout}
                        nodeById={nodeById}
                        rootNodeId={graph.root_node_id}
                        seedNodeId={graph.seed_node_id}
                        selectedNodeId={selectedNodeId}
                        selectedA={selection.a}
                        selectedB={selection.b}
                        matchedIds={filtered.matchedIds}
                        contextIds={filtered.contextIds}
                        nodeIds={caps.nodeIds}
                        relationshipIds={caps.edgeRelationshipIds}
                        hiddenCount={caps.hiddenCount}
                        capReached={caps.capReached}
                        onShowAll={() => setShowAllNodes(true)}
                        onInspect={inspectNode}
                        onSelect={requestSelection}
                      />
                    ) : null}
                  </div>

                  <aside
                    id="panel-ask"
                    className="workspace-panel panel-ask"
                    data-mobile-active={mobileTab === 'ask'}
                    aria-label="Details and question panel"
                  >
                    <NodeDetails
                      graph={graph}
                      nodeById={nodeById}
                      nodeId={selectedNodeId}
                      details={detailState}
                      onRetry={() => setDetailRetryKey((key) => key + 1)}
                      onSelect={(nodeId) => {
                        requestSelection(nodeId)
                        setMobileTab('ask')
                      }}
                      selectedSlot={
                        selection.a === selectedNodeId
                          ? 'A'
                          : selection.b === selectedNodeId
                            ? 'B'
                            : null
                      }
                      crossLinkIds={new Set(graph.cross_link_ids ?? [])}
                      onExpand={expandNode}
                      expanding={busyExpand || expandSubmitting}
                      expandError={expandError}
                    />

                    {activeExpandJob || activeAddJob ? (
                      <JobProgress
                        phase={phase}
                        graph={graph}
                        job={(activeExpandJob ?? activeAddJob) ?? null}
                        originNotice={null}
                        onCancel={cancelActiveJob}
                      />
                    ) : null}

                    <NodeQuestionPanel
                      a={aNode}
                      b={bNode}
                      graphRevision={graph.graph_revision}
                      busy={busyQuestion || questionSubmitting}
                      error={questionError}
                      onAsk={askQuestion}
                      retainedAnswerNotice={
                        latestAnswer
                          ? 'The latest answer below keeps the pair and revision it was asked with. Changing the selection does not relabel it.'
                          : null
                      }
                    />

                    {activeQuestionJob ? (
                      <JobProgress
                        phase={phase}
                        graph={graph}
                        job={activeQuestionJob}
                        originNotice={null}
                        onCancel={cancelActiveJob}
                      />
                    ) : null}

                    {latestAnswer ? (
                      <AnswerPanel
                        record={latestAnswer}
                        nodeById={nodeById}
                        candidateById={latestCandidates}
                        onOpenCitation={(citationId) => {
                          if (latestAnswer.answer) {
                            openCitation(latestAnswer.answer, citationId)
                          }
                        }}
                        onToggleCandidate={(candidateId) => {
                          if (latestAnswer.answer) {
                            toggleCandidate(
                              latestAnswer.answer.answer_id,
                              candidateId,
                            )
                          }
                        }}
                        selectedCandidateIds={
                          new Set(
                            latestAnswer.answer
                              ? candidateSelections[
                                  latestAnswer.answer.answer_id
                                ] ?? []
                              : [],
                          )
                        }
                        onAddDiscoveries={() => {
                          void addDiscoveries(latestAnswer)
                        }}
                        adding={busyAdd || addSubmitting}
                        addError={addError}
                        currentGraphRevision={graph.graph_revision}
                        validationError={latestAnswer.validationErrors}
                      />
                    ) : null}

                    {previousAnswers.length > 0 ? (
                      <details className="previous-answers">
                        <summary>
                          Earlier answers ({previousAnswers.length})
                        </summary>
                        {previousAnswers.map((record) => {
                          const candidates = new Map<string, AdditionalCandidate>()
                          for (const candidate of
                            record.answer?.additional_candidates ?? []) {
                            candidates.set(candidate.candidate_id, candidate)
                          }
                          return (
                            <AnswerPanel
                              key={record.localId}
                              record={record}
                              nodeById={nodeById}
                              candidateById={candidates}
                              onOpenCitation={(citationId) => {
                                if (record.answer) {
                                  openCitation(record.answer, citationId)
                                }
                              }}
                              onToggleCandidate={(candidateId) => {
                                if (record.answer) {
                                  toggleCandidate(
                                    record.answer.answer_id,
                                    candidateId,
                                  )
                                }
                              }}
                              selectedCandidateIds={
                                new Set(
                                  record.answer
                                    ? candidateSelections[
                                        record.answer.answer_id
                                      ] ?? []
                                    : [],
                                )
                              }
                              onAddDiscoveries={() => {
                                void addDiscoveries(record)
                              }}
                              adding={busyAdd || addSubmitting}
                              addError={addError}
                              currentGraphRevision={graph.graph_revision}
                              validationError={record.validationErrors}
                            />
                          )
                        })}
                      </details>
                    ) : null}
                  </aside>
                </div>

                <PairSelectionTray
                  a={aNode}
                  b={bNode}
                  pendingNode={pendingNode}
                  onClear={clearPair}
                  onClearSlot={clearSlot}
                  onSwap={swapPair}
                  onReplace={replaceSlot}
                  onCancelPending={() => setPendingNodeId(null)}
                />
              </>
            )}
          </section>
        ) : null}
      </main>

      <footer className="shell">
        <span>
          Traceback<span className="brand-period">.</span>
        </span>
        <a href="#top">
          Back to search <ArrowDown size={14} className="rotate-180" />
        </a>
      </footer>

      <CitationDrawer
        open={citationView !== null}
        answer={citationView?.answer ?? null}
        activeCitationId={citationView?.activeCitationId ?? null}
        nodeById={nodeById}
        candidateById={citationCandidates}
        onClose={() => setCitationView(null)}
      />

      {graphPhase === 'loading' && !graph ? (
        <div className="loading-veil" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={18} /> Loading the research
          graph…
        </div>
      ) : null}

      {graphPhase === 'error' && graph ? (
        <div className="state-toast" role="alert">
          <CircleAlert size={15} /> The latest graph refresh failed. The loaded
          tree was kept. <button type="button" onClick={retryGraph}><RefreshCw size={13} /> Retry</button>
        </div>
      ) : null}
    </>
  )
}
