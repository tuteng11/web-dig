import { describe, expect, it } from 'vitest'
import type { AnswerResult, GraphMutationResult } from '../contracts/http'
import { createFixtureClient } from './fixture'
import { GatewayError } from './gateway'
import { validateAnswerResult } from '../domain/answers'
import { validateGraphResult } from '../domain/validation'

const researchId = 'fixture-riverbend'

describe('fixture client', () => {
  it('serves the initial contract graph and node details', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    const raw = await client.getGraph(researchId)
    const validation = validateGraphResult(raw, researchId)
    expect(validation.ok).toBe(true)
    expect(raw.graph_revision).toBe(1)
    expect(raw.seed_node_id).toBe('n-seed')
    expect(raw.root_node_id).toBe('n-grassroots')
    expect(raw.nodes).toHaveLength(16)
    expect(raw.tree_edges.length).toBeGreaterThan(0)
    expect(raw.undated_node_ids?.length).toBeGreaterThan(0)

    const details = await client.getNodeDetails(researchId, 'n-seed')
    expect(details.research_id).toBe(researchId)
    expect(details.node.id).toBe('n-seed')
    expect(details.evidence?.length).toBeGreaterThan(0)
  })

  it('never pretends to run live discovery in fixture mode', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    await expect(
      client.startResearch({
        question: 'Who reported this first?',
        source_url: 'https://example.com/article',
        request_id: 'request-1',
      }),
    ).rejects.toBeInstanceOf(GatewayError)
    await expect(
      client.startResearch({
        question: 'Who reported this first?',
        source_url: 'https://example.com/article',
        request_id: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
  })

  it('expands to the earlier-source revision and reroots without changing IDs', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    const before = await client.getGraph(researchId)
    const job = await client.expandNode(researchId, {
      node_id: 'n-grassroots',
      graph_revision: before.graph_revision,
      request_id: 'request-expand',
    })
    expect(job.status).toBe('completed')
    expect(job.kind).toBe('expansion')
    const mutation = job.result as GraphMutationResult | null
    expect(mutation).toMatchObject({
      graph_revision: 2,
      added_node_ids: ['n-agenda'],
    })
    expect(mutation?.warnings.join(' ')).toContain('Origin changed')

    const after = await client.getGraph(researchId)
    expect(after.graph_revision).toBe(2)
    expect(after.root_node_id).toBe('n-agenda')
    expect(after.nodes.some((node) => node.id === 'n-grassroots')).toBe(true)
    expect(after.nodes.some((node) => node.id === 'n-agenda')).toBe(true)
    const details = await client.getNodeDetails(researchId, 'n-agenda')
    expect(details.node.id).toBe('n-agenda')
  })

  it('returns a synthetic, evidence-linked answer for the demo pair', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    const graph = await client.getGraph(researchId)
    const job = await client.askQuestion(researchId, {
      node_ids: ['n-seed', 'n-grassroots'],
      graph_revision: graph.graph_revision,
      question: 'Which source was published first?',
      request_id: 'request-question',
    })
    expect(job.status).toBe('completed')
    expect(job.kind).toBe('question')
    const answer = job.result as AnswerResult | null
    if (!answer) {
      throw new Error('expected an answer result')
    }
    expect(answer.outcome).toBe('answered')
    expect(answer.statements).toHaveLength(3)
    expect(answer.citations.map((citation) => citation.evidence_id)).toEqual(
      expect.arrayContaining([
        'ev-pub-n-grassroots',
        'ev-pub-n-seed',
        'ev-link-seed-grassroots',
      ]),
    )
    expect(answer.additional_candidates?.[0]?.candidate_id).toBe('n-agenda')
    expect(answer.limitations.join(' ')).toContain('Synthetic')

    const validation = validateAnswerResult(answer, {
      researchId,
      graphRevision: graph.graph_revision,
      nodeIds: ['n-seed', 'n-grassroots'],
      knownNodeIds: new Set([
        ...graph.nodes.map((node) => node.id),
        'n-agenda',
      ]),
      knownCandidateIds: new Set(['n-agenda']),
    })
    expect(validation.ok).toBe(true)
  })

  it('returns insufficient evidence when dates cannot support an ordering', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    const graph = await client.getGraph(researchId)
    const job = await client.askQuestion(researchId, {
      node_ids: ['n-seed', 'n-undated'],
      graph_revision: graph.graph_revision,
      question: 'Which came first?',
      request_id: 'request-question-2',
    })
    const answer = job.result as AnswerResult | null
    if (!answer) {
      throw new Error('expected an answer result')
    }
    expect(answer.outcome).toBe('insufficient_evidence')
    expect(answer.statements).toHaveLength(0)
  })

  it('adds explicitly selected discoveries and advances the revision', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    const graph = await client.getGraph(researchId)
    const questionJob = await client.askQuestion(researchId, {
      node_ids: ['n-seed', 'n-grassroots'],
      graph_revision: graph.graph_revision,
      question: 'Which source was published first?',
      request_id: 'request-question-add',
    })
    const answer = questionJob.result as AnswerResult | null
    if (!answer) {
      throw new Error('expected an answer result')
    }
    const job = await client.addDiscoveries(researchId, {
      answer_id: answer.answer_id,
      candidate_ids: ['n-agenda'],
      graph_revision: graph.graph_revision,
      request_id: 'request-add',
    })
    expect(job.status).toBe('completed')
    expect(job.kind).toBe('add_discoveries')
    const after = await client.getGraph(researchId)
    expect(after.graph_revision).toBe(2)
    expect(after.nodes.some((node) => node.id === 'n-agenda')).toBe(true)
  })

  it('returns NOT_FOUND for an unknown job', async () => {
    const client = createFixtureClient({ latencyMs: 0 })
    await expect(client.getJob('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
