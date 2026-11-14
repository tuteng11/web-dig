import type { SourceNode } from "../generated/newsTraceContracts";
import { formatPublication } from "../domain/format";
import { displayNodeTitle, sourceName } from "../domain/nodes";

interface SlotProps {
  slot: "a" | "b";
  node: SourceNode | null;
  onClear: (slot: "a" | "b") => void;
}

function SelectionSlot({ slot, node, onClear }: SlotProps) {
  const testId = slot === "a" ? "selection-slot-a" : "selection-slot-b";
  const title = node ? displayNodeTitle(node) : null;
  const publication = node ? formatPublication(node.publication) : null;

  return (
    <div className="selection-slot" data-testid={testId}>
      <div className="slot-heading">
        <span className={`slot-letter slot-${slot}`}>{slot.toUpperCase()}</span>
        <span>Slot {slot.toUpperCase()}</span>
      </div>
      {node && title && publication ? (
        <>
          <p className="slot-title">
            {title.isUrlFallback ? "URL: " : ""}
            {title.text}
          </p>
          <p className="slot-meta">
            {sourceName(node)} · {publication.compactText}
          </p>
          <button
            type="button"
            className="button button-quiet slot-clear"
            onClick={() => onClear(slot)}
            aria-label={`Clear slot ${slot.toUpperCase()}`}
          >
            Clear
          </button>
        </>
      ) : (
        <p className="slot-empty">Not selected</p>
      )}
    </div>
  );
}

interface PairSelectionTrayProps {
  a: SourceNode | null;
  b: SourceNode | null;
  pendingNode: SourceNode | null;
  onClear: () => void;
  onClearSlot: (slot: "a" | "b") => void;
  onSwap: () => void;
  onReplace: (slot: "a" | "b") => void;
  onCancelPending: () => void;
}

export function PairSelectionTray({
  a,
  b,
  pendingNode,
  onClear,
  onClearSlot,
  onSwap,
  onReplace,
  onCancelPending,
}: PairSelectionTrayProps) {
  const pendingTitle = pendingNode ? displayNodeTitle(pendingNode) : null;
  const complete = a !== null && b !== null;

  return (
    <section
      className="selection-tray"
      data-testid="selection-tray"
      aria-label="Question pair selection"
      aria-live="polite"
    >
      <div className="selection-tray-heading">
        <div>
          <p className="eyebrow">Question pair</p>
          <p className="selection-status">
            {complete
              ? "Two distinct sources selected."
              : a || b
                ? "Select one more distinct source to complete the pair."
                : "Select exactly two distinct sources."}
          </p>
        </div>
        <div className="selection-controls">
          <button
            type="button"
            className="button button-secondary"
            onClick={onSwap}
            disabled={!complete}
          >
            Swap A/B
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={onClear}
            disabled={!a && !b}
          >
            Clear pair
          </button>
        </div>
      </div>

      <div className="selection-slots">
        <SelectionSlot slot="a" node={a} onClear={onClearSlot} />
        <SelectionSlot slot="b" node={b} onClear={onClearSlot} />
      </div>

      {pendingNode && pendingTitle ? (
        <div className="replace-prompt" role="alert">
          <div>
            <strong>The pair is full.</strong>{" "}
            Replace A or Replace B to add “{pendingTitle.text}”:
          </div>
          <div className="replace-actions">
            <button
              type="button"
              className="button button-secondary"
              data-testid="replace-a"
              onClick={() => onReplace("a")}
            >
              Replace A
            </button>
            <button
              type="button"
              className="button button-secondary"
              data-testid="replace-b"
              onClick={() => onReplace("b")}
            >
              Replace B
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={onCancelPending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
