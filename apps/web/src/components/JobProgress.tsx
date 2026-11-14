import type { GraphResult, OriginStatus } from "../generated/newsTraceContracts";
import { readPublicationInstant } from "../domain/format";

interface JobProgressProps {
  phase: "loading" | "ready" | "error";
  graph: GraphResult | null;
}

const ORIGIN_STATUS_LABEL: Record<OriginStatus, string> = {
  resolved_within_results: "resolved within these results",
  provisional: "provisional",
  unresolved: "unresolved",
};

export function JobProgress({ phase, graph }: JobProgressProps) {
  if (phase === "loading") {
    return (
      <div
        className="job-progress job-progress-loading"
        data-testid="graph-loading"
        role="status"
        aria-live="polite"
      >
        <span className="status-dot" aria-hidden="true" />
        <span>
          Loading the synthetic fixture graph through the gateway. No live
          discovery is running.
        </span>
      </div>
    );
  }

  if (phase === "error" || !graph) {
    return (
      <div className="job-progress job-progress-error" role="status">
        The fixture graph is not available. No synthetic data is being
        substituted.
      </div>
    );
  }

  const warningCount = graph.warnings?.length ?? 0;
  const origin = graph.origin_assessment;
  const uncertainOrigin = origin.status !== "resolved_within_results";
  const candidateNodes = (origin.earliest_candidate_ids ?? [])
    .map((nodeId) => graph.nodes.find((node) => node.id === nodeId))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);
  const unplacedIds = new Set(graph.undated_node_ids ?? []);
  const hasDatedAnchor = graph.nodes.some(
    (node) =>
      !unplacedIds.has(node.id) &&
      readPublicationInstant(node.publication) !== null,
  );

  return (
    <div className="job-progress job-progress-ready" role="status" aria-live="polite">
      <div className="job-progress-line">
        <span className="status-dot status-dot-ready" aria-hidden="true" />
        <span>
          Synthetic fixture graph loaded through the gateway · revision{" "}
          {graph.graph_revision} · {graph.nodes.length} source
          {graph.nodes.length === 1 ? "" : "s"} · no live discovery was
          performed.
        </span>
      </div>

      {uncertainOrigin ? (
        <div
          className="origin-banner"
          data-testid="origin-status"
          role="status"
        >
          <strong>
            {origin.status === "provisional"
              ? "Provisional origin"
              : "Origin unresolved"}
          </strong>
          <p>{origin.rationale}</p>
          {candidateNodes.length > 0 ? (
            <p className="muted">
              Earliest candidate{candidateNodes.length === 1 ? "" : "s"}:{" "}
              {candidateNodes
                .map((node) => node.title ?? node.canonical_url)
                .join(" · ")}
            </p>
          ) : null}
          {graph.root_node_id &&
          unplacedIds.has(graph.root_node_id) ? (
            <p className="muted">
              {hasDatedAnchor
                ? "The origin candidate is time-uncertain; the first dated node is a display anchor only."
                : "The origin candidate is time-uncertain and no dated node is available; it remains in the unplaced lane."}
            </p>
          ) : null}
        </div>
      ) : null}

      {graph.truncated ? (
        <p className="warning-line">
          This graph is truncated{graph.omitted_count != null ? ` by ${graph.omitted_count} source${graph.omitted_count === 1 ? "" : "s"}` : ""}.
        </p>
      ) : null}

      {warningCount > 0 ? (
        <details className="graph-warnings">
          <summary>
            Graph warnings ({warningCount})
          </summary>
          <ul>
            {graph.warnings?.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="origin-assessment">
        <summary>
          Origin assessment:{" "}
          {ORIGIN_STATUS_LABEL[graph.origin_assessment.status]}
        </summary>
        <p>{graph.origin_assessment.rationale}</p>
        {(graph.origin_assessment.coverage_notes?.length ?? 0) > 0 ? (
          <ul>
            {graph.origin_assessment.coverage_notes?.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No additional coverage notes were supplied.</p>
        )}
      </details>
    </div>
  );
}
