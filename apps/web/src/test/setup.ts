import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * Cytoscape draws to canvas, which jsdom does not implement. The explorer is
 * tested through its DOM controls and accessible list; this fake keeps the
 * renderer from touching canvas APIs without changing component behavior.
 */
vi.mock("cytoscape", () => {
  const createCore = () => {
    const emptyCollection = {
      forEach: vi.fn(),
      nonempty: () => false,
      addClass: vi.fn(),
      removeClass: vi.fn(),
      toggleClass: vi.fn(),
    };

    return {
      on: vi.fn(),
      fit: vi.fn(),
      destroy: vi.fn(),
      zoom: vi.fn(() => 1),
      center: vi.fn(),
      elements: vi.fn(() => emptyCollection),
      nodes: vi.fn(() => emptyCollection),
      edges: vi.fn(() => emptyCollection),
      getElementById: vi.fn(() => emptyCollection),
    };
  };

  return {
    default: vi.fn(() => createCore()),
  };
});
