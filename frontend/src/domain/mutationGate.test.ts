import { describe, expect, it } from 'vitest'
import {
  createMutationIdTracker,
  createSubmissionGate,
  mutationSignature,
  type SubmissionGate,
} from './mutationGate'

function beginOrFail(gate: SubmissionGate): number {
  const token = gate.begin()
  expect(token).not.toBeNull()
  if (token === null) {
    throw new Error('expected the submission gate to open')
  }
  return token
}

describe('submission gate', () => {
  it('holds one submission at a time and ignores stale releases', () => {
    const gate = createSubmissionGate()
    expect(gate.isHeld()).toBe(false)

    const token = beginOrFail(gate)
    expect(gate.isHeld()).toBe(true)
    expect(gate.begin()).toBeNull()

    expect(gate.end(token + 1)).toBe(false)
    expect(gate.isHeld()).toBe(true)

    expect(gate.end(token)).toBe(true)
    expect(gate.isHeld()).toBe(false)
    expect(gate.end(token)).toBe(false)

    const next = beginOrFail(gate)
    expect(next).not.toBe(token)
  })

  it('reset releases the gate and invalidates the previous token', () => {
    const gate = createSubmissionGate()
    const token = beginOrFail(gate)

    gate.reset()
    expect(gate.isHeld()).toBe(false)
    expect(gate.end(token)).toBe(false)

    const next = beginOrFail(gate)
    expect(next).not.toBe(token)
    expect(gate.end(token)).toBe(false)
    expect(gate.isHeld()).toBe(true)
    expect(gate.end(next)).toBe(true)
  })
})

describe('mutation ID tracker', () => {
  it('reuses the generated ID for the same signature', () => {
    let calls = 0
    const tracker = createMutationIdTracker(() => {
      calls += 1
      return `request-${calls}`
    })

    const first = tracker.forPayload('question:{"nodeIds":["a","b"]}')
    const second = tracker.forPayload('question:{"nodeIds":["a","b"]}')

    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  it('keeps independent IDs for interleaved signatures', () => {
    let calls = 0
    const tracker = createMutationIdTracker(() => {
      calls += 1
      return `request-${calls}`
    })

    const question = tracker.forPayload('question:{"nodeIds":["a","b"]}')
    const expand = tracker.forPayload('expand:{"nodeId":"a"}')
    const retriedQuestion = tracker.forPayload(
      'question:{"nodeIds":["a","b"]}',
    )
    const retriedExpand = tracker.forPayload('expand:{"nodeId":"a"}')

    expect(retriedQuestion).toBe(question)
    expect(retriedExpand).toBe(expand)
    expect(question).not.toBe(expand)
    expect(calls).toBe(2)
  })

  it('allocates a fresh ID when the signature changes', () => {
    let calls = 0
    const tracker = createMutationIdTracker(() => {
      calls += 1
      return `request-${calls}`
    })

    const first = tracker.forPayload('question:{"nodeIds":["a","b"]}')
    const second = tracker.forPayload('question:{"nodeIds":["a","c"]}')

    expect(second).not.toBe(first)
    expect(calls).toBe(2)
  })

  it('settles only the matching pending signature', () => {
    let calls = 0
    const tracker = createMutationIdTracker(() => {
      calls += 1
      return `request-${calls}`
    })

    const question = tracker.forPayload('question:{"nodeIds":["a","b"]}')
    const expand = tracker.forPayload('expand:{"nodeId":"a"}')
    tracker.settle('question:{"nodeIds":["a","b"]}')

    const retriedQuestion = tracker.forPayload(
      'question:{"nodeIds":["a","b"]}',
    )
    const retriedExpand = tracker.forPayload('expand:{"nodeId":"a"}')

    expect(retriedQuestion).not.toBe(question)
    expect(retriedExpand).toBe(expand)
    expect(calls).toBe(3)
  })

  it('clear removes all pending records', () => {
    let calls = 0
    const tracker = createMutationIdTracker(() => {
      calls += 1
      return `request-${calls}`
    })

    const question = tracker.forPayload('question:{"nodeIds":["a","b"]}')
    const expand = tracker.forPayload('expand:{"nodeId":"a"}')
    tracker.clear()
    const nextQuestion = tracker.forPayload('question:{"nodeIds":["a","b"]}')
    const nextExpand = tracker.forPayload('expand:{"nodeId":"a"}')

    expect(nextQuestion).not.toBe(question)
    expect(nextExpand).not.toBe(expand)
    expect(calls).toBe(4)
  })
})

describe('mutation signature', () => {
  it('is stable for the same kind and payload', () => {
    const payload = {
      researchId: 'research-1',
      answerId: 'answer-1',
      candidateIds: ['candidate-a', 'candidate-b'],
      graphRevision: 3,
    }

    expect(mutationSignature('add_discoveries', payload)).toBe(
      mutationSignature('add_discoveries', {
        researchId: 'research-1',
        answerId: 'answer-1',
        candidateIds: ['candidate-a', 'candidate-b'],
        graphRevision: 3,
      }),
    )
  })

  it('differs when the payload or kind changes', () => {
    const base = mutationSignature('expand', {
      researchId: 'research-1',
      nodeId: 'node-a',
      graphRevision: 3,
    })

    expect(
      mutationSignature('expand', {
        researchId: 'research-1',
        nodeId: 'node-b',
        graphRevision: 3,
      }),
    ).not.toBe(base)
    expect(
      mutationSignature('question', {
        researchId: 'research-1',
        nodeId: 'node-a',
        graphRevision: 3,
      }),
    ).not.toBe(base)
  })
})
