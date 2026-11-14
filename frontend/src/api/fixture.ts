import fixtureBundleJson from "../fixtures/riverbend.json";
import type {
  GraphResult,
  NodeDetails,
  Publication,
  SourceNode,
} from "../contracts/newsTrace";
import type {
  AdditionalCandidate,
  AddDiscoveriesInput,
  AnswerCitation,
  AnswerResult,
  AnswerStatement,
  AskQuestionInput,
  ExpandNodeInput,
  GraphMutationResult,
  JobEnvelope,
  JobEvent,
  JobKind,
  StartResearchInput,
} from "../contracts/http";
import { isTerminalJob } from "../contracts/http";
import { readRuntimeConfig } from "../config";
import { formatPublication, readPublicationInstant } from "../domain/format";
import { displayNodeTitle, sourceName } from "../domain/nodes";
import { GatewayError, type NewsTraceClient } from "./gateway";

interface FixtureBundle {
  research_id: string;
  label: string;
  initial: GraphResult;
  expanded: GraphResult;
  node_details: Record<string, NodeDetails>;
  expanded_node_details: Record<string, NodeDetails>;
}

type FixtureStage = "initial" | "expanded";

export interface FixtureClientOptions {
  /**
   * Optional research ID for the synthetic session. The default is the
   * research_id stored in the fixture bundle. The returned synthetic session
   * is relabelled consistently when an override is supplied.
   */
  researchId?: string;
  /** Small simulated latency in milliseconds. Defaults to 30ms. */
  latencyMs?: number;
}

const BUNDLE = fixtureBundleJson as unknown as FixtureBundle;
const DEFAULT_LATENCY_MS = 30;

