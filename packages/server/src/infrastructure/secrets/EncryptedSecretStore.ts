import type { SecretStore } from './SecretStore.js'
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const KEY_BYTES = 32
const ENVELOPE_VERSION = 1

interface Envelope {
  readonly v: number
  readonly nonce: string
  readonly ciphertext: string
  readonly tag: string
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null)
    return false
  const candidate = value as Partial<Envelope>
  return candidate.v === ENVELOPE_VERSION
    && typeof candidate.nonce === 'string'
    && typeof candidate.ciphertext === 'string'
    && typeof candidate.tag === 'string'
}

/**
 * Reads a key the deployment supplies, and refuses to run without one.
 *
 * A generated or defaulted key encrypts to something the code can open,
 * which reads as protection while offering none.
 */
export function readSecretKey(raw: string | undefined, name: string): Buffer {
  if (!raw)
    throw new Error(`${name} is required to store credentials. Generate one with \`openssl rand -base64 32\`.`)
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES)
    throw new Error(`${name} must be ${KEY_BYTES} bytes, base64 encoded. Got ${key.length}.`)
  return key
}

export interface EncryptedSecretStoreDeps {
  readonly inner: SecretStore
  readonly key: Buffer
  /**
   * Opens records written under a key being rotated away from,
   * and never writes with it.
   * A record read this way is rewritten under the current key,
   * so a rotation completes by use rather than by a migration step.
   */
  readonly previousKey?: Buffer
}

/**
 * Encrypts what another store holds, without changing what it is asked.
 *
 * The namespace and key are bound in as additional data,
 * so a record moved onto another person's path fails to open,
 * rather than resolving as theirs.
 * That turns a filesystem rename from an escalation into an error.
 */
export class EncryptedSecretStore implements SecretStore {
  constructor(private readonly deps: EncryptedSecretStoreDeps) {}

  async read<T>(namespace: string, key: string): Promise<T | undefined> {
    const stored = await this.deps.inner.read<unknown>(namespace, key)
    if (stored === undefined)
      return undefined
    if (!isEnvelope(stored))
      throw new Error(`Secret at ${namespace}/${key} is not encrypted. Refusing to read it as plaintext.`)

    const current = this.open(stored, namespace, key, this.deps.key)
    if (current !== undefined)
      return JSON.parse(current) as T

    const previous = this.deps.previousKey
      ? this.open(stored, namespace, key, this.deps.previousKey)
      : undefined
    if (previous === undefined)
      throw new Error(`Secret at ${namespace}/${key} could not be opened with the configured key.`)

    // Rewritten under the current key, so a rotation finishes by use,
    // rather than needing a pass over the whole store.
    await this.write(namespace, key, JSON.parse(previous))
    return JSON.parse(previous) as T
  }

  async write(namespace: string, key: string, value: unknown): Promise<void> {
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.deps.key, nonce)
    cipher.setAAD(Buffer.from(`${namespace}/${key}`, 'utf-8'))
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf-8'),
      cipher.final(),
    ])
    const envelope: Envelope = {
      v: ENVELOPE_VERSION,
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    }
    await this.deps.inner.write(namespace, key, envelope)
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.deps.inner.delete(namespace, key)
  }

  /** Undefined where this key does not open it, which is not an error yet. */
  private open(envelope: Envelope, namespace: string, key: string, secret: Buffer): string | undefined {
    try {
      const decipher = createDecipheriv(ALGORITHM, secret, Buffer.from(envelope.nonce, 'base64'))
      decipher.setAAD(Buffer.from(`${namespace}/${key}`, 'utf-8'))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf-8')
    }
    catch {
      return undefined
    }
  }
}
