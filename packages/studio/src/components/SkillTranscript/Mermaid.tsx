import { useEffect, useRef, useState } from 'react'

interface MermaidProps {
  definition: string
}

let counter = 0
const nextId = () => `mermaid-${++counter}`

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

function resolveColor(cssVar: string): string {
  // Mermaid (via khroma) does not parse oklch().
  // It understands hex, rgb, hsl, and named colors only.
  // Modern browsers keep oklch in computed style,
  // and do not auto-convert to rgb,
  // so we push the value through a 1x1 canvas.
  // The canvas always quantises to sRGB rgba,
  // so reading imageData back gives integer rgb,
  // regardless of the input colour space.
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim()
  if (!raw)
    return 'rgb(128, 128, 128)'
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return 'rgb(128, 128, 128)'
  ctx.fillStyle = raw
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

function loadMermaid() {
  if (mermaidPromise)
    return mermaidPromise
  mermaidPromise = import('mermaid').then((mod) => {
    const lib = mod.default
    const v = resolveColor
    lib.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: '"Inter Variable", system-ui, sans-serif',
      themeVariables: {
        background: 'transparent',
        primaryColor: v('--card'),
        primaryTextColor: v('--foreground'),
        primaryBorderColor: v('--border'),
        lineColor: v('--muted-foreground'),
        secondaryColor: v('--muted'),
        tertiaryColor: v('--accent'),
        mainBkg: v('--card'),
        secondBkg: v('--muted'),
        tertiaryBkg: v('--accent'),
        nodeBorder: v('--border'),
        clusterBkg: v('--background'),
        clusterBorder: v('--border'),
        edgeLabelBackground: v('--background'),
        labelBackground: v('--background'),
        labelTextColor: v('--foreground'),
        nodeTextColor: v('--foreground'),
        fontSize: '13px',
      },
    })
    return lib
  })
  return mermaidPromise
}

export function Mermaid({ definition }: MermaidProps) {
  const idRef = useRef(nextId())
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const mermaid = await loadMermaid()
        const { svg } = await mermaid.render(idRef.current, definition)
        if (!cancelled)
          setSvg(svg)
      }
      catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [definition])

  if (error) {
    return (
      <div className="my-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 font-mono text-[11px] text-rose-300">
        <div className="mb-1 font-semibold">Mermaid render error</div>
        <pre className="whitespace-pre-wrap">{error}</pre>
        <pre className="mt-2 whitespace-pre-wrap opacity-70">{definition}</pre>
      </div>
    )
  }

  if (!svg)
    return <div className="my-2 h-12 animate-pulse rounded bg-muted/30" />

  return (
    <div
      className="my-3 overflow-x-auto rounded-lg border border-border bg-card/50 px-3 py-4 [&_svg]:mx-auto [&_svg]:max-w-full [&_text]:!font-sans"
      // mermaid sanitises with securityLevel: 'strict'
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
