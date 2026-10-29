import { build } from '@atproto/lex-builder'
import { lexiconDocumentSchema } from '@atproto/lex-document'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(packageRoot, 'lexicons')
const committedDir = join(packageRoot, 'src', 'lexicons')
const namespace = 'com.selfcommand.admin'

const expectedErrors: Record<string, string[]> = {
  [`${namespace}.role.list`]: ['Forbidden'],
  [`${namespace}.role.get`]: ['Forbidden', 'RoleNotFound'],
  [`${namespace}.role.create`]: ['Forbidden', 'RoleExists', 'InvalidRequest'],
  [`${namespace}.role.update`]: [
    'Forbidden',
    'RoleNotFound',
    'LastAdmin',
    'InvalidRequest',
  ],
  [`${namespace}.role.revoke`]: [
    'Forbidden',
    'RoleNotFound',
    'LastAdmin',
    'InvalidRequest',
  ],
  [`${namespace}.audit.list`]: ['Forbidden'],
  [`${namespace}.account.list`]: ['Forbidden'],
  [`${namespace}.account.get`]: ['Forbidden', 'AccountNotFound'],
  [`${namespace}.session.get`]: [],
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, base)))
    } else {
      files.push(relative(base, path).split(sep).join('/'))
    }
  }
  return files.sort()
}

function normalizeSpecifiers(source: string): string {
  return source.replace(
    /(from\s+")([^"]+)(")/g,
    (_, before, specifier, after) =>
      `${before}${specifier.replaceAll('\\', '/')}${after}`,
  )
}

const documents = new Map<string, Record<string, unknown>>()

for (const file of await listFiles(sourceDir)) {
  const raw = JSON.parse(await readFile(join(sourceDir, file), 'utf8'))
  const parsed = lexiconDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid lexicon ${file}: ${parsed.reason.message}`)
  }
  documents.set(parsed.value.id, raw)
}

const methodIds = [...documents.keys()]
  .filter((id) => id !== `${namespace}.defs`)
  .sort()

describe('lexicon documents', () => {
  test('every method lives in the approved namespace and declares its auth', () => {
    expect(methodIds).toHaveLength(9)
    for (const id of methodIds) {
      expect(id.startsWith(`${namespace}.`)).toBe(true)
      expect(documents.get(id)!.description).toContain(
        'com.atproto.server.getServiceAuth',
      )
    }
  })

  test('role and audit result values stay within the permission matrix', () => {
    const defs = documents.get(`${namespace}.defs`)!.defs as {
      roleName: { knownValues?: string[] }
      auditResult: { knownValues?: string[] }
    }
    expect(defs.roleName.knownValues).toEqual(['admin', 'operator', 'viewer'])
    expect(defs.auditResult.knownValues).toEqual([
      'success',
      'denied',
      'error',
    ])
  })

  test('error names match the reviewed contract', () => {
    const actual = Object.fromEntries(
      methodIds.map((id) => {
        const main = (
          documents.get(id)!.defs as {
            main: { errors?: { name: string }[] }
          }
        ).main
        return [id, (main.errors ?? []).map((error) => error.name)]
      }),
    )
    expect(actual).toEqual(expectedErrors)
  })

  test('generated types are in sync with the lexicon sources', async () => {
    const out = await mkdtemp(join(tmpdir(), 'lexgen-'))
    try {
      await build({
        lexicons: sourceDir,
        out,
        clear: true,
        lib: '@atproto/lex',
        indexFile: true,
        defaultExport: true,
      })
      const generated = await listFiles(out)
      const committed = await listFiles(committedDir)
      expect(generated).toEqual(committed)
      for (const file of generated) {
        const [fresh, current] = await Promise.all([
          readFile(join(out, file), 'utf8'),
          readFile(join(committedDir, file), 'utf8'),
        ])
        expect(normalizeSpecifiers(fresh), file).toBe(current)
      }
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })
})
