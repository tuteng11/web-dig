import { describe, expect, it } from 'vitest'
import type { AnswerResult } from '../contracts/http'
import { validateAnswerResult } from './answers'

function answered(): AnswerResult {
  return {
    answer_id: 'answer-1',
    research_id: 'research-1',
    selected_nodes: [
      { node_id: 'a', snapshot_id: 'snap-a' },
      { node_id: 'b', snapshot_id: 'snap-b' },
    ],
    graph_revision: 3,
    question: 'Which came first?',
    outcome: 'answered',
    statements: [
      { text: 'Source A was published first.', citation_ids: ['c1'] },
    ],
    citations: [
      {
        id: 'c1',
        node_id: 'a',
        snapshot_id: 'snap-a',
        evidence_id: 'ev-1',
        quote: null,
        start: null,
        end: null,
        metadata_field: 'publication.timestamp',
        metadata_value: '2026-05-10T08:15:00-04:00',
      },
    ],
    limitations: [],
    additional_candidate_ids: [],
    completed_at: '2026-07-12T10:00:00-04:00',
  }
}

const expected = {
  researchId: 'research-1',
  graphRevision: 3,
  nodeIds: ['a', 'b'] as [string, string],
  knownNodeIds: new Set(['a', 'b']),
  knownCandidateIds: new Set<string>(),
}

describe('answer validation', () => {
  it('accepts a grounded metadata-cited answer', () => {
    const result = validateAnswerResult(answered(), expected)
    expect(result.ok).toBe(true)
  })

  it('rejects a statement that cites a missing citation', () => {
    const answer = answered()
    answer.statements[0].citation_ids = ['missing']
    const result = validateAnswerResult(answer, expected)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('missing')
    }
  })

  it('rejects a pair that does not match the request', () => {
    const answer = answered()
    answer.selected_nodes = [
      { node_id: 'a', snapshot_id: 'snap-a' },
      { node_id: 'x', snapshot_id: null },
    ]
    expect(validateAnswerResult(answer, expected).ok).toBe(false)
  })

  it('rejects statements on an insufficient-evidence answer', () => {
    const answer = answered()
    answer.outcome = 'insufficient_evidence'
    expect(validateAnswerResult(answer, expected).ok).toBe(false)
  })

  it('rejects offsets that are not backed by a quote', () => {
    const answer = answered()
    answer.citations[0].quote = null
    answer.citations[0].start = 0
    answer.citations[0].end = 5
    expect(validateAnswerResult(answer, expected).ok).toBe(false)
  })

  it('rejects unknown graph revisions and unsafe citation nodes', () => {
    const wrongRevision = { ...answered(), graph_revision: 4 }
    expect(validateAnswerResult(wrongRevision, expected).ok).toBe(false)

    const unknownNode = answered()
    unknownNode.citations[0].node_id = 'not-in-graph'
    expect(validateAnswerResult(unknownNode, expected).ok).toBe(false)
  })
})
