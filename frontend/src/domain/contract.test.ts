import { describe, expect, it } from 'vitest'
import { createFixtureClient } from '../api/fixture'
import { splitGraphChronology } from './chronology'
import { buildChronologicalLayout } from './layout'
import {
  EMPTY_FILTERS,
  filterGraphNodes,
  filterToQueryString,
  filtersFromQueryString,
} from './filtering'
import { applyGraphCaps, HARD_NODE_CAP, INITIAL_RENDER_LIMIT } from './caps'
import type { GraphResult, SourceNode } from '../contracts/newsTrace'

async function fixtureGraph(): Promise<GraphResult> {
  return createFixtureClient({ latencyMs: 0 }).getGraph('fixture-riverbend')
}

describe('chronology and layout', () => {
  it('separates dated and time-uncertain sources and sorts by instant', async () => {
    const graph = await fixtureGraph()
    const split = splitGraphChronology(graph)
    expect(split.dated.map((node) => node.id)).toContain('n-grassroots')
    expect(split.dated.map((node) => node.id)).not.toContain('n-dateonly')
    expect(split.uncertain.map((node) => node.id)).toEqual(
      expect.arrayContaining(['n-dateonly', 'n-local', 'n-undated', 'n-blocked']),
    )
    const first = split.dated[0]
    expect(first.publication.timestamp).toBe('2026-05-10T08:15:00-04:00')
  })

  it('places children below their display parent and keeps undated nodes out of the axis', async () => {
    const graph = await fixtureGraph()
    const layout = buildChronologicalLayout(graph)
    const root = layout.positions.get('n-grassroots')
    expect(root).toBeDefined()
    for (const edge of graph.tree_edges) {
      const parent = layout.positions.get(edge.parent_id)
      const child = layout.positions.get(edge.child_id)
      if (parent && child) {
        expect(child.y).toBeGreaterThanOrEqual(parent.y)
      }
    }
    expect(layout.uncertainNodeIds).toEqual(
      expect.arrayContaining(['n-dateonly', 'n-undated']),
    )
    expect(layout.positions.has('n-dateonly')).toBe(false)
  })
})

describe('filtering', () => {
  it('matches title/source/URL text and keeps hidden ancestors as context', async () => {
    const graph = await fixtureGraph()
    const result = filterGraphNodes(graph, {
      ...EMPTY_FILTERS,
      query: 'Re: Question about the battery yard fire plan',
    })
    expect(result.matchedIds.has('n-forum-b')).toBe(true)
    expect(result.matchedIds.has('n-grassroots')).toBe(false)
    expect(result.contextIds.has('n-grassroots')).toBe(true)
    expect(result.contextIds.has('n-hearing-live')).toBe(true)
  })

  it('filters by content kind and publication range', async () => {
    const graph = await fixtureGraph()
    const news = filterGraphNodes(graph, {
      ...EMPTY_FILTERS,
      contentKind: 'news',
    })
    expect(news.matchedIds.has('n-seed')).toBe(true)
    expect(news.matchedIds.has('n-forum-a')).toBe(false)

    const increasinglyEarly = filterGraphNodes(graph, {
      ...EMPTY_FILTERS,
      publishedFrom: '2026-06-01',
      publishedTo: '2026-06-30',
    })
    expect(increasinglyEarly.matchedIds.has('n-seed')).toBe(true)
    expect(increasinglyEarly.matchedIds.has('n-grassroots')).toBe(false)
  })

  it('round-trips filters through the route query without question text', () => {
    const filters = {
      ...EMPTY_FILTERS,
      query: 'battery yard',
      contentKind: 'post' as const,
      relationshipKind: 'links_to' as const,
      publishedFrom: '2026-05-01',
      publishedTo: '2026-06-30',
    }
    const roundTrip = filtersFromQueryString(
      `?${filterToQueryString(filters)}`,
    )
    expect(roundTrip).toEqual(filters)
  })
})

function syntheticNode(index: number): SourceNode {
  return {
    id: `node-${index}`,
    research_id: 'synthetic',
    content_kind: 'webpage',
    requested_url: `https://example.com/${index}`,
    canonical_url: `https://example.com/${index}`,
    title: `Source ${index}`,
    author: null,
    source: { name: 'Example', domain: 'example.com', platform: null },
    publication: {
      timestamp: null,
      date: null,
      raw: null,
      precision: 'unknown',
      timezone_status: 'unknown',
      evidence_id: null,
    },
    updated_at: null,
    retrieved_at: '2026-07-12T10:00:00+00:00',
    discovered_at: '2026-07-12T10:00:00+00:00',
    content_status: 'excerpt',
    excerpt: null,
    snapshot_id: null,
    content_hash: null,
    warnings: [],
  }
}

function syntheticGraph(nodeCount: number): GraphResult {
  return {
    research_id: 'synthetic',
    graph_revision: 1,
    seed_node_id: 'node-0',
    root_node_id: null,
    origin_assessment: {
      status: 'unresolved',
      earliest_candidate_ids: [],
      rationale: 'No defensible chronology.',
      searched_at: '2026-07-12T10:00:00+00:00',
      coverage_notes: [],
      timestamp_evidence_ids: [],
    },
    nodes: Array.from({ length: nodeCount }, (_, index) =>
      syntheticNode(index),
    ),
    relationships: [],
    tree_edges: [],
    cross_link_ids: [],
    undated_node_ids: Array.from(
      { length: nodeCount },
      (_, index) => `node-${index}`,
    ),
    limits: { max_nodes: HARD_NODE_CAP, max_relationships: 1500 },
    truncated: false,
    omitted_count: null,
    warnings: [],
  }
}

describe('graph caps', () => {
  it('renders 100 initially and reports the remainder', () => {
    const graph = syntheticGraph(120)
    const initial = applyGraphCaps(graph, false)
    expect(initial.nodeIds.size).toBe(INITIAL_RENDER_LIMIT)
    expect(initial.hiddenCount).toBe(20)
    expect(initial.capReached).toBe(true)

    const all = applyGraphCaps(graph, true)
    expect(all.nodeIds.size).toBe(120)
    expect(all.hiddenCount).toBe(0)
    expect(all.capReached).toBe(false)
  })

  it('enforces the 500-node hard cap', () => {
    const graph = syntheticGraph(520)
    const all = applyGraphCaps(graph, true)
    expect(all.nodeIds.size).toBe(HARD_NODE_CAP)
    expect(all.hiddenCount).toBe(20)
    expect(all.capReached).toBe(true)
  })
})
