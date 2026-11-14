#!/usr/bin/env node
/**
 * Keep the new UI's shared DTOs derived from the same generated contract as the
 * existing apps/web client. Run `npm run sync:contracts` after regenerating the
 * backend JSON Schema, or `npm run check:contracts` in verification.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const source = resolve(
  repoRoot,
  'apps/web/src/generated/newsTraceContracts.ts',
)
const target = resolve(here, '..', 'src/contracts/newsTrace.ts')
const checkOnly = process.argv.includes('--check')

const generated = await readFile(source, 'utf8')

if (checkOnly) {
  let current
  try {
    current = await readFile(target, 'utf8')
  } catch {
    console.error(`Missing ${target}. Run \`npm run sync:contracts\`.`)
    process.exitCode = 1
    process.exit()
  }
  if (current !== generated) {
    console.error(
      'frontend/src/contracts/newsTrace.ts is out of date. Run `npm run sync:contracts` from frontend/.',
    )
    process.exitCode = 1
  } else {
    console.log('Shared contract DTOs are in sync.')
  }
} else {
  await writeFile(target, generated, 'utf8')
  console.log(`Wrote ${target}`)
}
