import type { McpGatewayResolution, McpUnrequestedReason } from './mcpGatewaySettings.js'

/**
 * What a reader is told about the endpoint.
 *
 * Boot decides whether there is one at all, and the gateway decides
 * whether it is answering, so the two axes collapse into one state.
 * A deployment that resolved `ready` can still be `unreachable`,
 * because the gateway is a supervised process that restarts.
 */
export type McpEndpointState = 'ready' | 'unreachable' | 'incomplete' | McpUnrequestedReason

export interface McpEndpointStatus {
  readonly state: McpEndpointState
  /** Null where there is no endpoint to reach. */
  readonly endpointUrl: string | null
  /** What an `incomplete` deployment is waiting on, empty otherwise. */
  readonly missing: readonly string[]
}

export interface McpEndpointStatusInput {
  readonly resolution: McpGatewayResolution
  /** Absent where the deployment never learned its own public name. */
  readonly endpointUrl: string | null
  /** Loopback probe, so a crashed gateway does not read as ready. */
  readonly reachable: () => Promise<boolean>
}

export async function readMcpEndpointStatus(
  input: McpEndpointStatusInput,
): Promise<McpEndpointStatus> {
  const { resolution } = input
  switch (resolution.kind) {
    case 'unrequested':
      return { state: resolution.reason, endpointUrl: null, missing: [] }
    case 'incomplete':
      return { state: 'incomplete', endpointUrl: null, missing: resolution.missing }
    case 'ready': {
      const reachable = await input.reachable()
      return {
        state: reachable ? 'ready' : 'unreachable',
        endpointUrl: input.endpointUrl,
        missing: [],
      }
    }
    default: {
      const exhaustive: never = resolution
      throw new Error(`Unhandled: ${JSON.stringify(exhaustive)}`)
    }
  }
}
