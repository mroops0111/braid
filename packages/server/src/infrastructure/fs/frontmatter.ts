import { parse as parseYaml } from 'yaml'

const FRONTMATTER_DELIMITER = '---'

export interface MarkdownDocument<T> {
  readonly frontmatter: T
  readonly body: string
}

/**
 * Splits a markdown file into YAML frontmatter + body. Wraps the YAML
 * between `---` delimiters on their own lines at the top of the file.
 * Keys are normalised from kebab-case (YAML convention, used by Claude
 * Code itself) to camelCase (TS convention) recursively so Zod schemas
 * can declare fields naturally in TS.
 */
export function parseMarkdownFrontmatter<T>(content: string): MarkdownDocument<T> {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error('Frontmatter must start with "---" on the first line')
  }
  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      closingIndex = index
      break
    }
  }
  if (closingIndex === -1) {
    throw new Error('Unterminated YAML frontmatter (missing closing "---")')
  }
  const yamlSource = lines.slice(1, closingIndex).join('\n')
  const body = lines.slice(closingIndex + 1).join('\n')
  const raw = parseYaml(yamlSource) as unknown
  return { frontmatter: normaliseKeys(raw) as T, body }
}

function kebabToCamelCase(key: string): string {
  return key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

function normaliseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normaliseKeys)
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[kebabToCamelCase(key)] = normaliseKeys(nested)
    }
    return result
  }
  return value
}
