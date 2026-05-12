import { parse as parseYaml } from 'yaml'

const FRONTMATTER_DELIMITER = '---'

export interface MarkdownDocument<T> {
  readonly frontmatter: T
  readonly body: string
}

/**
 * Splits a markdown file into YAML frontmatter + body. The frontmatter must be
 * wrapped between `---` delimiters on their own lines, as the first content of
 * the file. Throws if the format is malformed.
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
  return { frontmatter: parseYaml(yamlSource) as T, body }
}
