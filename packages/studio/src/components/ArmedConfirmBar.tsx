import type React from 'react'
import { Button } from './ui/button'

interface ArmedConfirmBarProps {
  message: React.ReactNode
  confirmLabel: string
  confirmTone: 'primary' | 'destructive'
  disabled: boolean
  onCancel: () => void
  onConfirm: () => void
  errorMessage?: string | null
}

/**
 * Two-step destructive confirm pattern used across Settings,
 * and Workspace Details.
 * The first click arms the action elsewhere,
 * and this bar renders the message and the [Cancel] plus confirm pair.
 */
export function ArmedConfirmBar({
  message,
  confirmLabel,
  confirmTone,
  disabled,
  onCancel,
  onConfirm,
  errorMessage,
}: ArmedConfirmBarProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{message}</p>
      {errorMessage && <p className="text-[11px] text-destructive">{errorMessage}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
        <Button
          size="sm"
          className={confirmTone === 'destructive'
            ? 'h-7 text-[11px] bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'h-7 text-[11px]'}
          onClick={onConfirm}
          disabled={disabled}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
