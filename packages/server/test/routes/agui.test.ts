import type { SkillRegistry } from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventSchemas, EventType } from '@ag-ui/core'
import { ClaudeCodeAgentBinding } from '@braidhq/agent-claude-code'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { FsRunRepository } from '../../src/infrastructure/skill/FsRunRepository.js'
import { SubprocessSkillRunner } from '../../src/infrastructure/skill/SubprocessSkillRunner.js'
import { DEFAULT_AGENT_BINDING, makeSkillManifest, makeWorkspace } from '../helpers/fakes.js'
import { createMockSpawn } from '../helpers/mockSpawn.js'

function makeSkillRegistry(): SkillRegistry {
  const manifest = makeSkillManifest({ id: 'braid:ask', path: '/abs/SKILL.md' as AbsolutePath })
  return { list: async () => [manifest], find: async () => manifest, get: async () => manifest }
}

/** The line claude opens a session with, which is what a resume needs. */
function initLine(sessionId: string): string {
  return JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId })
}

/** One claude stream line per scripted agent turn. */
function assistantLine(text: string): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
}

async function buildApp(stdoutLines: readonly string[], ...laterRuns: readonly (readonly string[])[]) {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-agui-route-'))) as AbsolutePath
  const workspace = makeWorkspace({ rootPath })
  const runRepository = new FsRunRepository()
  const { spawn, invocations } = createMockSpawn([{ stdoutLines, exitCode: 0 }, ...laterRuns.map(lines => ({ stdoutLines: lines, exitCode: 0 }))])
  const skillRegistry = makeSkillRegistry()
  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    buildAgentBinding: descriptor => new ClaudeCodeAgentBinding(descriptor),
    defaultAgent: DEFAULT_AGENT_BINDING,
    apiUrl: 'http://localhost:4321',
    runRepository,
    spawn,
  })
  const deps = composeApp({ skillRegistry, skillRunner, runRepository })
  await deps.workspaceRepository.save(workspace)
  return { app: createApp(deps), workspace, skillRunner, invocations, deps }
}

/** Parse an SSE body back into the events a conformant client would see. */
function readEvents(body: string): Record<string, unknown>[] {
  return body
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data:'))
    .map(block => JSON.parse(block.slice('data:'.length).trim()) as Record<string, unknown>)
}

function runInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    threadId: 'thread-1',
    runId: 'client-run-1',
    state: {},
    messages: [{ id: 'm1', role: 'user', content: 'how do templates differ' }],
    tools: [],
    context: [],
    forwardedProps: { skillId: 'braid:ask' },
    ...overrides,
  }
}

