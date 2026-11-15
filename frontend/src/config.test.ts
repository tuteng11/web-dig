import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_API_BASE,
  DEFAULT_FIXTURE_RESEARCH_ID,
  parseDemoTransport,
  readRuntimeConfig,
  resolveRuntimeConfig,
} from './config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveRuntimeConfig demo transport precedence', () => {
  it('defaults to the read-only gateway demo with no env overrides', () => {
    expect(resolveRuntimeConfig({})).toEqual({
      mode: 'fixture',
      apiBase: DEFAULT_API_BASE,
      fixtureResearchId: DEFAULT_FIXTURE_RESEARCH_ID,
      demoTransport: 'gateway',
    })
  })

  it('honours an explicit gateway transport', () => {
    expect(
      resolveRuntimeConfig({
        VITE_DEMO_TRANSPORT: 'gateway',
        VITE_FIXTURE_MODE: 'true',
      }).demoTransport,
    ).toBe('gateway')
  })

  it('honours an explicit bundled transport', () => {
    expect(
      resolveRuntimeConfig({ VITE_DEMO_TRANSPORT: 'bundled' }).demoTransport,
    ).toBe('bundled')
  })

  it('trims and lowercases explicit transport values', () => {
    expect(parseDemoTransport('  BUNDLED ')).toBe('bundled')
    expect(parseDemoTransport('Gateway')).toBe('gateway')
  })

  it('falls back to bundled when VITE_FIXTURE_MODE=true', () => {
    expect(
      resolveRuntimeConfig({ VITE_FIXTURE_MODE: 'true' }).demoTransport,
    ).toBe('bundled')
    expect(
      resolveRuntimeConfig({ VITE_FIXTURE_MODE: 'TRUE' }).demoTransport,
    ).toBe('bundled')
  })

  it('defaults to gateway when VITE_FIXTURE_MODE=false and mode is live', () => {
    expect(resolveRuntimeConfig({ VITE_FIXTURE_MODE: 'false' })).toMatchObject({
      mode: 'live',
      demoTransport: 'gateway',
    })
  })

  it('ignores invalid explicit transport values and falls through', () => {
    expect(
      resolveRuntimeConfig({
        VITE_DEMO_TRANSPORT: 'carrier-pigeon',
        VITE_FIXTURE_MODE: 'true',
      }).demoTransport,
    ).toBe('bundled')
    expect(
      resolveRuntimeConfig({
        VITE_DEMO_TRANSPORT: 'carrier-pigeon',
        VITE_FIXTURE_MODE: 'false',
      }).demoTransport,
    ).toBe('gateway')
  })

  it('lets an explicit transport win over VITE_FIXTURE_MODE=true', () => {
    expect(
      resolveRuntimeConfig({
        VITE_DEMO_TRANSPORT: 'gateway',
        VITE_FIXTURE_MODE: 'true',
      }).demoTransport,
    ).toBe('gateway')
    expect(
      resolveRuntimeConfig({
        VITE_DEMO_TRANSPORT: 'bundled',
        VITE_FIXTURE_MODE: 'true',
      }).demoTransport,
    ).toBe('bundled')
  })

  it('keeps fixture mode for every VITE_FIXTURE_MODE value except false', () => {
    expect(resolveRuntimeConfig({ VITE_FIXTURE_MODE: '1' }).mode).toBe('fixture')
    expect(resolveRuntimeConfig({ VITE_FIXTURE_MODE: 'yes' }).mode).toBe(
      'fixture',
    )
    expect(resolveRuntimeConfig({ VITE_FIXTURE_MODE: 'false' }).mode).toBe(
      'live',
    )
  })

  it('reads optional API values and falls back to defaults', () => {
    expect(
      resolveRuntimeConfig({
        VITE_API_BASE: ' /custom/api ',
        VITE_FIXTURE_RESEARCH_ID: ' custom-fixture ',
      }),
    ).toMatchObject({
      apiBase: '/custom/api',
      fixtureResearchId: 'custom-fixture',
    })
  })
})

describe('readRuntimeConfig', () => {
  it('reads Vite env values and restores stubbed env state', () => {
    vi.stubEnv('VITE_DEMO_TRANSPORT', 'bundled')
    vi.stubEnv('VITE_FIXTURE_MODE', 'true')
    expect(readRuntimeConfig()).toMatchObject({
      mode: 'fixture',
      demoTransport: 'bundled',
    })
  })
})
