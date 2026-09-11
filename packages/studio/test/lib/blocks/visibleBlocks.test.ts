import type { AudienceId, EmittedBlock, RenderBlock } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { visibleBlocks } from '@/lib/blocks/visibleBlocks'

const BUSINESS = 'business' as AudienceId
const ENGINEERING = 'engineering' as AudienceId

function entry(id: string, audiences: readonly AudienceId[]): EmittedBlock {
  const block: RenderBlock = { call: 'showAnswer', audiences: [...audiences], markdown: id }
  return { id: id as EmittedBlock['id'], block }
}

describe('visibleBlocks', () => {
  // A conclusion belongs to whoever asked,
  // so naming nobody is the common case and means everyone.
  it('shows a block that names nobody to every reader', () => {
    const shared = entry('shared', [])
    expect(visibleBlocks([shared], BUSINESS)).toEqual([shared])
    expect(visibleBlocks([shared], ENGINEERING)).toEqual([shared])
  })

  it('shows a block naming an audience only to that reader', () => {
    const forBusiness = entry('b', [BUSINESS])
    expect(visibleBlocks([forBusiness], BUSINESS)).toEqual([forBusiness])
    expect(visibleBlocks([forBusiness], ENGINEERING)).toEqual([])
  })

  it('shows a block naming several to any of them', () => {
    const both = entry('both', [BUSINESS, ENGINEERING])
    expect(visibleBlocks([both], ENGINEERING)).toEqual([both])
  })

  // What switching reader actually changes.
  // The shared blocks stay, and only the addressed one is swapped.
  it('keeps the shared blocks and swaps only what was addressed', () => {
    const blocks = [entry('shared', []), entry('b', [BUSINESS]), entry('e', [ENGINEERING])]
    expect(visibleBlocks(blocks, BUSINESS).map(item => item.id)).toEqual(['shared', 'b'])
    expect(visibleBlocks(blocks, ENGINEERING).map(item => item.id)).toEqual(['shared', 'e'])
  })

  it('preserves the order the blocks arrived in', () => {
    const blocks = [entry('one', [BUSINESS]), entry('two', []), entry('three', [BUSINESS])]
    expect(visibleBlocks(blocks, BUSINESS).map(item => item.id)).toEqual(['one', 'two', 'three'])
  })
})