async function postRun(app: ReturnType<typeof createApp>, workspaceId: string, body: Record<string, unknown>) {
  return app.request(`/workspaces/${workspaceId}/agui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
  })
}

describe('agui route', () => {
  it('streams a run as events the protocol itself accepts', async () => {
    const { app, workspace } = await buildApp([assistantLine('Templates differ by audience.')])

    const response = await postRun(app, workspace.id, runInput())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const events = readEvents(await response.text())
    for (const event of events)
      expect(() => EventSchemas.parse(event)).not.toThrow()
  })

  it('opens with a run started and closes with a run finished', async () => {
    const { app, workspace } = await buildApp([assistantLine('An answer.')])

    const events = readEvents(await (await postRun(app, workspace.id, runInput())).text())

    expect(events[0]!.type).toBe(EventType.RUN_STARTED)
    expect(events.at(-1)!.type).toBe(EventType.RUN_FINISHED)
  })

  it('carries the thread the client named, not one of its own', async () => {
    const { app, workspace } = await buildApp([assistantLine('An answer.')])

    const events = readEvents(await (await postRun(app, workspace.id, runInput({ threadId: 'thread-9' })).then(r => r)).text())

    expect(events[0]!.threadId).toBe('thread-9')
  })

  it('orders a text message as start, content, end', async () => {
    const { app, workspace } = await buildApp([assistantLine('An answer.')])

    const events = readEvents(await (await postRun(app, workspace.id, runInput())).text())
    const openings = events.filter(event => event.type === EventType.TEXT_MESSAGE_START)

    // The prompt first, as the user message that starts the turn, then the
    // agent's own. Each spelled as the three events addressing one id.
    expect(openings.map(event => event.role)).toEqual(['user', 'assistant'])
    expect(events.filter(event => String(event.type).startsWith('TEXT_MESSAGE')).map(event => event.type))
      .toEqual([
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
      ])
  })

  // Reloading onto a finished run replays the same events, so the prompt is
  // there whether a reader watched it happen or arrived afterwards.
  it('replays a finished run with the prompt it was given', async () => {
    const { app, workspace } = await buildApp([assistantLine('An answer.')])
    const live = readEvents(await (await postRun(app, workspace.id, runInput())).text())
    const runId = live[0]!.runId as string

    const replayed = readEvents(await (await app.request(`/workspaces/${workspace.id}/agui/runs/${runId}?threadId=t`)).text())
    const prompt = replayed.find(event => event.type === EventType.TEXT_MESSAGE_START && event.role === 'user')
    expect(prompt).toBeDefined()
    const content = replayed.find(event =>
      event.type === EventType.TEXT_MESSAGE_CONTENT && event.messageId === prompt!.messageId)
    expect(content!.delta).toBe('how do templates differ')
  })

  // The conversation is the contract. Without a handle for an agent-held
  // conversation, the whole exchange has to reach the agent some other way.
  it('hands the whole conversation to the agent when there is no handle for it', async () => {
    const { app, workspace, invocations } = await buildApp([assistantLine('An answer.')])

    await postRun(app, workspace.id, runInput({
      messages: [
        { id: 'm1', role: 'user', content: 'what is a template' },
        { id: 'm2', role: 'assistant', content: 'A reusable document.' },
        { id: 'm3', role: 'user', content: 'and who may edit one' },
      ],
    }))

    const prompt = invocations[0]!.args[invocations[0]!.args.indexOf('-p') + 1]!
    expect(prompt).toContain('/braid:ask what is a template')
    expect(prompt).toContain('Assistant: A reusable document.')
    expect(prompt).toContain('User: and who may edit one')
  })

  it('continues an agent-held conversation when the client names one', async () => {
    const { app, workspace, invocations } = await buildApp([assistantLine('An answer.')])

    await postRun(app, workspace.id, runInput({
      messages: [
        { id: 'm1', role: 'user', content: 'what is a template' },
        { id: 'm2', role: 'assistant', content: 'A reusable document.' },
        { id: 'm3', role: 'user', content: 'and who may edit one' },
      ],
      forwardedProps: { skillId: 'braid:ask', resumeSessionId: 'sess-7' },
    }))

    const args = invocations[0]!.args
    expect(args).toContain('--resume')
    expect(args[args.indexOf('-p') + 1]).toBe('and who may edit one')
  })

  it('rejects a body that is not a RunAgentInput', async () => {
    const { app, workspace } = await buildApp([])

    const response = await postRun(app, workspace.id, { nonsense: true })

    expect(response.status).toBe(400)
  })

  it('rejects a run with no skill named', async () => {
    const { app, workspace } = await buildApp([])

    const response = await postRun(app, workspace.id, runInput({ forwardedProps: {} }))

    expect(response.status).toBe(400)
  })

  // A run that stopped to ask is not finished, and a client that reads it as
  // finished would never come back with the answer.
  it('ends a run that left a question open as an interrupt, not a plain finish', async () => {
    const { app, workspace, deps } = await buildApp([assistantLine('I need a decision.')])
    const live = readEvents(await (await postRun(app, workspace.id, runInput())).text())
    const runId = live[0]!.runId as string

    await deps.hitlService.submitClarification({
      workspaceId: workspace.id,
      question: 'Is a kiosk the same thing as a front desk?',
      candidates: [],
      skillRunId: runId as never,
    })

    const replayed = readEvents(await (await app.request(`/workspaces/${workspace.id}/agui/runs/${runId}`)).text())
    const finish = replayed.at(-1) as { type: string, outcome?: { type: string, interrupts: { id: string }[] } }

    expect(finish.type).toBe(EventType.RUN_FINISHED)
    expect(finish.outcome?.type).toBe('interrupt')
    expect(finish.outcome?.interrupts).toHaveLength(1)
    expect(() => EventSchemas.parse(finish)).not.toThrow()
  })

  it('refuses to resume on a clarification nobody answered', async () => {
    const { app, workspace, deps } = await buildApp([assistantLine('An answer.')])
    const live = readEvents(await (await postRun(app, workspace.id, runInput())).text())
    const runId = live[0]!.runId as string
    const clarification = await deps.hitlService.submitClarification({
      workspaceId: workspace.id,
      question: 'Still open.',
      candidates: [],
      skillRunId: runId as never,
    })

    const response = await postRun(app, workspace.id, runInput({
      resume: [{ interruptId: clarification.id, status: 'resolved' }],
    }))

    expect(response.status).toBe(400)
  })

  /**
   * The three ways out of a question all release the run, because it asked in
   * order to keep going. What differs is the sentence it is handed, and these
   * pin that down where it actually reaches the agent, in the prompt.
   */
  it.each([
    { verb: 'deferred', settle: 'defer', expected: 'answer this later' },
    { verb: 'set aside', settle: 'skip', expected: 'set this question aside' },
  ])('carries a run on when its question is $verb', async ({ settle, expected }) => {
    const { app, workspace, deps, invocations } = await buildApp(
      [initLine('sess-parked'), assistantLine('I need a decision.')],
      [assistantLine('Carrying on without it.')],
    )
    const live = readEvents(await (await postRun(app, workspace.id, runInput())).text())
    const runId = live[0]!.runId as string
    const clarification = await deps.hitlService.submitClarification({
      workspaceId: workspace.id,
      question: 'Should a loan and a reservation share one ledger?',
      candidates: [],
      skillRunId: runId as never,
    })
    expect(clarification.answerMode).toBe('resumes')

    await (settle === 'defer'
      ? deps.hitlService.deferClarification(clarification.id, 'u-1' as never)
      : deps.hitlService.skipClarification(clarification.id, 'not now', 'u-1' as never))

    const response = await postRun(app, workspace.id, runInput({
      resume: [{ interruptId: clarification.id, status: 'resolved' }],
    }))

    expect(response.status).toBe(200)
    const args = invocations[1]!.args
    expect(args).toContain('--resume')
    const prompt = args[args.indexOf('-p') + 1]!
    expect(prompt).toContain(expected)
    expect(prompt).toContain('do not raise it again')

    // A continuation resumes a conversation that already read the closed run's
    // id from its environment, so every render call it makes would land on a
    // run nothing is listening to unless it is told the new one.
    const records = await deps.runRepository.listRecords(workspace)
    const carriedRun = records.find(record => record.continues === runId)!
    expect(prompt).toContain(carriedRun.runId)
    expect(prompt).toContain('read $BRAID_RUN_ID again')

    // The record keeps both: what was actually sent, so an audit reads true,
    // and what the run works on, so a continued run stays attributed to the
    // document it is still reading rather than to the sentence that released
    // it. It also names the run it took up.
    const carried = carriedRun
    expect(carried.args).toContain(expected)
    expect(carried.scope).toBe('how do templates differ')
    expect(carried.continues).toBe(runId)

    // And it opens holding the earlier run's account, so the thread reads in
    // one place: the first prompt, the work, the question, then the sentence
    // that released it. Without this a reader lands mid-thought.
    const thread: string[] = []
    for await (const event of deps.runRepository.readEvents(workspace, carried.runId))
      thread.push(event.type)
    expect(thread.filter(type => type === 'started')).toHaveLength(2)
    expect(thread).toContain('message')
  })

  it('replays a finished run as the same events a live one produced', async () => {
    const { app, workspace, skillRunner } = await buildApp([assistantLine('An answer.')])
    const live = readEvents(await (await postRun(app, workspace.id, runInput())).text())
    const runId = live[0]!.runId as string
    // The POST returned once the stream closed, so the run has already settled.
    expect(skillRunner.isActive(runId as never)).toBe(false)

    const response = await app.request(`/workspaces/${workspace.id}/agui/runs/${runId}?threadId=thread-1`)
    const replayed = readEvents(await response.text())

    expect(response.status).toBe(200)
    expect(replayed.map(event => event.type)).toEqual(live.map(event => event.type))
    for (const event of replayed)
      expect(() => EventSchemas.parse(event)).not.toThrow()
  })
})
