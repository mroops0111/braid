import type { RunRecord, SessionMetadata } from '@braidhq/schema'
import type { RunRepository } from '../../domain/skill/RunRepository.js'

export class NoopRunRepository implements RunRepository {
  async saveRecord(): Promise<void> {}
  async appendEvent(): Promise<void> {}
  async listRecords(): Promise<readonly RunRecord[]> {
    return []
  }

  async * readEvents(): AsyncGenerator<never> {}
  async deleteRecords(): Promise<void> {}
  async saveSessionMetadata(): Promise<void> {}
  async listSessionMetadata(): Promise<readonly SessionMetadata[]> {
    return []
  }
}
