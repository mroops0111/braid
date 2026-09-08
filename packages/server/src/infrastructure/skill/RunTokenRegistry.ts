import type { SkillRunId, UserId } from '@braidhq/schema'
import type { AccessTokenVerifier, VerifiedCaller } from '../auth/AccessTokenVerifier.js'
import { randomUUID } from 'node:crypto'

/**
 * The credential a running skill calls back with.
 *
 * A run's own identity is a fact the server holds, so nothing should have to
 * be told it, least of all the agent. The gateway that carries a skill's calls
 * cannot add a header of its own, but it does carry a bearer token, so the
 * token is where the run identity rides. A route then reads which run is
 * calling from the request rather than from a field the model filled in, and a
 * model that is confused about which run it is cannot mis-attribute its work.
 *
 * The token also stands for the person the run was started by, so a skill
 * reaches exactly what its author could reach, as it did when it carried their
 * own token.
 *
 * Held in memory only. A run does not outlive the process that spawned it, so
 * neither should the credential that lets it call home.
 */
export class RunTokenRegistry implements AccessTokenVerifier {
  private readonly byToken = new Map<string, { runId: SkillRunId, userId: UserId }>()
  private readonly byRun = new Map<SkillRunId, string>()

  issue(runId: SkillRunId, userId: UserId): string {
    const existing = this.byRun.get(runId)
    if (existing)
      return existing
    const token = `braid-run.${randomUUID()}`
    this.byToken.set(token, { runId, userId })
    this.byRun.set(runId, token)
    return token
  }

  /** Called when a run ends, so a finished run's token stops opening doors. */
  revoke(runId: SkillRunId): void {
    const token = this.byRun.get(runId)
    if (!token)
      return
    this.byRun.delete(runId)
    this.byToken.delete(token)
  }

  // Null rather than a throw for anything else, since another verifier may
  // recognise it. Only this prefix is ours to judge.
  async verify(token: string): Promise<VerifiedCaller | null> {
    const held = this.byToken.get(token)
    if (!held)
      return null
    return { userId: held.userId, skillRunId: held.runId }
  }
}
