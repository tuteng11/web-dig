import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { QUESTION_DISABLED_EXPLANATION } from "./config";
import {
  buildNodeDetails,
  sampleGraph,
  seedOnlyGraph,
} from "./test/fixtures";
import {
  deferred,
  installFetch,
  jsonResponse,
  textResponse,
} from "./test/http";

function graphAndDetailsHandler(
  getGraph: () => ReturnType<typeof sampleGraph>,
) {
  return (url: string) => {
    if (url.endsWith("/graph")) {
      return jsonResponse(getGraph());
    }
    const detailMatch = /\/nodes\/([^/?#]+)$/.exec(url);
    if (detailMatch) {
      const graph = getGraph();
      return jsonResponse(
        buildNodeDetails(graph, decodeURIComponent(detailMatch[1])),
      );
    }
    return textResponse("Unexpected test URL", 500);
  };
}

async function renderLoadedGraph() {
  const graph = sampleGraph();
  const fetchMock = installFetch(graphAndDetailsHandler(() => graph));
  render(<App />);
  await screen.findByTestId("tree-canvas");
  return { graph, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("VITE_FIXTURE_MODE", "true");
  vi.stubEnv("VITE_FIXTURE_RESEARCH_ID", "fixture-riverbend");
  vi.stubEnv("VITE_API_BASE", "/api/v1");
});

describe("fixture explorer success state", () => {
  it("loads the fixture graph, shows honest identity, and exposes smoke-test ids", async () => {
    const { fetchMock } = await renderLoadedGraph();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/research/fixture-riverbend/graph",
      expect.objectContaining({ method: "GET" }),
    );

    expect(screen.getByTestId("synthetic-badge")).toHaveTextContent(
      "Synthetic demo",
    );
    const header = screen.getByTestId("research-header");
    expect(header).toHaveTextContent("fixture-riverbend");
    expect(header).toHaveTextContent("Graph revision");
    expect(header).toHaveTextContent("7");
    expect(within(header).getByTestId("root-badge")).toHaveTextContent(
      "Earliest evidence found",
    );
    expect(within(header).getByTestId("seed-badge")).toHaveTextContent(
      "Submitted source",
    );
    expect(
      within(header).getByText(
        "Riverbend council approves waterfront plan",
      ),
    ).toBeInTheDocument();
    expect(
      within(header).getByText(
        "Waterfront plan draws praise and questions",
      ),
    ).toBeInTheDocument();

    expect(screen.getByTestId("source-list")).toBeInTheDocument();
    expect(screen.getByTestId("source-search")).toBeInTheDocument();
    expect(screen.getByTestId("src-item-node-root")).toHaveTextContent(
      "Earliest evidence found",
    );
    expect(screen.getByTestId("src-item-node-seed")).toHaveTextContent(
      "Submitted source",
    );
    expect(screen.getByTestId("inspect-node-root")).toBeInTheDocument();
    expect(screen.getByTestId("select-node-root")).toBeInTheDocument();

    expect(screen.getByTestId("tree-canvas")).toHaveAccessibleName(
      /Chronological tree/,
    );
    expect(screen.getByTestId("fit-view")).toBeInTheDocument();
    expect(screen.getByTestId("focus-root")).toBeInTheDocument();
    expect(screen.getByTestId("cross-link-toggle")).toBeInTheDocument();

    const uncertain = screen.getByTestId("time-uncertain-section");
    expect(uncertain).toHaveTextContent("Unplaced / time-uncertain sources");
    expect(uncertain).toHaveTextContent("Waterfront open house notice");
    expect(uncertain).toHaveTextContent("Archive note on the waterfront proposal");

    expect(screen.getByTestId("detail-panel")).toHaveTextContent(
      "Inspect a source",
    );
    expect(screen.getByTestId("selection-tray")).toBeInTheDocument();
    expect(screen.getByTestId("selection-slot-a")).toHaveTextContent(
      "Not selected",
    );
    expect(screen.getByTestId("selection-slot-b")).toHaveTextContent(
      "Not selected",
    );
    expect(screen.getByTestId("question-submit")).toBeDisabled();
    expect(screen.getByText(QUESTION_DISABLED_EXPLANATION)).toBeInTheDocument();
    expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("graph-error")).not.toBeInTheDocument();
  });

  it("shows an explicit loading state before the graph arrives", async () => {
    const pendingGraph = deferred<Response>();
    installFetch(() => pendingGraph.promise);
    render(<App />);

    expect(screen.getByTestId("graph-loading")).toHaveTextContent(
      /Loading the synthetic fixture graph/,
    );
    expect(screen.queryByTestId("tree-canvas")).not.toBeInTheDocument();
    expect(screen.getByTestId("synthetic-badge")).toBeInTheDocument();

    await act(async () => {
      pendingGraph.resolve(jsonResponse(sampleGraph()));
    });

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("graph-loading")).not.toBeInTheDocument();
  });

  it("shows an honest empty state when only the seed is returned", async () => {
    installFetch(() => jsonResponse(seedOnlyGraph()));
    render(<App />);

    expect(
      await screen.findByText(
        "The fixture graph contains no related sources",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/honest empty result/i)).toBeInTheDocument();
    expect(screen.queryByTestId("tree-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-tray")).not.toBeInTheDocument();
  });

  it("does not require fixture fallback when live mode is disabled", () => {
    vi.stubEnv("VITE_FIXTURE_MODE", "false");
    const fetchMock = installFetch(() => {
      throw new Error("Live mode must not fetch");
    });
    render(<App />);

    expect(
      screen.getByText(
        "Live research is not implemented in this milestone.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("synthetic-badge")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("graph loading failures", () => {
  it("shows a safe malformed-JSON error and allows retry", async () => {
    let graphRequests = 0;
    installFetch(() => {
      graphRequests += 1;
      return graphRequests === 1
        ? textResponse("{not valid json", 200)
        : jsonResponse(sampleGraph());
    });

    render(<App />);

    const errorCard = await screen.findByTestId("graph-error");
    expect(errorCard).toHaveTextContent(
      "The gateway returned a response that was not valid JSON.",
    );
    expect(screen.queryByTestId("tree-canvas")).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry graph load" }));

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("graph-error")).not.toBeInTheDocument();
  });

  it("shows a safe validation error for a structurally invalid graph", async () => {
    const graph = sampleGraph();
    const duplicate = structuredClone(graph.nodes[1]);
    duplicate.id = graph.nodes[0].id;
    installFetch(() =>
      jsonResponse({ ...graph, nodes: [...graph.nodes, duplicate] }),
    );

    render(<App />);

    const errorCard = await screen.findByTestId("graph-error");
    expect(errorCard).toHaveTextContent(
      "The gateway graph response failed runtime validation",
    );
    expect(errorCard).toHaveTextContent("node ids must be unique");
    expect(screen.queryByTestId("source-list")).not.toBeInTheDocument();
  });

  it("surfaces gateway error envelopes and retries explicitly", async () => {
    let graphRequests = 0;
    installFetch(() => {
      graphRequests += 1;
      if (graphRequests === 1) {
        return jsonResponse(
          {
            error: {
              code: "MCP_UNAVAILABLE",
              message: "The fixture MCP service is unavailable.",
              retryable: true,
            },
            request_id: "req-graph-1",
          },
          503,
        );
      }
      return jsonResponse(sampleGraph());
    });

    render(<App />);

    const errorCard = await screen.findByTestId("graph-error");
    expect(errorCard).toHaveTextContent(
      "The fixture MCP service is unavailable.",
    );
    expect(errorCard).toHaveTextContent("MCP_UNAVAILABLE");
    expect(errorCard).toHaveTextContent("req-graph-1");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry graph load" }));

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
  });
});

describe("node inspection", () => {
  it("fetches the detail route on inspect and renders provenance safely", async () => {
    const { fetchMock, graph } = await renderLoadedGraph();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("inspect-node-root"));

    const detail = screen.getByTestId("detail-panel");
    expect(
      await within(detail).findByText(
        "The council approved the waterfront plan 4–1.",
      ),
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/research/fixture-riverbend/nodes/node-root",
      expect.objectContaining({ method: "GET" }),
    );

    expect(within(detail).getByText("Maya Chen")).toBeInTheDocument();
    expect(within(detail).getByText("Original raw text")).toBeInTheDocument();
    expect(
      within(detail).getByText("June 2, 2021 at 9:00 a.m. ET"),
    ).toBeInTheDocument();
    expect(
      within(detail).getByText(/retrieval time, not publication time/),
    ).toBeInTheDocument();
    expect(detail).toHaveTextContent("Snapshot id");
    expect(detail).toHaveTextContent("snap-root");
    expect(within(detail).getByText("Precision")).toBeInTheDocument();
    expect(detail).toHaveTextContent("Timestamp");
    expect(detail).not.toHaveTextContent("Time unavailable");

    const canonicalLinks = within(detail).getAllByRole("link", {
      name: "https://riverbendledger.example/waterfront-plan",
    });
    expect(canonicalLinks).toHaveLength(2);
    for (const canonical of canonicalLinks) {
      expect(canonical).toHaveAttribute(
        "href",
        "https://riverbendledger.example/waterfront-plan",
      );
      expect(canonical).toHaveAttribute("target", "_blank");
      expect(canonical).toHaveAttribute("rel", "noreferrer noopener");
    }

    expect(
      within(detail).getByText("The post links to the council article."),
    ).toBeInTheDocument();
    expect(detail).toHaveTextContent(
      /Waterfront plan draws praise and questions → Riverbend council approves waterfront plan/,
    );

    expect(within(detail).getByText(/<script>alert/)).toBeInTheDocument();
    expect(detail.querySelector("script")).toBeNull();
    expect(buildNodeDetails(graph, "node-root").node.id).toBe("node-root");
  });

  it("ignores a stale detail response and keeps the latest inspection", async () => {
    const graph = sampleGraph();
    const rootResponse = deferred<Response>();
    const seedResponse = deferred<Response>();
    installFetch((url) => {
      if (url.endsWith("/graph")) {
        return jsonResponse(graph);
      }
      if (url.endsWith("/nodes/node-root")) {
        return rootResponse.promise;
      }
      if (url.endsWith("/nodes/node-seed")) {
        return seedResponse.promise;
      }
      return textResponse("Unexpected test URL", 500);
    });

    render(<App />);
    await screen.findByTestId("tree-canvas");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("inspect-node-root"));
    await user.click(screen.getByTestId("inspect-node-seed"));

    await act(async () => {
      rootResponse.resolve(jsonResponse(buildNodeDetails(graph, "node-root")));
      await Promise.resolve();
    });

    const detail = screen.getByTestId("detail-panel");
    expect(
      within(detail).queryByText(
        "The council approved the waterfront plan 4–1.",
      ),
    ).not.toBeInTheDocument();

    await act(async () => {
      seedResponse.resolve(jsonResponse(buildNodeDetails(graph, "node-seed")));
    });

    expect(
      await within(detail).findByText(
        /The submitted post links to the earlier council report/,
      ),
    ).toBeInTheDocument();
    expect(detail).toHaveTextContent("Waterfront plan draws praise and questions");
  });

  it("shows a detail error without losing the tree", async () => {
    const graph = sampleGraph();
    installFetch((url) => {
      if (url.endsWith("/graph")) {
        return jsonResponse(graph);
      }
      return jsonResponse(
        {
          error: {
            code: "MCP_UNAVAILABLE",
            message: "Node details are temporarily unavailable.",
            retryable: true,
          },
        },
        503,
      );
    });

    render(<App />);
    await screen.findByTestId("tree-canvas");

    await userEvent
      .setup()
      .click(screen.getByTestId("inspect-node-root"));

    const detail = screen.getByTestId("detail-panel");
    expect(
      await within(detail).findByRole("alert"),
    ).toHaveTextContent("Node details are temporarily unavailable.");
    expect(screen.getByTestId("tree-canvas")).toBeInTheDocument();
    expect(within(detail).getByText("The loaded tree is unchanged.")).toBeInTheDocument();
  });
});

