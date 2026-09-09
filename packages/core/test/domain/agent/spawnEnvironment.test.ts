import { describe, expect, it } from 'vitest'
import { inheritableSpawnEnvironment } from '../../../src/domain/agent/spawnEnvironment.js'

describe('inheritableSpawnEnvironment', () => {
  it('carries what an agent needs to find and run its binary', () => {
    const env = inheritableSpawnEnvironment({ PATH: '/usr/bin', HOME: '/home/ada' })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/ada' })
  })

  // The deployment's own secrets sit in this environment,
  // and a skill's prompt is written by whoever can edit the workspace.
  it('leaves the server\'s credentials behind', () => {
    const env = inheritableSpawnEnvironment({
      PATH: '/usr/bin',
      GIT_TOKEN: 'ghp-secret',
      BRAID_GOOGLE_CLIENT_SECRET: 'google-secret',
      BRAID_OIDC_CLIENT_SECRET: 'oidc-secret',
      BRAID_MCP_GATEWAY_CLIENT_SECRET: 'gateway-secret',
    })
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  // The agent authenticates from what its caller passes in,
  // so inheriting one would spend an account nobody chose for the run.
  it('leaves the agent credentials behind as well', () => {
    const env = inheritableSpawnEnvironment({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-key',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
      ANTHROPIC_BASE_URL: 'https://elsewhere.example',
    })
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  // An allowlist has to stay one.
  // A name added to the deployment tomorrow must not arrive by default,
  // which is the whole reason for the shape.
  it('drops a name it has never heard of', () => {
    expect(inheritableSpawnEnvironment({ SOMETHING_NEW: 'value' })).toEqual({})
  })

  it('carries the proxy and certificate settings a network needs', () => {
    const env = inheritableSpawnEnvironment({
      HTTPS_PROXY: 'http://proxy:3128',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/corp.pem',
    })
    expect(env).toEqual({
      HTTPS_PROXY: 'http://proxy:3128',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/corp.pem',
    })
  })

  // `undefined` is how Node reports an unset name,
  // and passing it through puts the string "undefined" in the child.
  // Asserted by absence.
  // A value of `undefined` compares equal to a missing key,
  // and would pass while the key was still there.
  it('omits a name that is present but unset', () => {
    const env = inheritableSpawnEnvironment({ PATH: undefined, HOME: '/home/ada' })
    expect(Object.keys(env)).toEqual(['HOME'])
  })
})
