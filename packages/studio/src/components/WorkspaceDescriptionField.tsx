import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

interface WorkspaceDescriptionFieldProps {
  id: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

/**
 * Shared editor for `productManifest.description`. Used by both the
 * create-workspace wizard and the workspace details sheet so the
 * surface, hint text, and supported syntax stay consistent across
 * create + edit. Multiline so authors can paragraph; Markdown is
 * preserved verbatim into PRODUCT.md and rendered wherever a viewer
 * surfaces it.
 */
export function WorkspaceDescriptionField({ id, value, onChange, disabled }: WorkspaceDescriptionFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Description (optional)</Label>
      <Textarea
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="What is this workspace about? Markdown supported."
        rows={4}
        disabled={disabled}
        className="resize-y"
      />
      <p className="text-[10px] text-muted-foreground">Stored in PRODUCT.md.</p>
    </div>
  )
}
