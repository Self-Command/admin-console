import { posix } from 'node:path'

// The lex builder derives import specifiers with node:path.relative, which
// emits backslashes and duplicate separators ("./..//") on Windows. Committed
// output must match what Linux runners generate byte for byte.
export function normalizeSpecifiers(source) {
  return source.replace(
    /(from\s+")([^"]+)(")/g,
    (_, before, specifier, after) => {
      const slashed = specifier.replaceAll('\\', '/')
      if (!slashed.startsWith('.')) return `${before}${slashed}${after}`
      const resolved = posix.normalize(slashed)
      const cleaned =
        resolved.startsWith('.') || !slashed.startsWith('./')
          ? resolved
          : `./${resolved}`
      return `${before}${cleaned}${after}`
    },
  )
}
