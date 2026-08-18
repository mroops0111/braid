import { MentionTextarea } from './references/MentionTextarea'
import { Label } from './ui/label'

interface MarkdownDescriptionFieldProps {
  id: string
  value: string
  onChange: (next: string) => void
  label?: string
  placeholder?: string
  helperText?: string
  rows?: number
  disabled?: boolean
}

/**
 * Shared multiline editor for Markdown text fields persisted to PRODUCT.md.
 * Workspace, per-source, and per-MCP descriptions all use this,
 * so the surface, sizing, and hint stay consistent across create and edit.
 * The agent reads the same raw text at skill runtime,
 * so the placeholder coaches authors to write something it can act on.
 */
export function MarkdownDescriptionField({
  id,
  value,
  onChange,
  label = 'Description (optional)',
  placeholder = 'What is this about? Markdown supported.',
  helperText = 'Stored in PRODUCT.md and visible to skills at run time.',
  rows = 4,
  disabled,
}: MarkdownDescriptionFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <MentionTextarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        {...(disabled === undefined ? {} : { disabled })}
      />
      {helperText && <p className="text-2xs text-muted-foreground">{helperText}</p>}
    </div>
  )
}
