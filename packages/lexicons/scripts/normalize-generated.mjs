#!/usr/bin/env node
// Committed lexicons must be byte-identical on every platform; the import
// specifier fix lives in normalize-specifiers.mjs so the contract test shares it.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSpecifiers } from './normalize-specifiers.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'src', 'lexicons')

async function findTs(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await findTs(path)))
    } else if (entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }
  return files
}

let changed = 0
for (const file of await findTs(outDir)) {
  const source = await readFile(file, 'utf8')
  const normalized = normalizeSpecifiers(source)
  if (normalized !== source) {
    await writeFile(file, normalized)
    changed += 1
  }
}

console.log(`Normalized import specifiers in ${changed} generated file(s)`)
