import type { ViewGeneratorPlugin } from '@braidhq/core'
import { NotFoundError } from '@braidhq/core'
import { NodeId, ViewArtifactFormat, ViewKind } from '@braidhq/schema'
import { defineViewGeneratorPlugin } from '@braidhq/sdk'
import { z } from 'zod'
import { projectDocument } from './material.js'

export type {
  DocumentMaterial,
  MaterialConcern,
  MaterialNode,
  MaterialSection,
  TypeLabel,
} from './material.js'
export { containerTypesOf, projectDocument } from './material.js'

export const VIEW_KIND = ViewKind.parse('doc')

/**
 * What the material is written as, which is data rather than prose.
 * A form reads it and writes the page, so what leaves here is structured.
 */
const MATERIAL_FORMAT = ViewArtifactFormat.parse('json')

/**
 * What every form here writes, which is a sequence of render calls.
 *
 * Named rather than assumed, because the form is what decides it.
 * A plugin shipping a form that writes something else says so here,
 * and the surface reads that rather than guessing from a file name.
 */
const BLOCK_FORMAT = ViewArtifactFormat.parse('blocks')

/**
 * Where the material lands, which is beside the views rather than among them.
 *
 * This is what a form reads to write a page,
 * so a reader offered it among the documents gets the machinery instead.
 */
const MATERIAL_DIR = 'material'

const Config = z.object({
  subject: NodeId,
})

/**
 * The material a document is written from, and nothing about the writing.
 *
 * This half is a function,
 * so what a document covers, which term sits under which,
 * and what the graph is still unsure of come out the same every run.
 * They are facts about the graph rather than choices about wording.
 *
 * The other half is a form, and it is deliberately given no template.
 * A generator that dictates the shape of an explanation,
 * gets a document that obeys the shape and teaches nobody.
 * What a form is handed is the material,
 * in the order the ontology says the graph nests,
 * and what it owes back is a page.
 */
export const docViewGeneratorPlugin: ViewGeneratorPlugin = defineViewGeneratorPlugin({
  viewKind: VIEW_KIND,
  configSchema: Config,
  // A document is written out of something that holds other things,
  // which the ontology says through `renderHint` rather than by a type name.
  subjects: [{ by: 'container' }],
  // One projection, two ways of writing it out.
  // Looking something up and meeting it for the first time,
  // need the same material and differ only in what is done with it.
  forms: [
    {
      id: 'reference',
      label: { 'en': 'Reference', 'zh-Hant': '手冊' },
      purpose: {
        'en': 'Arranged to be scanned, for coming back and finding one thing',
        'zh-Hant': '為查閱而排，回頭找一件事時用',
      },
      format: BLOCK_FORMAT,
      // A reference asks nothing.
      // A reader looking something up wants the same document every time,
      // because a lookup they have to configure is one they will not make.
      directory: new URL('../skills/reference', import.meta.url),
    },
    {
      id: 'tutorial',
      label: { 'en': 'Tutorial', 'zh-Hant': '教學' },
      purpose: {
        'en': 'Written for someone meeting the subject for the first time',
        'zh-Hant': '寫給第一次接觸這個主題的人',
      },
      format: BLOCK_FORMAT,
      directory: new URL('../skills/tutorial', import.meta.url),
      asks: [{
        id: 'depth',
        label: { 'en': 'Depth', 'zh-Hant': '深度' },
        fallback: 'standard',
        choices: [
          {
            id: 'plain',
            label: { 'en': 'Plain', 'zh-Hant': '淺白' },
            why: {
              'en': 'No prior knowledge assumed, and no jargon kept',
              'zh-Hant': '不預設任何背景，術語一律換掉',
            },
          },
          {
            id: 'standard',
            label: { 'en': 'Standard', 'zh-Hant': '標準' },
            why: {
              'en': 'For someone comfortable in the neighbouring field',
              'zh-Hant': '寫給熟悉相鄰領域的人',
            },
          },
          {
            id: 'deep',
            label: { 'en': 'Deep', 'zh-Hant': '深入' },
            why: {
              'en': 'The open questions and the edges, not just the shape',
              'zh-Hant': '講未定與邊界，不只講輪廓',
            },
          },
        ],
      }],
    },
  ],
  render: async (config, input) => {
    const material = projectDocument({
      model: input.model,
      nodeTypes: input.nodeTypes,
      subject: config.subject,
    })
    // A braid error rather than a plain one,
    // so a route serving this answers a reader with what went wrong,
    // rather than with a failure.
    if (material === undefined)
      throw new NotFoundError(`Node "${config.subject}" is not one this workspace holds`)

    return {
      kind: VIEW_KIND,
      format: MATERIAL_FORMAT,
      files: [{
        path: `${MATERIAL_DIR}/${VIEW_KIND}/${encodeURIComponent(config.subject)}.json`,
        text: `${JSON.stringify(material, null, 2)}\n`,
      }],
    }
  },
})
