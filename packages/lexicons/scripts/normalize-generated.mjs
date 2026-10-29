#!/usr/bin/env node
// The lex builder derives import specifiers with node:path.relative, which
// emits backslashes on Windows. Committed output must stay POSIX so the same
// files typecheck on Linux runners.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const normalized = source.replace(
    /(from\s+")([^"]+)(")/g,
    (_, before, specifier, after) =>
      `${before}${specifier.replaceAll('\\', '/')}${after}`,
  )
  if (normalized !== source) {
    await writeFile(file, normalized)
    changed += 1
  }
}

console.log(`Normalized import specifiers in ${changed} generated file(s)`)
