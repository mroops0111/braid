// Enough of the front to recognise what kind of credential it is,
// and enough of the back to tell two of your own apart.
const HEAD = 12
const TAIL = 6

// Below this, showing both ends would give away most of the value,
// so only the last few characters are shown.
const SHORT = HEAD + TAIL + 8
const SHORT_TAIL = 4

/**
 * The form of a credential a reader is allowed to see.
 *
 * Derived on every read rather than stored beside the credential,
 * so the shape has one definition and changing it needs no migration.
 */
export function maskCredential(credential: string): string {
  if (credential.length <= SHORT)
    return `…${credential.slice(-SHORT_TAIL)}`
  return `${credential.slice(0, HEAD)}…${credential.slice(-TAIL)}`
}
