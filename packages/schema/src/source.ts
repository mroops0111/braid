import { z } from 'zod'
import { PluginId, SourceId, SourceLocation } from './common.js'

export const SourceKind = z.enum(['intent', 'code', 'external'])
export type SourceKind = z.infer<typeof SourceKind>

export const SourceDescriptor = z.object({
  id: SourceId,
  pluginId: PluginId,
  kind: SourceKind,
  // Plugin's own configSchema validates this further; here we only carry it.
  config: z.unknown(),
})
export type SourceDescriptor = z.infer<typeof SourceDescriptor>

export const Scope = z.object({
  tokens: z.array(z.string()).default([]),
  pathGlobs: z.array(z.string()).default([]),
})
export type Scope = z.infer<typeof Scope>

export const IntentFragmentType = z.string().min(1).brand<'IntentFragmentType'>()
export type IntentFragmentType = z.infer<typeof IntentFragmentType>

export const IntentFragment = z.object({
  kind: z.literal('intent'),
  sourceId: SourceId,
  text: z.string(),
  location: SourceLocation,
  fragmentType: IntentFragmentType,
})
export type IntentFragment = z.infer<typeof IntentFragment>

export const CodeSymbol = z.object({
  file: z.string(),
  symbol: z.string(),
  language: z.string(),
})
export type CodeSymbol = z.infer<typeof CodeSymbol>

export const FactFragment = z.object({
  kind: z.literal('fact'),
  sourceId: SourceId,
  text: z.string(),
  location: SourceLocation,
  codeSymbol: CodeSymbol.optional(),
})
export type FactFragment = z.infer<typeof FactFragment>

export const SourceFragment = z.discriminatedUnion('kind', [IntentFragment, FactFragment])
export type SourceFragment = z.infer<typeof SourceFragment>
