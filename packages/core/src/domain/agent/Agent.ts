import type { PluginId, PluginType } from '@telos/schema'
import type { z } from 'zod'
import type { PluginContext } from '../plugin/Plugin.js'

export interface AgentCapabilities {
  streaming: boolean
  tools: boolean
  longContext: boolean
  maxInputTokens?: number
  maxOutputTokens?: number
}

export interface AgentInvocation {
  task: string
  prompt: string
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

export interface AgentChunk {
  type: 'text' | 'done' | 'error'
  text?: string
  error?: string
}

export interface Agent {
  id: PluginId
  type: Extract<PluginType, 'agent'>
  configSchema: z.ZodSchema
  capabilities: AgentCapabilities
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
  invoke: (invocation: AgentInvocation) => AsyncIterable<AgentChunk>
}
