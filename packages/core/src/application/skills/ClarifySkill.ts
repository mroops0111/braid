import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  Decision,
  SkillId,
  UserId,
  WorkspaceId,
} from '@telos/schema'
import type { HITLService } from '../HITLService.js'
import { z } from 'zod'
import { Skill } from '../Skill.js'

const InputSchema = z.object({
  clarifyTicketId: z.string().min(1),
  candidateId: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
})

type ClarifySkillInput = z.infer<typeof InputSchema>

export class ClarifySkill extends Skill<ClarifySkillInput, Decision> {
  readonly id = 'clarify' as SkillId
  readonly inputSchema = InputSchema

  constructor(private readonly hitlService: HITLService) {
    super()
  }

  async execute(input: ClarifySkillInput): Promise<Decision> {
    return this.hitlService.answerClarifyTicket(
      input.clarifyTicketId as ClarifyTicketId,
      input.candidateId as ClarifyCandidateId,
      input.workspaceId as WorkspaceId,
      input.userId as UserId,
    )
  }
}
