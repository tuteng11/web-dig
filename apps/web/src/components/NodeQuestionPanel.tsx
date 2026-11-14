import type { SourceNode } from "../generated/newsTraceContracts";
import { QUESTION_DISABLED_EXPLANATION } from "../config";
import { displayNodeTitle } from "../domain/nodes";

interface NodeQuestionPanelProps {
  a: SourceNode | null;
  b: SourceNode | null;
}

export function NodeQuestionPanel({ a, b }: NodeQuestionPanelProps) {
  const complete = a !== null && b !== null;
  const aTitle = a ? displayNodeTitle(a).text : null;
  const bTitle = b ? displayNodeTitle(b).text : null;

  return (
    <section className="question-panel" aria-labelledby="question-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Ask</p>
          <h2 id="question-heading">Ask about selected sources</h2>
        </div>
      </div>

      <p className="question-explanation" role="note">
        {QUESTION_DISABLED_EXPLANATION}
      </p>

      <p className="muted">
        {complete
          ? `The current pair is A: ${aTitle} and B: ${bTitle}.`
          : "Select two distinct sources before a question can be prepared."}
      </p>

      <label className="field-label" htmlFor="node-question-input">
        Question
      </label>
      <textarea
        id="node-question-input"
        className="question-input"
        rows={3}
        disabled
        placeholder="Question submission is disabled in this milestone."
      />

      <button
        type="button"
        className="button button-primary"
        data-testid="question-submit"
        disabled
        title={QUESTION_DISABLED_EXPLANATION}
      >
        Ask question
      </button>
      <p className="limitation-note">
        This control is intentionally disabled. It does not submit, pretend to
        answer, or call a model.
      </p>
    </section>
  );
}
