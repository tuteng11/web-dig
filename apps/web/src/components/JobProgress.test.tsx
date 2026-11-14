import { render, screen, within } from "@testing-library/react";

import { JobProgress } from "./JobProgress";
import { makeGraph, sampleGraph } from "../test/fixtures";

describe("JobProgress origin visibility", () => {
  it("shows a visible provisional-origin banner with alternatives", () => {
    const graph = makeGraph({
      origin_assessment: {
        ...sampleGraph().origin_assessment,
        status: "provisional",
        earliest_candidate_ids: ["node-root", "node-seed"],
        rationale: "Two candidates share the earliest date.",
      },
    });

    render(<JobProgress phase="ready" graph={graph} />);

    expect(screen.getByTestId("origin-status")).toBeInTheDocument();
    expect(screen.getByText("Provisional origin")).toBeInTheDocument();
    const banner = within(screen.getByTestId("origin-status"));
    expect(banner.getByText(/Two candidates share/)).toBeInTheDocument();
    expect(banner.getByText(/Waterfront plan draws praise/)).toBeInTheDocument();
  });

  it("keeps resolved origins compact", () => {
    render(<JobProgress phase="ready" graph={sampleGraph()} />);

    expect(screen.queryByTestId("origin-status")).not.toBeInTheDocument();
  });

  it("labels a time-uncertain root as a display anchor", () => {
    const graph = makeGraph({
      root_node_id: "node-date-only",
      origin_assessment: {
        ...sampleGraph().origin_assessment,
        status: "provisional",
        earliest_candidate_ids: ["node-date-only"],
        rationale: "Only date-level evidence is available.",
      },
      undated_node_ids: ["node-date-only", "node-undated"],
    });

    render(<JobProgress phase="ready" graph={graph} />);

    expect(screen.getByTestId("origin-status")).toBeInTheDocument();
    expect(screen.getByText(/display anchor only/i)).toBeInTheDocument();
  });
});
