import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  text: string
}

const components: NonNullable<Parameters<typeof ReactMarkdown>[0]['components']> = {
  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-base font-semibold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-sm font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-sm font-semibold text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>,
  p: ({ children }) => <p className="my-1.5">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 ml-5 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-5 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ className, children }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code className={cn('font-mono text-[11px] leading-relaxed', className)}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-foreground">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-card p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border text-muted-foreground">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/40">{children}</tr>,
  th: ({ children, style }) => (
    <th style={style} className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wider">
      {children}
    </th>
  ),
  td: ({ children, style }) => <td style={style} className="px-2 py-1 align-top">{children}</td>,
}

/**
 * Renders a SkillEvent message body as GitHub-flavored markdown. Uses the
 * transcript's surrounding `font-mono text-xs` only for inline code / pre
 * blocks; the prose itself switches to the app sans font so headings, lists
 * and tables read naturally inside the otherwise terminal-style transcript.
 */
export function Markdown({ text }: MarkdownProps) {
  return (
    <div className="font-sans text-sm leading-relaxed text-foreground/95">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
