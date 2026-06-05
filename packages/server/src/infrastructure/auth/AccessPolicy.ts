import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ValidationError } from '@braidhq/core'
import { z } from 'zod'

const Invite = z.object({
  email: z.string().email().transform(s => s.toLowerCase()),
  invitedAt: z.string().datetime({ offset: true }),
  /**
   * Initial server role to apply when the invite is redeemed. Defaults
   * to `user` so an admin who invites someone is making a deliberate
   * choice when they pick `admin`.
   */
  serverRole: z.enum(['admin', 'user']).default('user'),
  /**
   * Per-user override of `canCreateWorkspace`. Defaults to `false` so
   * default users can only join workspaces, not create them — this is
   * the documented v0.2 stance for Gate 3.
   */
  canCreateWorkspace: z.boolean().default(false),
})
export type Invite = z.infer<typeof Invite>

const Content = z.object({
  invites: z.array(Invite).default([]),
})
type Content = z.infer<typeof Content>

export interface AccessDecision {
  readonly allow: boolean
  /**
   * Human-readable reason. Surfaced to the user when access is denied
   * so they can self-diagnose ("not in allowlist", "no invite found").
   * Suppressed when `allow=true`.
   */
  readonly reason?: string
  /**
   * For allowed access — whether this user's email matched an invite.
   * When true, the caller redeems the invite via `consumeInvite` after
   * creating the user record.
   */
  readonly viaInvite?: Invite
}

export interface AccessPolicyConfig {
  /** Comma-separated list of allowed email domains (e.g. "kdanmobile.com,example.com"). */
  readonly allowedDomains?: readonly string[]
  /** Comma-separated allowlist of specific emails (per-user, not domain-based). */
  readonly allowedEmails?: readonly string[]
  /** Comma-separated list of admin email addresses. Matched users get serverRole='admin'. */
  readonly adminEmails?: readonly string[]
}

/**
 * Gate 1: decides whether a Google account is allowed to log in to this
 * Braid server. Composed of two layers:
 *
 *   1. **Static allowlist** — `BRAID_ALLOWED_DOMAINS` / `BRAID_ALLOWED_EMAILS`
 *      env vars. Domain matches (`@kdanmobile.com`) auto-pass, email
 *      matches (`alice@example.com`) auto-pass. Free to leave both
 *      unset on a public instance; combined with an empty invite list
 *      this rejects everyone — fail closed.
 *
 *   2. **Invite list** — `${BRAID_HOME}/access.json` maintained by admin
 *      via `/admin/invites` (Phase B/C admin UI). One invite per email;
 *      consumed on first successful login.
 *
 * The policy is open for either path: domain pass OR invite present.
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
   * Evaluate against the current allowlist + invite file. Reads the
   * invite file every call: invite mgmt is low-frequency and a stale
   * cache would create a frustrating race (admin invites Bob, Bob
   * logs in, server still says "no").
   */
  async decide(email: string): Promise<AccessDecision> {
    const lower = email.toLowerCase()
    if (this.allowedEmails.has(lower))
      return { allow: true }
    const domain = lower.split('@')[1] ?? ''
    if (domain && this.allowedDomains.has(domain))
      return { allow: true }

    const invites = await this.readInvites()
    const invite = invites.find(i => i.email === lower)
    if (invite)
      return { allow: true, viaInvite: invite }

    return {
      allow: false,
      reason: 'This Google account is not authorized to sign in. Ask an admin to invite you.',
    }
  }

  /**
   * Whether the email should be marked `serverRole='admin'` on the
   * resulting user record. Independent of `decide` — invites carry
   * their own role override, and an admin email might also be the
   * allowlist path with no invite.
   */
  isAdmin(email: string): boolean {
    return this.adminEmails.has(email.toLowerCase())
  }

  async listInvites(): Promise<Invite[]> {
    return this.readInvites()
  }

  async addInvite(input: { email: string, serverRole?: 'admin' | 'user', canCreateWorkspace?: boolean }): Promise<Invite> {
    const lower = input.email.toLowerCase()
    const content = await this.readContent()
    if (content.invites.some(i => i.email === lower))
      throw new ValidationError(`Invite for "${lower}" already exists`)
    const invite: Invite = {
      email: lower,
      invitedAt: new Date().toISOString(),
      serverRole: input.serverRole ?? 'user',
      canCreateWorkspace: input.canCreateWorkspace ?? false,
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
    await this.writeContent({ invites: filtered })
  }

  /** Consume an invite once the user record exists. Idempotent. */
  async consumeInvite(email: string): Promise<void> {
    await this.removeInvite(email)
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
        return { invites: [] }
      throw error
    }
  }

  private async writeContent(content: Content): Promise<void> {
    await mkdir(dirname(this.invitesPath), { recursive: true })
    await writeFile(this.invitesPath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }
}