describe("exactly-two-node selection", () => {
  it("fills A/B slots, swaps, and clears the pair", async () => {
    await renderLoadedGraph();
    const user = userEvent.setup();
    const tray = screen.getByTestId("selection-tray");

    await user.click(screen.getByTestId("select-node-root"));
    expect(within(tray).getByTestId("selection-slot-a")).toHaveTextContent(
      "Riverbend council approves waterfront plan",
    );
    expect(within(tray).getByTestId("selection-slot-b")).toHaveTextContent(
      "Not selected",
    );
    expect(screen.getByTestId("select-node-root")).toBeDisabled();

    await user.click(screen.getByTestId("select-node-seed"));
    expect(within(tray).getByTestId("selection-slot-b")).toHaveTextContent(
      "Waterfront plan draws praise and questions",
    );
    expect(within(tray).getByTestId("selection-slot-a")).toHaveTextContent(
      "Riverbend council approves waterfront plan",
    );
    expect(screen.getByTestId("select-node-root")).toBeDisabled();
    expect(screen.getByTestId("select-node-seed")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Swap A/B" }));
    expect(within(tray).getByTestId("selection-slot-a")).toHaveTextContent(
      "Waterfront plan draws praise and questions",
    );
    expect(within(tray).getByTestId("selection-slot-b")).toHaveTextContent(
      "Riverbend council approves waterfront plan",
    );

    await user.click(screen.getByRole("button", { name: "Clear pair" }));
    expect(within(tray).getByTestId("selection-slot-a")).toHaveTextContent(
      "Not selected",
    );
    expect(within(tray).getByTestId("selection-slot-b")).toHaveTextContent(
      "Not selected",
    );
  });

  it("requires explicit replacement for a third node", async () => {
    await renderLoadedGraph();
    const user = userEvent.setup();
    const tray = screen.getByTestId("selection-tray");

    await user.click(screen.getByTestId("select-node-root"));
    await user.click(screen.getByTestId("select-node-seed"));
    await user.click(screen.getByTestId("select-node-followup"));

    expect(screen.getByText(/The pair is full/i)).toBeInTheDocument();
    expect(screen.getByTestId("replace-a")).toBeInTheDocument();
    expect(screen.getByTestId("replace-b")).toBeInTheDocument();
    expect(within(tray).getByTestId("selection-slot-a")).toHaveTextContent(
      "Riverbend council approves waterfront plan",
    );
    expect(within(tray).getByTestId("selection-slot-b")).toHaveTextContent(
      "Waterfront plan draws praise and questions",
    );

    await user.click(screen.getByTestId("replace-a"));

    expect(within(tray).getByTestId("selection-slot-a")).toHaveTextContent(
      "County review adds new questions to waterfront plan",
    );
    expect(within(tray).getByTestId("selection-slot-b")).toHaveTextContent(
      "Waterfront plan draws praise and questions",
    );
    expect(screen.queryByTestId("replace-a")).not.toBeInTheDocument();
  });

  it("keeps question submission disabled with the milestone explanation", async () => {
    await renderLoadedGraph();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("select-node-root"));
    await user.click(screen.getByTestId("select-node-seed"));

    expect(screen.getByTestId("question-submit")).toBeDisabled();
    expect(screen.getByText(QUESTION_DISABLED_EXPLANATION)).toBeInTheDocument();
    expect(
      screen.getByText(
        /The current pair is A: Riverbend council approves waterfront plan and B: Waterfront plan draws praise and questions/,
      ),
    ).toBeInTheDocument();
  });
});

describe("source list search and filters", () => {
  it("searches loaded sources and filters by content kind", async () => {
    await renderLoadedGraph();
    const user = userEvent.setup();
    const search = screen.getByTestId("source-search");

    await user.type(search, "Courier");
    expect(screen.getByTestId("src-item-node-followup")).toBeInTheDocument();
    expect(screen.queryByTestId("src-item-node-seed")).not.toBeInTheDocument();

    await user.clear(search);
    await user.selectOptions(screen.getByLabelText("Content kind"), "news");
    expect(screen.getByTestId("src-item-node-root")).toBeInTheDocument();
    expect(screen.getByTestId("src-item-node-followup")).toBeInTheDocument();
    expect(screen.queryByTestId("src-item-node-seed")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("src-item-node-date-only"),
    ).not.toBeInTheDocument();

    await user.type(search, "no-match-query");
    expect(screen.getByText(/No sources match/)).toBeInTheDocument();
  });
});
