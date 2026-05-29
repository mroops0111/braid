import type { RunRepository } from '../../domain/skill/RunRepository.js'

export const noopRunRepository: RunRepository = {
  async saveRecord() {},
  async appendEvent() {},
  async listRecords() {
    return []
  },
  async * readEvents() {},
  async deleteRecords() {},
  async saveSessionMetadata() {},
  async listSessionMetadata() {
    return []
  },
}
