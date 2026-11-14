import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphResult, SourceNode } from "./generated/newsTraceContracts";
import { createGatewayClient } from "./api/gateway";
import type { RuntimeConfig } from "./config";
import { buildChronologicalLayout } from "./domain/layout";
import {
  malformedGraphError,
  malformedNodeDetailsError,
  toUiError,
  type UiError,
} from "./domain/errors";
import {
  validateGraphResult,
  validateNodeDetails,
} from "./domain/validation";
import { ResearchHeader } from "./components/ResearchHeader";
import { JobProgress } from "./components/JobProgress";
import { SourceList } from "./components/SourceList";
import { TreeExplorer } from "./components/TreeExplorer";
import {
  NodeDetails,
  type DetailState,
} from "./components/NodeDetails";
import { PairSelectionTray } from "./components/PairSelectionTray";
import { NodeQuestionPanel } from "./components/NodeQuestionPanel";

type GraphState =
  | { status: "loading" }
  | { status: "error"; error: UiError }
  | { status: "ready"; graph: GraphResult };

type MobileTab = "tree" | "sources" | "ask";
type SelectionSlot = "a" | "b";

interface PairSelection {
  a: string | null;
  b: string | null;
}

function graphIsEmpty(graph: GraphResult): boolean {
  return (
    graph.nodes.length === 0 ||
    (graph.nodes.length === 1 &&
      graph.tree_edges.length === 0 &&
      graph.relationships.length === 0)
  );
}

function GraphErrorState({
  error,
  onRetry,
}: {
  error: UiError;
  onRetry: () => void;
}) {
  return (
    <section
      className="state-card state-error"
      data-testid="graph-error"
      role="alert"
    >
      <p className="eyebrow">Graph load</p>
      <h2>Research graph unavailable</h2>
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
      <button
        type="button"
        className="button button-primary"
        onClick={onRetry}
      >
        Retry graph load
      </button>
      <p className="limitation-note">
        No fallback graph or fabricated source data is displayed.
      </p>
    </section>
  );
}

function EmptyGraphState({ seedNode }: { seedNode: SourceNode | null }) {
  return (
    <section className="state-card state-empty" role="status">
      <p className="eyebrow">No related sources</p>
      <h2>The fixture graph contains no related sources</h2>
      <p>
        The gateway returned{" "}
        {seedNode
          ? "only the submitted source"
          : "an empty source collection"}
        . This is an honest empty result; no live discovery was performed and
        no sources are being substituted.
      </p>
    </section>
  );
}

