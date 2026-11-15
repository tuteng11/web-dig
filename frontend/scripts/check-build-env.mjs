#!/usr/bin/env node
/**
 * Guard against a production bundle that keeps `import.meta.env` as a runtime
 * expression. Vite statically replaces direct `import.meta.env.NAME` reads; if
 * the app reads the whole `import.meta.env` object, the configured values are
 * silently dropped in the browser.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '..', 'dist', 'assets')

let files
try {
  files = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'))
} catch {
  console.error(`Build assets directory is missing: ${assetsDir}`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`No JavaScript build assets found in ${assetsDir}`)
  process.exit(1)
}

const unresolved = []
for (const file of files) {
  const source = await readFile(resolve(assetsDir, file), 'utf8')
  if (source.includes('import.meta.env')) {
    unresolved.push(file)
  }
}

if (unresolved.length > 0) {
  console.error(
    `Production bundle contains unresolved import.meta.env references: ${unresolved.join(', ')}`,
  )
  console.error(
    'Use direct import.meta.env.VITE_* reads so Vite can statically replace them.',
  )
  process.exit(1)
}

console.log(
  `Production bundle has statically replaced env values (${files.length} JS asset file(s)).`,
)
