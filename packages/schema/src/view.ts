import { z } from 'zod'

export const ViewKind = z.string().min(1).brand<'ViewKind'>()
export type ViewKind = z.infer<typeof ViewKind>

export const ViewArtifactFormat = z.string().min(1).brand<'ViewArtifactFormat'>()
export type ViewArtifactFormat = z.infer<typeof ViewArtifactFormat>

/** v1 ships text-only artifacts. Binary support (PDF / image) lands in v2, via a separate contentBase64 field. */
export const ViewArtifactFile = z.object({
  path: z.string().min(1),
  text: z.string(),
})
export type ViewArtifactFile = z.infer<typeof ViewArtifactFile>

export const ViewArtifact = z.object({
  kind: ViewKind,
  format: ViewArtifactFormat,
  files: z.array(ViewArtifactFile),
})
export type ViewArtifact = z.infer<typeof ViewArtifact>
