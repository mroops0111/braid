import type { ReactNode } from 'react'

/**
 * Surfaced when the user picks a loader kind that the server registered,
 * but Studio has no per-field config form for.
 * The dialog stays usable for the known kinds,
 * and tells the user what to do about the unknown one in the passed `hint`.
 * That hint differs between the add-source flow,
 * where the workspace exists and you edit PRODUCT.md directly,
 * and the scaffold flow,
 * where the workspace does not exist yet,
 * and you scaffold with the source as manual first.
 */
export function UnknownLoaderWarning({ kind, hint }: { kind: string, hint: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-300">
      <p className="font-medium">
        Loader "
        {kind}
        " has no Studio form yet.
      </p>
      <p className="mt-1 text-muted-foreground">{hint}</p>
    </div>
  )
}
