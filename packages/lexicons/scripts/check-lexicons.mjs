#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lexiconDocumentSchema } from '@atproto/lex-document'

const root = fileURLToPath(new URL('..', import.meta.url))
const lexiconDir = join(root, 'lexicons')
const namespace = 'com.selfcommand.admin'
const knownRoles = new Set(['admin', 'operator', 'viewer'])
const knownResults = new Set(['success', 'denied', 'error'])

async function findJson(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await findJson(path)))
    } else if (entry.name.endsWith('.json')) {
      files.push(path)
    }
  }
  return files
}

const errors = []
const documents = new Map()

for (const file of await findJson(lexiconDir)) {
  const rel = relative(lexiconDir, file).split(sep).join('/')
  let json
  try {
    json = JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    errors.push(`${rel}: invalid JSON (${err.message})`)
    continue
  }
  const parsed = lexiconDocumentSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.reason?.issues
      ?.map((issue) => `${issue.path?.join('.') ?? ''} ${issue.message}`)
      .join('; ')
    errors.push(`${rel}: invalid lexicon document (${issues ?? parsed.reason})`)
    continue
  }
  const id = parsed.value.id
  if (!id.startsWith(`${namespace}.`)) {
    errors.push(`${rel}: id "${id}" is outside namespace ${namespace}`)
  }
  const expected = `${id.split('.').join('/')}.json`
  if (rel !== expected) {
    errors.push(`${rel}: path does not match id ${id} (expected ${expected})`)
  }
  documents.set(id, { rel, doc: parsed.value })
}

for (const [id, { rel, doc }] of documents) {
  const defs = doc.defs ?? {}
  for (const [name, def] of Object.entries(defs)) {
    const problems = []
    if (def.type === 'query' || def.type === 'procedure') {
      const errorNames = new Set()
      for (const error of def.errors ?? []) {
        if (errorNames.has(error.name)) {
          problems.push(`duplicate error name ${error.name}`)
        }
        errorNames.add(error.name)
      }
    }
    for (const issue of problems) {
      errors.push(`${rel}#${name}: ${issue}`)
    }
  }
  for (const ref of collectRefs(doc)) {
    const [targetId, targetDef] = ref.startsWith('#')
      ? [id, ref.slice(1)]
      : ref.split('#')
    const target = documents.get(targetId)
    if (!target) {
      errors.push(`${rel}: references unknown document ${targetId}`)
      continue
    }
    if (targetDef && !(targetDef in (target.doc.defs ?? {}))) {
      errors.push(`${rel}: references unknown definition ${targetId}#${targetDef}`)
    }
  }
  checkKnownValues(rel, doc, errors)
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`)
  process.exit(1)
}

const methods = [...documents.keys()].filter((id) => id !== `${namespace}.defs`)
console.log(
  `Lexicon check passed: ${documents.size} document(s), ${methods.length} method(s)`,
)
console.log(`Methods: ${methods.sort().join(', ')}`)

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs)
  } else if (value && typeof value === 'object') {
    if (typeof value.ref === 'string') refs.push(value.ref)
    for (const item of Object.values(value)) collectRefs(item, refs)
  }
  return refs
}

function checkKnownValues(rel, doc, problems) {
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (!value || typeof value !== 'object') return
    if (
      value.type === 'string' &&
      Array.isArray(value.knownValues) &&
      path.endsWith('role') &&
      value.knownValues.some((role) => !knownRoles.has(role))
    ) {
      problems.push(`${rel}: ${path} declares a role outside the role matrix`)
    }
    if (
      value.type === 'string' &&
      Array.isArray(value.knownValues) &&
      path.endsWith('result') &&
      value.knownValues.some((result) => !knownResults.has(result))
    ) {
      problems.push(`${rel}: ${path} declares an unknown audit result`)
    }
    for (const [key, item] of Object.entries(value)) {
      walk(item, path ? `${path}.${key}` : key)
    }
  }
  walk(doc, '')
}
