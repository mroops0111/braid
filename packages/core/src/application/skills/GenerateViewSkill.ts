import type { SkillId, ViewArtifact, ViewKind, WorkspaceId } from '@telos/schema'
import type { GenerationService } from '../GenerationService.js'
import { z } from 'zod'
import { Skill } from '../Skill.js'

const InputSchema = z.object({
  workspaceId: z.string().min(1),
  viewKind: z.string().min(1),
  config: z.unknown(),
})

type GenerateViewSkillInput = z.infer<typeof InputSchema>

export class GenerateViewSkill extends Skill<GenerateViewSkillInput, ViewArtifact> {
  readonly id = 'generateView' as SkillId
  readonly inputSchema = InputSchema

  constructor(private readonly generationService: GenerationService) {
    super()
  }

  async execute(input: GenerateViewSkillInput): Promise<ViewArtifact> {
    return this.generationService.render(
      input.workspaceId as WorkspaceId,
      input.viewKind as ViewKind,
      input.config,
    )
  }
}
