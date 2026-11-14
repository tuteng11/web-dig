import { useMemo } from "react";
import type {
  Evidence,
  GraphResult,
  NodeDetails as NodeDetailsPayload,
  Relationship,
  SourceNode,
} from "../generated/newsTraceContracts";
import type { UiError } from "../domain/errors";
import {
  formatPublication,
  formatRetrievedAt,
  readPublicationInstant,
} from "../domain/format";
import {
  contentKindLabel,
  contentStatusLabel,
  displayNodeTitle,
  isSafeExternalUrl,
  relationshipKindLabel,
  relationshipMethodLabel,
  relationshipStatusLabel,
  sourceIdentity,
  sourceName,
} from "../domain/nodes";

export type DetailState =
  | { status: "idle" }
  | { status: "loading"; nodeId: string }
  | { status: "error"; nodeId: string; error: UiError }
  | { status: "ready"; nodeId: string; details: NodeDetailsPayload };

interface NodeDetailsProps {
  state: DetailState;
  graphNode: SourceNode | null;
  graph: GraphResult;
  nodeById: Map<string, SourceNode>;
  onRetry: () => void;
}

function safeNodeTitle(
  nodeById: Map<string, SourceNode>,
  nodeId: string,
): string {
  const node = nodeById.get(nodeId);
  if (!node) {
    return nodeId;
  }
  const title = displayNodeTitle(node);
  return title.isUrlFallback ? `URL: ${title.text}` : title.text;
}

function evidenceKindLabel(kind: Evidence["kind"]): string {
  switch (kind) {
    case "text_quote":
      return "Text quote";
    case "link":
      return "Link";
    case "metadata":
      return "Metadata";
    case "snippet":
      return "Search snippet";
    case "search_result":
      return "Search result";
  }
}

function SafeExternalLink({
  url,
  label,
}: {
  url: string;
  label?: string;
}) {
  const text = label ?? url;
  if (!isSafeExternalUrl(url)) {
    return <span className="unsafe-url">{text}</span>;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer noopener">
      {text}
    </a>
  );
}

function ErrorDetails({ error }: { error: UiError }) {
  return (
    <>
      <p>{error.message}</p>
      <p className="error-meta">
        <span className="error-code">{error.code}</span>
        {error.retryable ? " · retryable" : " · not reported as retryable"}
        {error.requestId ? ` · request ${error.requestId}` : ""}
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
    </>
  );
}

function DetailSectionHeading({
  id,
  children,
}: {
  id: string;
  children: string;
}) {
  return (
    <h3 id={id} className="detail-section-heading">
      {children}
    </h3>
  );
}

function EvidenceItem({ item }: { item: Evidence }) {
  return (
    <li className="evidence-item">
      <div className="evidence-topline">
        <span className="kind-chip">{evidenceKindLabel(item.kind)}</span>
        <span className="evidence-snapshot">Snapshot {item.snapshot_id}</span>
      </div>
      {item.quote ? <blockquote>{item.quote}</blockquote> : null}
      {item.metadata_field ? (
        <p className="evidence-metadata">
          <span>{item.metadata_field}:</span> {item.metadata_value ?? "—"}
        </p>
      ) : null}
      {item.link_target ? (
        <p className="evidence-link">
          Link target:{" "}
          <SafeExternalLink url={item.link_target} />
        </p>
      ) : null}
      <p className="evidence-meta">
        Retrieved {formatRetrievedAt(item.retrieved_at)}
        {typeof item.start === "number" && typeof item.end === "number"
          ? ` · offsets ${item.start}–${item.end}`
          : ""}
      </p>
    </li>
  );
}

function RelationshipItem({
  relationship,
  nodeById,
  isCrossLink,
}: {
  relationship: Relationship;
  nodeById: Map<string, SourceNode>;
  isCrossLink: boolean;
}) {
  const fromTitle = safeNodeTitle(nodeById, relationship.from_node_id);
  const toTitle = safeNodeTitle(nodeById, relationship.to_node_id);

  return (
    <li className="relationship-item">
      <div className="badge-row">
        <span className="badge badge-neutral">
          {relationshipKindLabel(relationship.kind)}
        </span>
        <span className="badge badge-soft">
          {relationshipMethodLabel(relationship.method)}
        </span>
        <span
          className={`badge ${relationship.status === "validated" ? "badge-validated" : "badge-provisional"}`}
        >
          {relationshipStatusLabel(relationship.status)}
        </span>
        {isCrossLink ? (
          <span className="badge badge-cross-link">Cross-link</span>
        ) : null}
      </div>
      <p className="relationship-explanation">{relationship.explanation}</p>
      <p className="relationship-direction">
        <strong>Factual direction:</strong>{" "}
        {relationship.directed
          ? `${fromTitle} → ${toTitle}`
          : `undirected between ${fromTitle} and ${toTitle}`}
      </p>
      {relationship.evidence_ids && relationship.evidence_ids.length > 0 ? (
        <p className="evidence-meta">
          Evidence: {relationship.evidence_ids.join(", ")}
        </p>
      ) : (
        <p className="evidence-meta">No evidence ids supplied.</p>
      )}
    </li>
  );
}