export function FixtureExplorer({ config }: { config: RuntimeConfig }) {
  const gateway = useMemo(
    () => createGatewayClient({ base: config.apiBase }),
    [config.apiBase],
  );

  const [graphState, setGraphState] = useState<GraphState>({
    status: "loading",
  });
  const [graphRetryKey, setGraphRetryKey] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({
    status: "idle",
  });
  const [detailRetryKey, setDetailRetryKey] = useState(0);
  const [selection, setSelection] = useState<PairSelection>({
    a: null,
    b: null,
  });
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("tree");

  useEffect(() => {
    const controller = new AbortController();
    setGraphState({ status: "loading" });

    gateway
      .getGraph(config.researchId, controller.signal)
      .then((raw) => {
        if (controller.signal.aborted) {
          return;
        }
        const validation = validateGraphResult(raw, config.researchId);
        if (!validation.ok) {
          setGraphState({
            status: "error",
            error: malformedGraphError(validation.errors),
          });
          return;
        }
        setGraphState({ status: "ready", graph: validation.value });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setGraphState({
          status: "error",
          error: toUiError(
            error,
            "The synthetic fixture graph could not be loaded.",
          ),
        });
      });

    return () => {
      controller.abort();
    };
  }, [config.researchId, gateway, graphRetryKey]);

  const graph = graphState.status === "ready" ? graphState.graph : null;

  const nodeById = useMemo(() => {
    const map = new Map<string, SourceNode>();
    for (const node of graph?.nodes ?? []) {
      map.set(node.id, node);
    }
    return map;
  }, [graph]);

  const layout = useMemo(
    () => (graph ? buildChronologicalLayout(graph) : null),
    [graph],
  );

  const seedNode = graph ? nodeById.get(graph.seed_node_id) ?? null : null;
  const rootNode =
    graph?.root_node_id ? nodeById.get(graph.root_node_id) ?? null : null;
  const selectedNode =
    selectedNodeId !== null
      ? nodeById.get(selectedNodeId) ?? null
      : null;

  const aNode = selection.a ? nodeById.get(selection.a) ?? null : null;
  const bNode = selection.b ? nodeById.get(selection.b) ?? null : null;
  const pendingNode = pendingNodeId
    ? nodeById.get(pendingNodeId) ?? null
    : null;

  useEffect(() => {
    if (!graph) {
      return;
    }

    const ids = new Set(graph.nodes.map((node) => node.id));
    setSelection((previous) => {
      const a = previous.a && ids.has(previous.a) ? previous.a : null;
      const b = previous.b && ids.has(previous.b) ? previous.b : null;
      return a === previous.a && b === previous.b ? previous : { a, b };
    });
    setPendingNodeId((previous) =>
      previous && ids.has(previous) ? previous : null,
    );
    setSelectedNodeId((previous) =>
      previous && ids.has(previous) ? previous : null,
    );
  }, [graph]);

  useEffect(() => {
    if (!graph || selectedNodeId === null) {
      setDetailState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setDetailState({ status: "loading", nodeId: selectedNodeId });

    gateway
      .getNodeDetails(
        graph.research_id,
        selectedNodeId,
        controller.signal,
      )
      .then((raw) => {
        if (controller.signal.aborted) {
          return;
        }
        const validation = validateNodeDetails(raw, {
          researchId: graph.research_id,
          nodeId: selectedNodeId,
          knownNodeIds: new Set(nodeById.keys()),
        });
        if (!validation.ok) {
          setDetailState({
            status: "error",
            nodeId: selectedNodeId,
            error: malformedNodeDetailsError(validation.errors),
          });
          return;
        }
        setDetailState({
          status: "ready",
          nodeId: selectedNodeId,
          details: validation.value,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDetailState({
          status: "error",
          nodeId: selectedNodeId,
          error: toUiError(
            error,
            "The node details could not be loaded.",
          ),
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    detailRetryKey,
    gateway,
    graph,
    nodeById,
    selectedNodeId,
  ]);

  const inspectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setMobileTab("ask");
  }, []);

  const requestSelection = useCallback(
    (nodeId: string) => {
      if (nodeId === selection.a || nodeId === selection.b) {
        return;
      }
      if (selection.a === null) {
        setSelection({ a: nodeId, b: selection.b });
        setPendingNodeId(null);
        return;
      }
      if (selection.b === null) {
        setSelection({ a: selection.a, b: nodeId });
        setPendingNodeId(null);
        return;
      }
      setPendingNodeId(nodeId);
    },
    [selection],
  );

  const clearPair = useCallback(() => {
    setSelection({ a: null, b: null });
    setPendingNodeId(null);
  }, []);

  const clearSlot = useCallback((slot: SelectionSlot) => {
    setSelection((previous) =>
      slot === "a"
        ? { a: null, b: previous.b }
        : { a: previous.a, b: null },
    );
    setPendingNodeId(null);
  }, []);

  const swapPair = useCallback(() => {
    setSelection((previous) =>
      previous.a && previous.b
        ? { a: previous.b, b: previous.a }
        : previous,
    );
    setPendingNodeId(null);
  }, []);

  const replaceSlot = useCallback(
    (slot: SelectionSlot) => {
      if (!pendingNodeId) {
        return;
      }
      const replacement = pendingNodeId;
      setSelection((previous) =>
        slot === "a"
          ? { a: replacement, b: previous.b === replacement ? null : previous.b }
          : { a: previous.a === replacement ? null : previous.a, b: replacement },
      );
      setPendingNodeId(null);
    },
    [pendingNodeId],
  );

  const retryGraph = () => {
    setGraphRetryKey((key) => key + 1);
  };

  const retryDetails = () => {
    setDetailRetryKey((key) => key + 1);
  };

  const phase = graphState.status;
  const isEmpty = graph !== null && graphIsEmpty(graph);

  return (
    <div className="app-shell">
      <ResearchHeader
        researchId={config.researchId}
        phase={phase}
        graph={graph}
        seedNode={seedNode}
        rootNode={rootNode}
      />

      <JobProgress phase={phase} graph={graph} />

      <main className="workspace-main">
        {graphState.status === "error" ? (
          <GraphErrorState error={graphState.error} onRetry={retryGraph} />
        ) : null}

        {graphState.status === "loading" && !graph ? (
          <div className="loading-placeholder" aria-hidden="true">
            <div className="skeleton-block skeleton-tall" />
            <div className="skeleton-block skeleton-medium" />
            <div className="skeleton-block skeleton-tall" />
          </div>
        ) : null}

        {isEmpty && graph ? <EmptyGraphState seedNode={seedNode} /> : null}

        {graph && layout && !isEmpty ? (
          <>
            <div className="mobile-tabs" role="tablist" aria-label="Workspace views">
              {(
                [
                  ["tree", "Tree"],
                  ["sources", "Sources"],
                  ["ask", "Ask"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === tab}
                  aria-controls={`panel-${tab}`}
                  className={`mobile-tab${mobileTab === tab ? " mobile-tab-active" : ""}`}
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
                data-mobile-active={mobileTab === "sources"}
                aria-label="Sources panel"
              >
                <SourceList
                  nodes={graph.nodes}
                  rootNodeId={graph.root_node_id}
                  seedNodeId={graph.seed_node_id}
                  unplacedNodeIds={graph.undated_node_ids ?? []}
                  selectedNodeId={selectedNodeId}
                  selectedA={selection.a}
                  selectedB={selection.b}
                  onInspect={inspectNode}
                  onSelect={requestSelection}
                />
              </aside>

              <div
                id="panel-tree"
                className="workspace-panel panel-tree"
                data-mobile-active={mobileTab === "tree"}
                aria-label="Tree panel"
              >
                <TreeExplorer
                  graph={graph}
                  layout={layout}
                  nodeById={nodeById}
                  rootNodeId={graph.root_node_id}
                  seedNodeId={graph.seed_node_id}
                  selectedNodeId={selectedNodeId}
                  selectedA={selection.a}
                  selectedB={selection.b}
                  onInspect={inspectNode}
                  onSelect={requestSelection}
                />
              </div>

              <aside
                id="panel-ask"
                className="workspace-panel panel-ask"
                data-mobile-active={mobileTab === "ask"}
                aria-label="Details and question panel"
              >
                <NodeDetails
                  state={detailState}
                  graphNode={selectedNode}
                  graph={graph}
                  nodeById={nodeById}
                  onRetry={retryDetails}
                />
                <NodeQuestionPanel a={aNode} b={bNode} />
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
        ) : null}
      </main>
    </div>
  );
}
