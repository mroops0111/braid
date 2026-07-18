import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ValidationError } from '@braidhq/core'
import { z } from 'zod'

const Invite = z.object({
  email: z.string().email().transform(s => s.toLowerCase()),
  invitedAt: z.string().datetime({ offset: true }),
  // Initial server role applied when the invite is redeemed.
  // Defaults to `user`, so an admin who picks `admin` is making a deliberate choice.
  serverRole: z.enum(['admin', 'user']).default('user'),
})
export type Invite = z.infer<typeof Invite>

const Content = z.object({
  invites: z.array(Invite).default([]),
  // Emails that have already redeemed an invite (or been approved directly),
  // and are persistently allowed to sign in.
  // Without this, an invite would be a one-shot ticket,
  // gone after the first login, locking the user out on the second.
  // Treat this as the "dynamic allowlist" that grows as invites get consumed,
  // revoking a user removes their entry here.
  approvedEmails: z.array(z.string().email().transform(s => s.toLowerCase())).default([]),
})
type Content = z.infer<typeof Content>

export interface AccessDecision {
  readonly allow: boolean
  // Human-readable reason surfaced when access is denied,
  // so the user can self-diagnose ("not in allowlist", "no invite found").
  // Suppressed when `allow=true`.
  readonly reason?: string
  // For allowed access, whether this user's email matched an invite.
  // When true, the caller redeems the invite via `consumeInvite` after creating the user record.
  readonly viaInvite?: Invite
}

export interface AccessPolicyConfig {
  // Allowed email domains (e.g. "kdanmobile.com,example.com").
  readonly allowedDomains?: readonly string[]
  // Allowlist of specific emails (per-user, not domain-based).
  readonly allowedEmails?: readonly string[]
  // Admin email addresses. Matched users get serverRole='admin'.
  readonly adminEmails?: readonly string[]
}

/**
 * Gate 1 decides whether a Google account may log in to this Braid server.
 * It composes two layers.
 *
 * The static allowlist reads the `BRAID_ALLOWED_DOMAINS` and `BRAID_ALLOWED_EMAILS` env vars.
 * Domain matches (`@kdanmobile.com`) and email matches (`alice@example.com`) auto-pass.
 * Both may be left unset on a public instance,
 * combined with an empty invite list this rejects everyone (fail closed).
 *
 * The invite list lives at `${BRAID_HOME}/access.json`, maintained by an admin via `/admin/invites`.
 * One invite per email, consumed on first successful login.
 *
 * The policy is open for either path, a domain pass OR an invite present.
 * That matches the "hybrid" Gate 1 the design picked.
 */
export class AccessPolicy {
  private readonly allowedDomains: ReadonlySet<string>
  private readonly allowedEmails: ReadonlySet<string>
  private readonly adminEmails: ReadonlySet<string>

  constructor(
    private readonly invitesPath: string,
    config: AccessPolicyConfig = {},
  ) {
    this.allowedDomains = new Set((config.allowedDomains ?? []).map(s => s.toLowerCase()))
    this.allowedEmails = new Set((config.allowedEmails ?? []).map(s => s.toLowerCase()))
    this.adminEmails = new Set((config.adminEmails ?? []).map(s => s.toLowerCase()))
  }

  /**
   * Evaluate against the current allowlist and invite file.
   * Reads the invite file every call, since invite management is low-frequency,
   * and a stale cache would create a frustrating race,
   * where an admin invites Bob, Bob logs in, and the server still says "no".
   */
  async decide(email: string): Promise<AccessDecision> {
    const lower = email.toLowerCase()
    if (this.allowedEmails.has(lower))
      return { allow: true }
    const domain = lower.split('@')[1] ?? ''
    if (domain && this.allowedDomains.has(domain))
      return { allow: true }

    const content = await this.readContent()
    // Approved (post-redemption) allowlist persists across logins.
    if (content.approvedEmails.includes(lower))
      return { allow: true }
    const invite = content.invites.find(i => i.email === lower)
    if (invite)
      return { allow: true, viaInvite: invite }

    return {
      allow: false,
      reason: 'This Google account is not authorized to sign in. Ask an admin to invite you.',
    }
  }