const QUESTION_EVENT_STEPS: ReadonlyArray<{
  stage: string;
  message: string;
}> = [
  { stage: "reading", message: "Reading selected sources" },
  {
    stage: "relationships",
    message: "Checking relationship evidence",
  },
  {
    stage: "search",
    message: "Searching for the original announcement",
  },
  { stage: "citations", message: "Checking citations" },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function simulateLatency(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function notFound(message: string): GatewayError {
  return new GatewayError("NOT_FOUND", message, {
    retryable: false,
    status: 404,
  });
}

function invalidRequest(message: string): GatewayError {
  return new GatewayError("INVALID_REQUEST", message, {
    retryable: false,
    status: 422,
  });
}

function versionConflict(
  expected: number,
  actual: number,
): GatewayError {
  return new GatewayError(
    "VERSION_CONFLICT",
    `The request targeted graph revision ${expected}, but the current graph revision is ${actual}. Refresh the graph and try again.`,
    { retryable: true, status: 409 },
  );
}

function staleAnswerConflict(
  requestedRevision: number,
  answerRevision: number,
): GatewayError {
  return new GatewayError(
    "VERSION_CONFLICT",
    `The request targets graph revision ${requestedRevision}, but this answer is pinned to revision ${answerRevision}. Ask the question again against the current graph before adding discoveries.`,
    { retryable: false, status: 409 },
  );
}

function publicationDateKey(publication: Publication): string | null {
  if (
    publication.precision === "date" &&
    typeof publication.date === "string"
  ) {
    return publication.date;
  }
  if (
    publication.precision === "timestamp" &&
    typeof publication.timestamp === "string"
  ) {
    return publication.timestamp.slice(0, 10);
  }
  return null;
}

function publicationEvidenceId(node: SourceNode): string | null {
  const evidenceId = node.publication.evidence_id;
  return typeof evidenceId === "string" && evidenceId.length > 0
    ? evidenceId
    : null;
}

function citationFromEvidence(
  node: SourceNode,
  details: NodeDetails | null,
  evidenceId: string,
  citationId: string,
): AnswerCitation | null {
  const evidence = details?.evidence?.find(
    (item) => item.id === evidenceId && item.node_id === node.id,
  );
  if (!evidence) {
    return null;
  }
  return {
    id: citationId,
    node_id: node.id,
    snapshot_id: evidence.snapshot_id,
    evidence_id: evidence.id,
    quote: evidence.quote ?? null,
    start: evidence.start ?? null,
    end: evidence.end ?? null,
    metadata_field: evidence.metadata_field ?? null,
    metadata_value: evidence.metadata_value ?? null,
  };
}

function publicationCitation(
  node: SourceNode,
  details: NodeDetails | null,
  citationId: string,
): AnswerCitation | null {
  const evidenceId = publicationEvidenceId(node);
  if (evidenceId === null) {
    return null;
  }
  return citationFromEvidence(node, details, evidenceId, citationId);
}

function publicationSentence(
  node: SourceNode,
  citationId: string,
): AnswerStatement {
  const title = displayNodeTitle(node).text;
  const display = formatPublication(node.publication);
  return {
    text: `The publication metadata for "${title}" from ${sourceName(node)} records ${display.compactText}.`,
    citation_ids: [citationId],
  };
}

function comparePublicationOrder(
  a: SourceNode,
  b: SourceNode,
): "before" | "after" | "same_instant" | null {
  const aInstant = readPublicationInstant(a.publication);
  const bInstant = readPublicationInstant(b.publication);
  if (aInstant !== null && bInstant !== null) {
    if (aInstant === bInstant) {
      return "same_instant";
    }
    return aInstant < bInstant ? "before" : "after";
  }

  const aDate = publicationDateKey(a.publication);
  const bDate = publicationDateKey(b.publication);
  if (aDate !== null && bDate !== null && aDate !== bDate) {
    return aDate < bDate ? "before" : "after";
  }
  return null;
}

function orderingSentence(
  a: SourceNode,
  b: SourceNode,
  citationIds: string[],
): AnswerStatement {
  const aTitle = displayNodeTitle(a).text;
  const bTitle = displayNodeTitle(b).text;
  const order = comparePublicationOrder(a, b);
  if (order === "same_instant") {
    return {
      text: `The fixture publication metadata gives "${aTitle}" and "${bTitle}" the same reported publication instant.`,
      citation_ids: citationIds,
    };
  }
  if (order === "before" || order === "after") {
    const earlier = order === "before" ? aTitle : bTitle;
    const later = order === "before" ? bTitle : aTitle;
    const aInstant = readPublicationInstant(a.publication);
    const bInstant = readPublicationInstant(b.publication);
    const basis =
      aInstant !== null && bInstant !== null
        ? "reported timestamps"
        : "reported calendar dates";
    return {
      text: `The fixture publication metadata places "${earlier}" before "${later}" by ${basis}.`,
      citation_ids: citationIds,
    };
  }
  return {
    text: `The fixture publication metadata does not establish a precise publication order between "${aTitle}" and "${bTitle}".`,
    citation_ids: citationIds,
  };
}

function baseLimitations(): string[] {
  return [
    "Synthetic fixture answer: no model, MCP server, or live source fetch was executed.",
    "Only metadata and evidence stored in the local synthetic fixture were used.",
    "This answer is a UI contract demonstration, not a live research result.",
  ];
}

export function createFixtureClient(
  options: FixtureClientOptions = {},
): NewsTraceClient {
  const configuredResearchId =
    readRuntimeConfig().fixtureResearchId || BUNDLE.research_id;
  const servedResearchId =
    typeof options.researchId === "string" &&
    options.researchId.trim().length > 0
      ? options.researchId.trim()
      : configuredResearchId;
  const latencyMs =
    typeof options.latencyMs === "number" &&
    Number.isFinite(options.latencyMs)
      ? Math.max(0, Math.min(5000, options.latencyMs))
      : DEFAULT_LATENCY_MS;

  let stage: FixtureStage = "initial";
  let jobSequence = 0;
  let answerSequence = 0;
  const jobs = new Map<string, JobEnvelope>();
  const answers = new Map<string, AnswerResult>();

  function currentGraphRaw(): GraphResult {
    return stage === "initial" ? BUNDLE.initial : BUNDLE.expanded;
  }

  function currentDetailsRaw(): Record<string, NodeDetails> {
    return stage === "initial"
      ? BUNDLE.node_details
      : BUNDLE.expanded_node_details;
  }

  function currentRevision(): number {
    return currentGraphRaw().graph_revision;
  }

  function requireResearch(researchId: string): void {
    if (researchId !== servedResearchId) {
      throw notFound("No synthetic research session matches that id.");
    }
  }

  function nodeInCurrentGraph(nodeId: string): SourceNode | null {
    return (
      currentGraphRaw().nodes.find((node) => node.id === nodeId) ?? null
    );
  }

  function detailsFor(nodeId: string): NodeDetails | null {
    return currentDetailsRaw()[nodeId] ?? null;
  }

  function serveGraph(): GraphResult {
    const graph = clone(currentGraphRaw());
    graph.research_id = servedResearchId;
    for (const node of graph.nodes) {
      node.research_id = servedResearchId;
    }
    return graph;
  }

  function serveNodeDetails(details: NodeDetails): NodeDetails {
    const served = clone(details);
    served.research_id = servedResearchId;
    served.node.research_id = servedResearchId;
    return served;
  }

  function requireCurrentNode(nodeId: string): SourceNode {
    const node = nodeInCurrentGraph(nodeId);
    if (node === null) {
      throw notFound(
        `Node ${nodeId} is not part of the current synthetic graph revision.`,
      );
    }
    return node;
  }

  function nextJobId(kind: JobKind): string {
    jobSequence += 1;
    return `fixture-job-${kind}-${jobSequence}`;
  }

  function recordCompletedJob(
    kind: JobKind,
    requestId: string,
    jobStage: string,
    steps: ReadonlyArray<{ stage: string; message: string }>,
    result: unknown,
  ): JobEnvelope {
    const timestamp = nowIso();
    const events: JobEvent[] = steps.map((step, index) => ({
      seq: index + 1,
      at: timestamp,
      stage: step.stage,
      message: step.message,
    }));
    const job: JobEnvelope = {
      schema_version: 1,
      job_id: nextJobId(kind),
      research_id: servedResearchId,
      request_id: requestId,
      kind,
      status: "completed",
      stage: jobStage,
      created_at: timestamp,
      updated_at: timestamp,
      cancel_requested: false,
      result: clone(result),
      error: null,
      events,
      next_event_seq: events.length + 1,
    };
    jobs.set(job.job_id, job);
    return clone(job);
  }

  function currentSelectedPins(
    nodeIds: [string, string],
  ): Array<{ node_id: string; snapshot_id: string | null }> {
    return nodeIds.map((nodeId) => ({
      node_id: nodeId,
      snapshot_id: nodeInCurrentGraph(nodeId)?.snapshot_id ?? null,
    }));
  }

  function buildAdditionalAgendaCandidate(): AdditionalCandidate | null {
    const agenda =
      BUNDLE.expanded_node_details["n-agenda"]?.node ??
      BUNDLE.expanded.nodes.find((node) => node.id === "n-agenda") ??
      null;
    if (agenda === null) {
      return null;
    }
    return {
      candidate_id: agenda.id,
      url: agenda.canonical_url,
      title: agenda.title ?? null,
      source: { ...agenda.source },
      publication: { ...agenda.publication },
      content_status: agenda.content_status,
      snippet: agenda.excerpt ?? null,
      relationship_hypothesis: "links_to",
    };
  }

  function buildSpecialAnswer(
    input: AskQuestionInput,
    answerId: string,
  ): AnswerResult | null {
    if (
      input.node_ids[0] === input.node_ids[1] ||
      !input.node_ids.includes("n-seed") ||
      !input.node_ids.includes("n-grassroots")
    ) {
      return null;
    }

    const seed = nodeInCurrentGraph("n-seed");
    const grassroots = nodeInCurrentGraph("n-grassroots");
    if (seed === null || grassroots === null) {
      return null;
    }
    const seedDetails = detailsFor("n-seed");
    const grassrootsDetails = detailsFor("n-grassroots");

    const grassrootsCitation = publicationCitation(
      grassroots,
      grassrootsDetails,
      "cit-pub-n-grassroots",
    );
    const seedCitation = publicationCitation(
      seed,
      seedDetails,
      "cit-pub-n-seed",
    );
    const linkCitation = citationFromEvidence(
      seed,
      seedDetails,
      "ev-link-seed-grassroots",
      "cit-link-seed-grassroots",
    );
    if (
      grassrootsCitation === null ||
      seedCitation === null ||
      linkCitation === null
    ) {
      return null;
    }

    const seedTitle = displayNodeTitle(seed).text;
    const grassrootsTitle = displayNodeTitle(grassroots).text;
    const grassrootsDisplay = formatPublication(grassroots.publication);
    const seedDisplay = formatPublication(seed.publication);
    const linkQuote =
      typeof linkCitation.quote === "string"
        ? ` The captured link text is "${linkCitation.quote}".`
        : "";

    const statements: AnswerStatement[] = [
      {
        text: `${sourceName(grassroots)} published "${grassrootsTitle}" with publication metadata ${grassrootsDisplay.compactText}.`,
        citation_ids: [grassrootsCitation.id],
      },
      {
        text: `${sourceName(seed)} published "${seedTitle}" with publication metadata ${seedDisplay.compactText}.`,
        citation_ids: [seedCitation.id],
      },
      {
        text: `The synthetic fixture records a link from the ${sourceName(seed)} report "${seedTitle}" to the ${sourceName(grassroots)} post "${grassrootsTitle}".${linkQuote}`,
        citation_ids: [linkCitation.id],
      },
    ];

    const candidate = buildAdditionalAgendaCandidate();
    const limitations = baseLimitations();
    limitations.push(
      "The additional candidate is a reviewable synthetic fixture item; it is not inserted into the graph until Add to tree is used.",
    );

    return {
      answer_id: answerId,
      research_id: servedResearchId,
      selected_nodes: currentSelectedPins(input.node_ids),
      graph_revision: currentRevision(),
      question: input.question,
      outcome: "answered",
      statements,
      citations: [
        grassrootsCitation,
        seedCitation,
        linkCitation,
      ],
      limitations,
      additional_candidate_ids: candidate ? [candidate.candidate_id] : [],
      additional_candidates: candidate ? [candidate] : [],
      model_identity: null,
      completed_at: nowIso(),
    };
  }

  function buildInsufficientAnswer(
    input: AskQuestionInput,
    answerId: string,
    reason?: string,
  ): AnswerResult {
    return {
      answer_id: answerId,
      research_id: servedResearchId,
      selected_nodes: currentSelectedPins(input.node_ids),
      graph_revision: currentRevision(),
      question: input.question,
      outcome: "insufficient_evidence",
      statements: [],
      citations: [],
      limitations: [
        ...baseLimitations(),
        reason ??
          "The selected pair lacks usable publication metadata evidence in this fixture, so no publication order can be established.",
      ],
      additional_candidate_ids: [],
      additional_candidates: [],
      model_identity: null,
      completed_at: nowIso(),
    };
  }

  function buildGenericAnswer(
    input: AskQuestionInput,
    answerId: string,
  ): AnswerResult {
    const [aId, bId] = input.node_ids;
    const a = nodeInCurrentGraph(aId);
    const b = nodeInCurrentGraph(bId);
    if (a === null || b === null) {
      return buildInsufficientAnswer(input, answerId);
    }

    const aCitation = publicationCitation(
      a,
      detailsFor(aId),
      "cit-pub-a",
    );
    const bCitation = publicationCitation(
      b,
      detailsFor(bId),
      "cit-pub-b",
    );

    if (aCitation === null || bCitation === null) {
      return buildInsufficientAnswer(input, answerId);
    }

    const order = comparePublicationOrder(a, b);
    if (order === null) {
      return buildInsufficientAnswer(
        input,
        answerId,
        "No defensible publication order can be established from the available fixture metadata for the selected pair.",
      );
    }

    const statements: AnswerStatement[] = [
      publicationSentence(a, aCitation.id),
      publicationSentence(b, bCitation.id),
      orderingSentence(a, b, [aCitation.id, bCitation.id]),
    ];

    return {
      answer_id: answerId,
      research_id: servedResearchId,
      selected_nodes: currentSelectedPins(input.node_ids),
      graph_revision: currentRevision(),
      question: input.question,
      outcome: "answered",
      statements,
      citations: [aCitation, bCitation],
      limitations: baseLimitations(),
      additional_candidate_ids: [],
      additional_candidates: [],
      model_identity: null,
      completed_at: nowIso(),
    };
  }

  function originChangeWarning(): string {
    return (
      BUNDLE.expanded.warnings?.find((warning) =>
        warning.toLowerCase().startsWith("origin changed"),
      ) ??
      `Origin changed: earliest evidence is now ${
        BUNDLE.expanded.root_node_id ?? "unknown"
      } (previous root ${
        BUNDLE.initial.root_node_id ?? "unknown"
      }). Node identities are preserved; review this revision before relying on earlier answers.`
    );
  }

  function expandedOnlyNodeIds(): string[] {
    const initialIds = new Set(
      BUNDLE.initial.nodes.map((node) => node.id),
    );
    return BUNDLE.expanded.nodes
      .filter((node) => !initialIds.has(node.id))
      .map((node) => node.id);
  }

  return {
    async startResearch(
      _input: StartResearchInput,
      signal?: AbortSignal,
    ): Promise<JobEnvelope> {
      await simulateLatency(latencyMs, signal);
      if (signal?.aborted) {
        throw abortError();
      }
      throw new GatewayError(
        "PROVIDER_NOT_CONFIGURED",
        "Live discovery is not available in synthetic fixture mode. Configure a live gateway before submitting a source URL.",
        { retryable: false, status: 503 },
      );
    },

    async getJob(
      jobId: string,
      afterEventSeq?: number,
      signal?: AbortSignal,
    ): Promise<JobEnvelope> {
      await simulateLatency(latencyMs, signal);
      const job = jobs.get(jobId);
      if (!job) {
        throw notFound("No synthetic job matches that id.");
      }
      const served = clone(job);
      if (
        typeof afterEventSeq === "number" &&
        Number.isInteger(afterEventSeq) &&
        afterEventSeq >= 0
      ) {
        served.events = served.events.filter(
          (event) => event.seq > afterEventSeq,
        );
      }
      return served;
    },

    async cancelJob(
      jobId: string,
      signal?: AbortSignal,
    ): Promise<JobEnvelope> {
      await simulateLatency(latencyMs, signal);
      const job = jobs.get(jobId);
      if (!job) {
        throw notFound("No synthetic job matches that id.");
      }
      if (!isTerminalJob(job)) {
        const timestamp = nowIso();
        job.status = "cancelled";
        job.stage = "cancelled";
        job.cancel_requested = true;
        job.updated_at = timestamp;
        const seq = job.next_event_seq;
        job.events.push({
          seq,
          at: timestamp,
          stage: "cancelled",
          message: "Cancellation confirmed",
        });
        job.next_event_seq = seq + 1;
      }
      return clone(job);
    },

    async getGraph(
      researchId: string,
      signal?: AbortSignal,
    ): Promise<GraphResult> {
      requireResearch(researchId);
      await simulateLatency(latencyMs, signal);
      return serveGraph();
    },

    async getNodeDetails(
      researchId: string,
      nodeId: string,
      signal?: AbortSignal,
    ): Promise<NodeDetails> {
      requireResearch(researchId);
      await simulateLatency(latencyMs, signal);
      const details = detailsFor(nodeId);
      if (details === null) {
        throw notFound(
          `Node ${nodeId} has no details in the current synthetic graph revision.`,
        );
      }
      return serveNodeDetails(details);
    },

    async expandNode(
      researchId: string,
      input: ExpandNodeInput,
      signal?: AbortSignal,
    ): Promise<JobEnvelope> {
      requireResearch(researchId);
      await simulateLatency(latencyMs, signal);
      const revision = currentRevision();
      if (input.graph_revision !== revision) {
        throw versionConflict(input.graph_revision, revision);
      }
      requireCurrentNode(input.node_id);

      let added: string[] = [];
      let warnings: string[] = [];
      if (stage === "initial") {
        stage = "expanded";
        added = expandedOnlyNodeIds();
        warnings = [originChangeWarning()];
      }

      const result: GraphMutationResult = {
        graph_revision: currentRevision(),
        added_node_ids: added,
        warnings,
      };

      return recordCompletedJob(
        "expansion",
        input.request_id,
        "expanded",
        [
          {
            stage: "fixture",
            message: "Loading the synthetic expanded graph revision",
          },
          {
            stage: "projection",
            message: "Applying the expanded fixture tree projection",
          },
        ],
        result,
      );
    },

    async askQuestion(
      researchId: string,
      input: AskQuestionInput,
      signal?: AbortSignal,
    ): Promise<JobEnvelope> {
      requireResearch(researchId);
      await simulateLatency(latencyMs, signal);
      const revision = currentRevision();
      if (input.graph_revision !== revision) {
        throw versionConflict(input.graph_revision, revision);
      }
      if (input.node_ids[0] === input.node_ids[1]) {
        throw invalidRequest(
          "A question requires two distinct selected nodes.",
        );
      }
      requireCurrentNode(input.node_ids[0]);
      requireCurrentNode(input.node_ids[1]);
      if (input.question.trim().length === 0) {
        throw invalidRequest("The question must not be empty.");
      }
      if ([...input.question].length > 2000) {
        throw invalidRequest(
          "The question must be at most 2000 code points.",
        );
      }

      answerSequence += 1;
      const answerId = `fixture-answer-${answerSequence}`;
      const answer =
        buildSpecialAnswer(input, answerId) ??
        buildGenericAnswer(input, answerId);
      // Persist before returning the completed job so an immediately
      // following addDiscoveries call can resolve the answer id.
      answers.set(answer.answer_id, clone(answer));

      return recordCompletedJob(
        "question",
        input.request_id,
        "answered",
        QUESTION_EVENT_STEPS,
        answer,
      );
    },

    async addDiscoveries(
      researchId: string,
      input: AddDiscoveriesInput,
      signal?: AbortSignal,
    ): Promise<JobEnvelope> {
      requireResearch(researchId);
      await simulateLatency(latencyMs, signal);
      const revision = currentRevision();
      if (input.graph_revision !== revision) {
        throw versionConflict(input.graph_revision, revision);
      }
      if (input.candidate_ids.length === 0) {
        throw invalidRequest(
          "At least one additional candidate must be selected.",
        );
      }

      const answer = answers.get(input.answer_id);
      if (!answer) {
        throw notFound("No synthetic answer matches that id.");
      }
      if (answer.graph_revision !== input.graph_revision) {
        throw staleAnswerConflict(
          input.graph_revision,
          answer.graph_revision,
        );
      }
      const knownCandidateIds = new Set(
        answer.additional_candidate_ids,
      );
      for (const candidateId of input.candidate_ids) {
        if (!knownCandidateIds.has(candidateId)) {
          throw invalidRequest(
            `Candidate ${candidateId} is not an additional discovery of this answer.`,
          );
        }
        if (
          !BUNDLE.expanded.nodes.some((node) => node.id === candidateId)
        ) {
          throw invalidRequest(
            `Candidate ${candidateId} is not available in the synthetic fixture.`,
          );
        }
      }

      const currentNodeIds = new Set(
        currentGraphRaw().nodes.map((node) => node.id),
      );
      const added = input.candidate_ids.filter(
        (candidateId) => !currentNodeIds.has(candidateId),
      );

      let warnings: string[] = [];
      if (added.length > 0 && stage === "initial") {
        stage = "expanded";
        warnings = [originChangeWarning()];
      }

      const result: GraphMutationResult = {
        graph_revision: currentRevision(),
        added_node_ids: added,
        warnings,
      };

      return recordCompletedJob(
        "add_discoveries",
        input.request_id,
        "discoveries_added",
        [
          {
            stage: "fixture",
            message: "Loading the synthetic fixture candidate",
          },
          {
            stage: "projection",
            message: "Adding the selected synthetic candidate to the tree",
          },
        ],
        result,
      );
    },
  };
}
