import { describe, expect, it } from 'vitest'
import type { Publication } from '../contracts/newsTrace'
import {
  formatPublication,
  formatRetrievedAt,
  readPublicationInstant,
} from './format'

const timestamp: Publication = {
  timestamp: '2026-06-18T14:30:00-04:00',
  date: null,
  raw: 'June 18, 2026 2:30 PM EDT',
  precision: 'timestamp',
  timezone_status: 'known',
  evidence_id: 'ev-pub',
}

describe('publication formatting', () => {
  it('uses the source offset and never invents a timezone', () => {
    const display = formatPublication(timestamp)
    expect(display.kind).toBe('timestamp')
    expect(display.hasKnownInstant).toBe(true)
    expect(display.headline).toContain('(UTC-04:00)')
    expect(display.headline).toContain('2026')
    expect(readPublicationInstant(timestamp)).toBe(
      Date.parse('2026-06-18T18:30:00Z'),
    )
  })

  it('keeps date-only values uncertain without midnight', () => {
    const display = formatPublication({
      precision: 'date',
      date: '2026-06-02',
      timestamp: null,
      raw: 'June 2, 2026',
      timezone_status: 'unknown',
      evidence_id: null,
    })
    expect(display.kind).toBe('date')
    expect(display.timeNote).toBe('Time unavailable')
    expect(display.isTimeUncertain).toBe(true)
    expect(readPublicationInstant({
      precision: 'date',
      date: '2026-06-02',
      timestamp: null,
      raw: null,
      timezone_status: 'unknown',
      evidence_id: null,
    })).toBeNull()
  })

  it('labels a local time with no timezone instead of converting it', () => {
    const display = formatPublication({
      precision: 'timestamp',
      timestamp: '2026-06-02T19:00:00',
      date: null,
      raw: 'June 2, 2026 7:00 PM',
      timezone_status: 'unknown',
      evidence_id: null,
    })
    expect(display.kind).toBe('unknown_timezone')
    expect(display.timeNote).toBe('Time zone not reported')
    expect(display.localNote).toBeNull()
  })

  it('shows an explicit unavailable state for missing dates', () => {
    const display = formatPublication({
      precision: 'unknown',
      timestamp: null,
      date: null,
      raw: null,
      timezone_status: 'unknown',
      evidence_id: null,
    })
    expect(display.headline).toBe('Publication time unavailable')
    expect(readPublicationInstant({
      precision: 'unknown',
      timestamp: null,
      date: null,
      raw: null,
      timezone_status: 'unknown',
      evidence_id: null,
    })).toBeNull()
  })

  it('formats retrieval time separately and safely', () => {
    expect(formatRetrievedAt('2026-07-12T10:00:00-04:00')).toContain('2026')
    expect(formatRetrievedAt('not-a-date')).toBe('Retrieval time unavailable')
  })
})
