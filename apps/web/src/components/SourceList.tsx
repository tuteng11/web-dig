import { useId, useMemo, useState } from "react";
import type { ContentKind, SourceNode } from "../generated/newsTraceContracts";
import {
  compareDatedNodes,
  compareUncertainNodes,
} from "../domain/chronology";
import { formatPublication, readPublicationInstant } from "../domain/format";
import {
  contentKindLabel,
  contentStatusLabel,
  displayNodeTitle,
  sourceName,
} from "../domain/nodes";

interface SourceListProps {
  nodes: SourceNode[];
  rootNodeId: string | null;
  seedNodeId: string;
  unplacedNodeIds: string[];
  selectedNodeId: string | null;
  selectedA: string | null;
  selectedB: string | null;
  onInspect: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}

type KindFilter = "all" | ContentKind;

const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: "all", label: "All content kinds" },
  { value: "news", label: "News" },
  { value: "post", label: "Posts" },
  { value: "webpage", label: "Web pages" },
];

function nodeMatchesSearch(node: SourceNode, query: string): boolean {
  if (query.length === 0) {
    return true;
  }

  const title = displayNodeTitle(node);
  const haystack = [
    title.text,
    node.canonical_url,
    node.requested_url,
    node.source.name ?? "",
    node.source.domain,
    node.source.platform ?? "",
    node.author ?? "",
    node.excerpt ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase();

  return haystack.includes(query);
}

interface SourceRowProps {
  node: SourceNode;
  isRoot: boolean;
  isSeed: boolean;
  isActive: boolean;
  isUnplaced: boolean;
  selectedSlot: "A" | "B" | null;
  onInspect: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}

function SourceRow({
  node,
  isRoot,
  isSeed,
  isActive,
  isUnplaced,
  selectedSlot,
  onInspect,
  onSelect,
}: SourceRowProps) {
  const title = displayNodeTitle(node);
  const publication = formatPublication(node.publication);
  const uncertain = readPublicationInstant(node.publication) === null;

  return (
    <li
      className={`source-item${isActive ? " source-item-active" : ""}`}
      data-testid={`src-item-${node.id}`}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="source-item-topline">
        <span className={`kind-chip kind-${node.content_kind}`}>
          {contentKindLabel(node.content_kind)}
        </span>
        <span className="source-domain">{sourceName(node)}</span>
      </div>
      <p className="source-status">{contentStatusLabel(node.content_status)}</p>

      <p className={`source-title${title.isUrlFallback ? " url-fallback" : ""}`}>
        {title.isUrlFallback ? <span className="fallback-label">URL</span> : null}
        {title.text}
      </p>

      <div className="badge-row">
        {isRoot ? <span className="badge badge-root">Earliest evidence found</span> : null}
        {isSeed ? <span className="badge badge-seed">Submitted source</span> : null}
        {uncertain ? (
          <span className="badge badge-uncertain">Time-uncertain</span>
        ) : isUnplaced ? (
          <span className="badge badge-neutral">Not placed on dated tree</span>
        ) : null}
      </div>

      <p className="source-publication">{publication.compactText}</p>

      <div className="source-actions">
        <button
          type="button"
          className="button button-quiet"
          data-testid={`inspect-${node.id}`}
          aria-label={`Inspect ${title.text}`}
          aria-pressed={isActive}
          onClick={() => onInspect(node.id)}
        >
          Inspect
        </button>
        <button
          type="button"
          className="button button-secondary"
          data-testid={`select-${node.id}`}
          aria-label={`Select ${title.text} for question`}
          aria-pressed={selectedSlot !== null}
          disabled={selectedSlot !== null}
          onClick={() => onSelect(node.id)}
        >
          {selectedSlot ? `Selected ${selectedSlot}` : "Select for question"}
        </button>
      </div>
    </li>
  );
}

export function SourceList({
  nodes,
  rootNodeId,
  seedNodeId,
  unplacedNodeIds,
  selectedNodeId,
  selectedA,
  selectedB,
  onInspect,
  onSelect,
}: SourceListProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const unplacedIds = useMemo(
    () => new Set(unplacedNodeIds),
    [unplacedNodeIds],
  );
  const searchId = useId();
  const filterId = useId();
  const resultsId = useId();

  const filteredNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return nodes.filter(
      (node) =>
        (kindFilter === "all" || node.content_kind === kindFilter) &&
        nodeMatchesSearch(node, normalizedQuery),
    );
  }, [kindFilter, nodes, query]);

  const dated = useMemo(
    () =>
      filteredNodes
        .filter((node) => readPublicationInstant(node.publication) !== null)
        .sort(compareDatedNodes),
    [filteredNodes],
  );
  const uncertain = useMemo(
    () =>
      filteredNodes
        .filter((node) => readPublicationInstant(node.publication) === null)
        .sort(compareUncertainNodes),
    [filteredNodes],
  );

  const renderRow = (node: SourceNode) => {
    const selectedSlot =
      selectedA === node.id ? "A" : selectedB === node.id ? "B" : null;
    return (
      <SourceRow
        key={node.id}
        node={node}
        isRoot={node.id === rootNodeId}
        isSeed={node.id === seedNodeId}
        isActive={node.id === selectedNodeId}
        isUnplaced={unplacedIds.has(node.id)}
        selectedSlot={selectedSlot}
        onInspect={onInspect}
        onSelect={onSelect}
      />
    );
  };

  return (
    <section
      className="source-list-panel"
      data-testid="source-list"
      aria-labelledby="sources-heading"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Sources</p>
          <h2 id="sources-heading">Loaded research sources</h2>
        </div>
        <span className="count-chip">
          {filteredNodes.length}/{nodes.length}
        </span>
      </div>

      <div className="source-controls">
        <label className="field-label" htmlFor={searchId}>
          Search loaded sources
        </label>
        <input
          id={searchId}
          data-testid="source-search"
          className="text-input"
          type="search"
          value={query}
          aria-describedby={resultsId}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Title, source, URL, excerpt…"
        />

        <label className="field-label" htmlFor={filterId}>
          Content kind
        </label>
        <select
          id={filterId}
          className="select-input"
          value={kindFilter}
          onChange={(event) =>
            setKindFilter(event.currentTarget.value as KindFilter)
          }
        >
          {KIND_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <p id={resultsId} className="sr-only" aria-live="polite">
        {filteredNodes.length} source
        {filteredNodes.length === 1 ? "" : "s"} match the current search and
        filter.
      </p>

      {filteredNodes.length === 0 ? (
        <p className="empty-list-note">
          No sources match this search and content-kind filter. This does not
          claim that no related sources exist beyond the loaded fixture.
        </p>
      ) : (
        <div className="source-scroll">
          {dated.length > 0 ? (
            <section aria-labelledby="dated-sources-heading">
              <h3 id="dated-sources-heading" className="source-group-heading">
                Dated sources · earliest first
              </h3>
              <ul className="source-items">{dated.map(renderRow)}</ul>
            </section>
          ) : null}

          {uncertain.length > 0 ? (
            <section
              className="source-uncertain-group"
              aria-labelledby="uncertain-sources-heading"
            >
              <h3
                id="uncertain-sources-heading"
                className="source-group-heading"
              >
                Time-uncertain / undated
              </h3>
              <p className="group-note">
                Publication precision does not support a reliable position on
                the chronological axis.
              </p>
              <ul className="source-items">{uncertain.map(renderRow)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
