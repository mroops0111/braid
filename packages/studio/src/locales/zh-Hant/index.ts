import type { en } from '../en'
import actionInput from './actionInput'
import admin from './admin'
import ask from './ask'
import blocks from './blocks'
import common from './common'
import graph from './graph'
import history from './history'
import inbox from './inbox'
import references from './references'
import review from './review'
import settings from './settings'
import shell from './shell'
import sources from './sources'
import transcript from './transcript'
import workspace from './workspace'

const zhHant: typeof en = {
  common,
  settings,
  actionInput,
  admin,
  ask,
  blocks,
  graph,
  history,
  inbox,
  references,
  review,
  shell,
  sources,
  transcript,
  workspace,
}

export default zhHant
