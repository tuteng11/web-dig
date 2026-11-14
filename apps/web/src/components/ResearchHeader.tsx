import type {
  GraphResult,
  SourceNode,
} from "../generated/newsTraceContracts";
import { NEW_RESEARCH_LIMITATION } from "../config";
import { displayNodeTitle, sourceIdentity } from "../domain/nodes";
import { SyntheticBadge } from "./SyntheticBadge";

interface ResearchHeaderProps {
  researchId: string;
  phase: "loading" | "ready" | "error";
  graph: GraphResult | null;
  seedNode: SourceNode | null;
  rootNode: SourceNode | null;
}

function NodeIdentity({
  label,
  node,
  loading,
  badge,
  badgeTestId,
}: {
  label: string;
  node: SourceNode | null;
  loading: boolean;
  badge: string;
  badgeTestId?: string;
}) {
  const title = node ? displayNodeTitle(node) : null;

  return (
    <div className="header-fact">
      <dt>{label}</dt>
      <dd>
        {node ? (
          <span className="badge badge-neutral" data-testid={badgeTestId}>
            {badge}
          </span>
        ) : null}
        {node && title ? (
          <>
            <span
              className={`header-node-title${title.isUrlFallback ? " url-fallback" : ""}`}
            >
              {title.isUrlFallback ? "URL: " : ""}
              {title.text}
            </span>
            <span className="header-node-meta">{sourceIdentity(node)}</span>
          </>
        ) : loading ? (
          <span className="header-node-meta">Waiting for fixture graph…</span>
        ) : (
          <span className="header-node-meta">Not available</span>
        )}
      </dd>
    </div>
  );
}

export function ResearchHeader({
  researchId,
  phase,
  graph,
  seedNode,
  rootNode,
}: ResearchHeaderProps) {
  return (
    <header className="research-header" data-testid="research-header">
      <div className="brand-block">
        <div className="brand-line">
          <p className="eyebrow">News Trace</p>
          <SyntheticBadge />
        </div>
        <h1>Chronological source explorer</h1>
        <p className="fixture-scenario">
          Fixture scenario / research id: <code>{researchId}</code>
        </p>
      </div>

      <dl className="header-facts">
        <div className="header-fact">
          <dt>Graph revision</dt>
          <dd>
            {graph ? (
              <span className="header-revision">{graph.graph_revision}</span>
            ) : (
              <span className="header-node-meta">
                {phase === "loading" ? "Loading…" : "Not available"}
              </span>
            )}
          </dd>
        </div>

        <NodeIdentity
          label="Submitted source"
          node={seedNode}
          loading={phase === "loading"}
          badge="Submitted source"
          badgeTestId="seed-badge"
        />

        <NodeIdentity
          label="Earliest evidence found"
          node={rootNode}
          loading={phase === "loading"}
          badge={
            graph?.origin_assessment.status === "provisional"
              ? "Provisional earliest evidence"
              : graph?.origin_assessment.status === "unresolved"
                ? "Origin unresolved"
                : "Earliest evidence found"
          }
          badgeTestId={rootNode ? "root-badge" : undefined}
        />
      </dl>

      <div className="header-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled
          aria-describedby="new-research-limitation"
          title={NEW_RESEARCH_LIMITATION}
        >
          New research
        </button>
        <p id="new-research-limitation" className="limitation-note">
          {NEW_RESEARCH_LIMITATION}
        </p>
      </div>
    </header>
  );
}
