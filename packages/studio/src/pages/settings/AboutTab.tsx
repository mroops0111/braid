export function AboutTab() {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p>
        Braid Studio
        {' '}
        {import.meta.env.VITE_BRAID_VERSION ?? 'dev'}
      </p>
      <p>
        Source-of-truth product knowledge platform. See
        {' '}
        <code className="font-mono">README.md</code>
        {' '}
        for usage.
      </p>
    </div>
  )
}
