import type { MultiUserAppHandle } from '../helpers/multiUser.js'
import { describe, expect, it } from 'vitest'
import { asUser, asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'
import { readJson } from '../helpers/readJson.js'

interface MemberRow { userId: string, role: string }

async function membersOf(handle: MultiUserAppHandle): Promise<MemberRow[]> {
  const response = await handle.app.request(
    `/workspaces/${handle.workspaceId}/members`,
    asUser(handle.users.owner.id),
  )
  const body = await readJson<{ items: MemberRow[] }>(response)
  return body.items
}

async function onlyOwner(): Promise<MultiUserAppHandle> {
  const handle = await buildMultiUserApp({ members: { maintainer: false, guest: false } })
  expect((await membersOf(handle)).map(member => member.userId)).toEqual(['usr-owner'])
  return handle
}

describe('a workspace that starts admitting arrivals', () => {
  it('takes in the colleagues already registered here', async () => {
    const handle = await onlyOwner()
    const response = await handle.app.request(
      `/workspaces/${handle.workspaceId}`,
      asUserJson(handle.users.owner.id, 'PATCH', { autoJoinAs: 'guest' }),
    )
    expect(response.status).toBe(200)

    const members = await membersOf(handle)
    const joined = members.filter(member => member.role === 'guest').map(member => member.userId)
    expect(joined).toContain('usr-maint')
    expect(joined).toContain('usr-guest')
    // The reactor is a component of the deployment, not a colleague.
    expect(joined).not.toContain('reactor')
    // The owner was already a member and keeps the role they had.
    expect(members.find(member => member.userId === 'usr-owner')?.role).toBe('owner')
  })

  // Editing an unrelated field must not read as an instruction to open up.
  it('stays closed when the patch does not mention it', async () => {
    const handle = await onlyOwner()
    const response = await handle.app.request(
      `/workspaces/${handle.workspaceId}`,
      asUserJson(handle.users.owner.id, 'PATCH', { description: 'unrelated edit' }),
    )
    expect(response.status).toBe(200)
    expect((await membersOf(handle)).map(member => member.userId)).toEqual(['usr-owner'])
  })

  it('admits nobody when the setting is cleared', async () => {
    const handle = await onlyOwner()
    await handle.app.request(
      `/workspaces/${handle.workspaceId}`,
      asUserJson(handle.users.owner.id, 'PATCH', { autoJoinAs: null }),
    )
    expect((await membersOf(handle)).map(member => member.userId)).toEqual(['usr-owner'])
  })
})