export function NodeDetails({
  state,
  graphNode,
  graph,
  nodeById,
  onRetry,
}: NodeDetailsProps) {
  const currentNode =
    state.status === "ready" ? state.details.node : graphNode;
  const graphRelationships = useMemo(() => {
    if (!currentNode) {
      return [];
    }
    const merged = new Map<string, Relationship>();
    for (const relationship of graph.relationships) {
      if (
        relationship.from_node_id === currentNode.id ||
        relationship.to_node_id === currentNode.id
      ) {
        merged.set(relationship.id, relationship);
      }
    }
    if (state.status === "ready") {
      for (const relationship of state.details.relationships ?? []) {
        merged.set(relationship.id, relationship);
      }
    }
    return [...merged.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }, [currentNode, graph.relationships, state]);

  const crossLinkIds = useMemo(
    () => new Set(graph.cross_link_ids ?? []),
    [graph.cross_link_ids],
  );

  if (state.status === "idle") {
    return (
      <section
        className="detail-panel"
        data-testid="detail-panel"
        aria-labelledby="details-heading"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Details</p>
            <h2 id="details-heading">Node details</h2>
          </div>
        </div>
        <p className="detail-placeholder">
          Inspect a source from the tree or the source list to load its
          metadata, publication provenance, evidence, and relationship
          records.
        </p>
      </section>
    );
  }

  if (state.status === "loading") {
    const title = currentNode ? displayNodeTitle(currentNode) : null;
    return (
      <section
        className="detail-panel"
        data-testid="detail-panel"
        aria-labelledby="details-heading"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Details</p>
            <h2 id="details-heading">Node details</h2>
          </div>
        </div>
        <div className="detail-loading" role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <span>
            Loading details
            {title
              ? ` for ${title.isUrlFallback ? `URL ${title.text}` : title.text}`
              : ""}
            …
          </span>
        </div>
      </section>
    );
  }

  if (state.status === "error") {
    const title = currentNode ? displayNodeTitle(currentNode) : null;
    return (
      <section
        className="detail-panel"
        data-testid="detail-panel"
        aria-labelledby="details-heading"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Details</p>
            <h2 id="details-heading">Node details</h2>
          </div>
        </div>
        <div className="detail-error" role="alert">
          <h3>
            {title
              ? title.isUrlFallback
                ? `URL ${title.text}`
                : title.text
              : "Node details unavailable"}
          </h3>
          <ErrorDetails error={state.error} />
          <button
            type="button"
            className="button button-secondary"
            onClick={onRetry}
          >
            Retry node details
          </button>
          <p className="limitation-note">
            The loaded tree is unchanged.
          </p>
        </div>
      </section>
    );
  }

  const { details } = state;
  const node = details.node;
  const title = displayNodeTitle(node);
  const publication = formatPublication(node.publication);
  const uncertain = readPublicationInstant(node.publication) === null;
  const snapshot = details.snapshot;
  const snapshotId = snapshot?.id ?? node.snapshot_id ?? null;
  const evidence = details.evidence ?? [];

  return (
    <section
      className="detail-panel"
      data-testid="detail-panel"
      aria-labelledby="details-heading"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Details</p>
          <h2 id="details-heading">Node details</h2>
        </div>
        <span className="count-chip">{contentKindLabel(node.content_kind)}</span>
      </div>

      <article className="detail-content">
        <header className="detail-source-header">
          <div className="badge-row">
            {node.id === graph.root_node_id ? (
              <span className="badge badge-root">Earliest evidence found</span>
            ) : null}
            {node.id === graph.seed_node_id ? (
              <span className="badge badge-seed">Submitted source</span>
            ) : null}
            {uncertain ? (
              <span className="badge badge-uncertain">Time-uncertain</span>
            ) : null}
          </div>
          <h3 className={`detail-title${title.isUrlFallback ? " url-fallback" : ""}`}>
            {title.isUrlFallback ? <span className="fallback-label">URL</span> : null}
            {title.text}
          </h3>
          <p className="detail-source-line">
            {sourceIdentity(node)}
            {node.source.platform ? ` · ${node.source.platform}` : ""}
          </p>
          <p className="detail-status-line">
            {contentStatusLabel(node.content_status)} · {sourceName(node)}
          </p>
        </header>

        <section aria-labelledby="detail-source-heading">
          <DetailSectionHeading id="detail-source-heading">
            Source
          </DetailSectionHeading>
          <dl className="meta-grid">
            <dt>Content kind</dt>
            <dd>{contentKindLabel(node.content_kind)}</dd>
            <dt>Content status</dt>
            <dd>{contentStatusLabel(node.content_status)}</dd>
            <dt>Source name</dt>
            <dd>{sourceName(node)}</dd>
            <dt>Domain</dt>
            <dd>{node.source.domain}</dd>
            <dt>Platform</dt>
            <dd>{node.source.platform ?? "Not supplied"}</dd>
            <dt>Author</dt>
            <dd>{node.author ?? "Not supplied"}</dd>
            <dt>Canonical URL</dt>
            <dd>
              <SafeExternalLink url={node.canonical_url} />
            </dd>
            <dt>Original requested URL</dt>
            <dd>
              <SafeExternalLink url={node.requested_url} />
            </dd>
          </dl>
        </section>

        <section aria-labelledby="detail-excerpt-heading">
          <DetailSectionHeading id="detail-excerpt-heading">
            Excerpt
          </DetailSectionHeading>
          {node.excerpt ? (
            <blockquote className="excerpt-block">{node.excerpt}</blockquote>
          ) : snapshot?.excerpt ? (
            <blockquote className="excerpt-block">
              {snapshot.excerpt}
            </blockquote>
          ) : (
            <p className="muted">
              No excerpt was supplied. No source text has been invented.
            </p>
          )}
        </section>

        <section aria-labelledby="detail-publication-heading">
          <DetailSectionHeading id="detail-publication-heading">
            Publication
          </DetailSectionHeading>
          <dl className="meta-grid">
            <dt>Publication</dt>
            <dd>
              {publication.headline}
              {publication.timeNote ? ` — ${publication.timeNote}` : ""}
            </dd>
            <dt>Precision</dt>
            <dd>{publication.precisionLabel}</dd>
            <dt>Time zone status</dt>
            <dd>
              {node.publication.timezone_status === "known"
                ? publication.offsetLabel ?? "Reported as known"
                : "Not reported"}
            </dd>
            {publication.zoneNote ? (
              <>
                <dt>Zone note</dt>
                <dd>{publication.zoneNote}</dd>
              </>
            ) : null}
            {publication.localNote ? (
              <>
                <dt>Local display</dt>
                <dd>{publication.localNote}</dd>
              </>
            ) : null}
            <dt>Original raw text</dt>
            <dd>{publication.rawText ?? "Not supplied"}</dd>
          </dl>
        </section>

        <section aria-labelledby="detail-retrieval-heading">
          <DetailSectionHeading id="detail-retrieval-heading">
            Retrieval and snapshot
          </DetailSectionHeading>
          <dl className="meta-grid">
            <dt>Retrieved</dt>
            <dd>
              {formatRetrievedAt(node.retrieved_at)}
              <span className="field-note">
                {" "}
                — retrieval time, not publication time
              </span>
            </dd>
            <dt>Discovered</dt>
            <dd>{formatRetrievedAt(node.discovered_at)}</dd>
            {node.updated_at ? (
              <>
                <dt>Updated</dt>
                <dd>{formatRetrievedAt(node.updated_at)}</dd>
              </>
            ) : null}
            <dt>Snapshot id</dt>
            <dd>{snapshotId ?? "Not supplied"}</dd>
            {snapshot ? (
              <>
                <dt>Snapshot captured</dt>
                <dd>{formatRetrievedAt(snapshot.captured_at)}</dd>
                <dt>Snapshot content status</dt>
                <dd>{contentStatusLabel(snapshot.content_status)}</dd>
                <dt>Content hash</dt>
                <dd className="mono">{snapshot.content_hash}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section aria-labelledby="detail-evidence-heading">
          <DetailSectionHeading id="detail-evidence-heading">
            Evidence
          </DetailSectionHeading>
          {evidence.length === 0 ? (
            <p className="muted">No evidence records were supplied.</p>
          ) : (
            <ul className="evidence-list">
              {evidence.map((item) => (
                <EvidenceItem key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="detail-relationships-heading">
          <DetailSectionHeading id="detail-relationships-heading">
            Relationships and cross-links
          </DetailSectionHeading>
          {graphRelationships.length === 0 ? (
            <p className="muted">
              No relationship records were supplied for this source.
            </p>
          ) : (
            <ul className="relationship-list">
              {graphRelationships.map((relationship) => (
                <RelationshipItem
                  key={relationship.id}
                  relationship={relationship}
                  nodeById={nodeById}
                  isCrossLink={crossLinkIds.has(relationship.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {node.warnings && node.warnings.length > 0 ? (
          <section aria-labelledby="detail-warnings-heading">
            <DetailSectionHeading id="detail-warnings-heading">
              Source warnings
            </DetailSectionHeading>
            <ul>
              {node.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {details.coverage_notes && details.coverage_notes.length > 0 ? (
          <section aria-labelledby="detail-coverage-heading">
            <DetailSectionHeading id="detail-coverage-heading">
              Coverage notes
            </DetailSectionHeading>
            <ul>
              {details.coverage_notes.map((note, index) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {details.warnings && details.warnings.length > 0 ? (
          <section aria-labelledby="detail-detail-warnings-heading">
            <DetailSectionHeading id="detail-detail-warnings-heading">
              Detail warnings
            </DetailSectionHeading>
            <ul>
              {details.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </section>
  );
}
