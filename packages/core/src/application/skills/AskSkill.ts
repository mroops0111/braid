import type { SkillId, WorkspaceId } from '@telos/schema'
import type { QAResult, QAService } from '../QAService.js'
import { z } from 'zod'
import { Skill } from '../Skill.js'

const InputSchema = z.object({
  text: z.string().min(1),
  workspaceId: z.string().min(1),
  askedBy: z.string().min(1),
  channel: z.string().min(1),
})

type AskSkillInput = z.infer<typeof InputSchema>

export class AskSkill extends Skill<AskSkillInput, QAResult> {
  readonly id = 'ask' as SkillId
  readonly inputSchema = InputSchema

  constructor(private readonly qaService: QAService) {
    super()
  }

  async execute(input: AskSkillInput): Promise<QAResult> {
    return this.qaService.ask(
      input.text,
      input.workspaceId as WorkspaceId,
      { askedBy: input.askedBy as never, channel: input.channel as never },
    )
  }
}