  /**
   * Whether the email should be marked `serverRole='admin'` on the resulting user record.
   * Independent of `decide`, since invites carry their own role override,
   * and an admin email might take the allowlist path with no invite.
   */
  isAdmin(email: string): boolean {
    return this.adminEmails.has(email.toLowerCase())
  }

  async listInvites(): Promise<Invite[]> {
    return this.readInvites()
  }

  async addInvite(input: { email: string, serverRole?: 'admin' | 'user' }): Promise<Invite> {
    const lower = input.email.toLowerCase()
    const content = await this.readContent()
    if (content.invites.some(i => i.email === lower))
      throw new ValidationError(`Invite for "${lower}" already exists`)
    const invite: Invite = {
      email: lower,
      invitedAt: new Date().toISOString(),
      serverRole: input.serverRole ?? 'user',
    }
    content.invites.push(invite)
    await this.writeContent(content)
    return invite
  }

  async removeInvite(email: string): Promise<void> {
    const lower = email.toLowerCase()
    const content = await this.readContent()
    const filtered = content.invites.filter(i => i.email !== lower)
    if (filtered.length === content.invites.length)
      return
    await this.writeContent({ ...content, invites: filtered })
  }

  /**
   * Consume an invite once the user record exists.
   * Remove it from invites,
   * add to approvedEmails so the user can sign in again without the admin re-inviting them.
   * Idempotent.
   */
  async consumeInvite(email: string): Promise<void> {
    const lower = email.toLowerCase()
    const content = await this.readContent()
    const invites = content.invites.filter(i => i.email !== lower)
    const approvedEmails = content.approvedEmails.includes(lower)
      ? content.approvedEmails
      : [...content.approvedEmails, lower]
    if (invites.length === content.invites.length && approvedEmails === content.approvedEmails)
      return
    await this.writeContent({ invites, approvedEmails })
  }

  /**
   * Add an email to the persistent allowlist directly, without going through the invite step.
   * Used by the bootstrap migration that back-fills approvedEmails,
   * for users who registered before this field existed.
   */
  async approveEmail(email: string): Promise<void> {
    const lower = email.toLowerCase()
    const content = await this.readContent()
    if (content.approvedEmails.includes(lower))
      return
    await this.writeContent({
      ...content,
      approvedEmails: [...content.approvedEmails, lower],
    })
  }

  /**
   * Drop an email from the persistent allowlist.
   * Called when an admin deletes a user,
   * so the underlying email can't sneak back in without a fresh invite.
   * Idempotent.
   */
  async revokeApproval(email: string): Promise<void> {
    const lower = email.toLowerCase()
    const content = await this.readContent()
    const filtered = content.approvedEmails.filter(e => e !== lower)
    if (filtered.length === content.approvedEmails.length)
      return
    await this.writeContent({ ...content, approvedEmails: filtered })
  }

  async listApprovedEmails(): Promise<string[]> {
    return (await this.readContent()).approvedEmails
  }

  private async readInvites(): Promise<Invite[]> {
    return (await this.readContent()).invites
  }

  private async readContent(): Promise<Content> {
    try {
      const raw = await readFile(this.invitesPath, 'utf-8')
      const parsed = Content.safeParse(JSON.parse(raw))
      if (!parsed.success)
        throw new ValidationError(`Invalid access file at "${this.invitesPath}": ${parsed.error.message}`)
      return parsed.data
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { invites: [], approvedEmails: [] }
      throw error
    }
  }

  private async writeContent(content: Content): Promise<void> {
    await mkdir(dirname(this.invitesPath), { recursive: true })
    await writeFile(this.invitesPath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }
}
