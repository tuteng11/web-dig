import type { SourceNode } from '../contracts/newsTrace'
import { formatPublication } from '../domain/format'
import { displayNodeTitle, sourceName } from '../domain/nodes'

interface SelectionSlotProps {
  slot: 'a' | 'b'
  node: SourceNode | null
  onClear(slot: 'a' | 'b'): void
}

function SelectionSlot({ slot, node, onClear }: SelectionSlotProps) {
  const letter = slot.toUpperCase()
  const title = node ? displayNodeTitle(node) : null
  const publication = node ? formatPublication(node.publication) : null

  return (
    <div className="selection-slot" data-slot={slot}>
      <div className="slot-heading">
        <span className={slot === 'b' ? 'slot-letter slot-b' : 'slot-letter'} aria-hidden="true">
          {letter}
        </span>
        <span>Slot {letter}</span>
      </div>
      {node && title && publication ? (
        <>
          <p className="slot-title">
            {title.isUrlFallback ? <span className="fallback-label">URL</span> : null}
            {title.text}
          </p>
          <p className="slot-meta">
            {sourceName(node)} · {publication.compactText}
          </p>
          <button
            type="button"
            className="button button-quiet slot-clear"
            onClick={() => onClear(slot)}
            aria-label={`Clear slot ${letter}: ${title.text}`}
          >
            Clear slot {letter}
          </button>
        </>
      ) : (
        <p className="slot-empty">Not selected</p>
      )}
    </div>
  )
}

export interface PairSelectionTrayProps {
  a: SourceNode | null
  b: SourceNode | null
  pendingNode: SourceNode | null
  onClear(): void
  onClearSlot(slot: 'a' | 'b'): void
  onSwap(): void
  onReplace(slot: 'a' | 'b'): void
  onCancelPending(): void
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
  const complete = a !== null && b !== null
  const duplicate = a !== null && b !== null && a.id === b.id
  const pendingTitle = pendingNode ? displayNodeTitle(pendingNode) : null
  const pendingPublication = pendingNode
    ? formatPublication(pendingNode.publication)
    : null

  const status = duplicate
    ? 'Slots A and B refer to the same source. Select two distinct sources.'
    : complete
      ? 'Two distinct sources selected. This pair is pinned when a question is submitted.'
      : a || b
        ? 'Select one more distinct source to complete the pair.'
        : 'Select exactly two distinct sources for a question.'

  return (
    <section
      className="selection-tray"
      aria-label="Question pair selection"
    >
      <div className="selection-tray-heading">
        <div>
          <p className="field-label">Question pair</p>
          <p
            className={duplicate ? 'selection-status error-meta' : 'selection-status'}
            role={duplicate ? 'alert' : 'status'}
            aria-live="polite"
          >
            {status}
          </p>
        </div>
        <div className="selection-controls">
          <button
            type="button"
            className="button button-secondary"
            onClick={onSwap}
            disabled={!complete || duplicate}
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
            <strong>
              {complete
                ? 'Both question slots are full.'
                : 'Choose a slot for this source.'}
            </strong>{' '}
            {complete
              ? 'This third source does not silently replace either slot.'
              : 'The pair needs exactly two distinct sources.'}
            <p className="slot-title">
              {pendingTitle.isUrlFallback ? (
                <span className="fallback-label">URL</span>
              ) : null}
              {pendingTitle.text}
            </p>
            {pendingPublication ? (
              <p className="slot-meta">
                {sourceName(pendingNode)} · {pendingPublication.compactText}
              </p>
            ) : null}
          </div>
          <div className="replace-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onReplace('a')}
            >
              Replace A
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onReplace('b')}
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
  )
}
