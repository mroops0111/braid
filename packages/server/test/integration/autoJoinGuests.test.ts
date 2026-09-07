import type { MultiUserAppHandle } from '../helpers/multiUser.js'
import { describe, expect, it } from 'vitest'
import { asUser, asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'
import { readJson } from '../helpers/readJson.js'

const EMAILS = {
  'usr-owner': 'owner@kdan.com',
  'usr-maint': 'maint@kdan.com',
  'usr-guest': 'guest@kdan.com',
  'usr-outsider': 'outsider@example.com',
}

interface MemberRow { userId: string, role: string }

async function membersOf(handle: MultiUserAppHandle): Promise<MemberRow[]> {
  const response = await handle.app.request(
    `/workspaces/${handle.workspaceId}/members`,
    asUser(handle.users.owner.id),
  )
  const body = await readJson<{ items: MemberRow[] }>(response)
  return body.items
}

describe('opening a workspace to a domain', () => {
  it('adds the colleagues already registered here, and nobody else', async () => {
    const handle = await buildMultiUserApp({
      members: { maintainer: false, guest: false },
      emails: EMAILS,
    })
    expect((await membersOf(handle)).map(member => member.userId)).toEqual(['usr-owner'])

    const response = await handle.app.request(
      `/workspaces/${handle.workspaceId}`,
      asUserJson(handle.users.owner.id, 'PATCH', { openToDomains: ['kdan.com'] }),
    )
    expect(response.status).toBe(200)

    const members = await membersOf(handle)
    const joined = members.filter(member => member.role === 'guest').map(member => member.userId).sort()
    // The outsider's address is on another domain, so the setting passes them by.
    expect(joined).toEqual(['usr-guest', 'usr-maint'])
    // The owner matched the domain too, and keeps the role they had.
    expect(members.find(member => member.userId === 'usr-owner')?.role).toBe('owner')
  })

  // Editing an unrelated field must not read as an instruction to open up.
  it('leaves membership alone when the patch does not name the domains', async () => {
    const handle = await buildMultiUserApp({
      members: { maintainer: false, guest: false },
      emails: EMAILS,
    })
    const response = await handle.app.request(
      `/workspaces/${handle.workspaceId}`,
      asUserJson(handle.users.owner.id, 'PATCH', { description: 'unrelated edit' }),
    )
    expect(response.status).toBe(200)
    expect((await membersOf(handle)).map(member => member.userId)).toEqual(['usr-owner'])
  })

  it('adds nobody when the workspace is closed again', async () => {
    const handle = await buildMultiUserApp({
      members: { maintainer: false, guest: false },
      emails: EMAILS,
    })
    await handle.app.request(
      `/workspaces/${handle.workspaceId}`,
      asUserJson(handle.users.owner.id, 'PATCH', { openToDomains: [] }),
    )
    expect((await membersOf(handle)).map(member => member.userId)).toEqual(['usr-owner'])
  })
})
