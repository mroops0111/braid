import type { RunRecord, SessionMetadata, SessionShare } from '@braidhq/schema'
import type { RunRepository } from '../../domain/skill/RunRepository.js'
import type { SessionShareRepository } from '../../domain/skill/SessionShareRepository.js'

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

export class NoopSessionShareRepository implements SessionShareRepository {
  async saveSessionShare(): Promise<void> {}
  async listSessionShares(): Promise<readonly SessionShare[]> {
    return []
  }

  async deleteSessionShares(): Promise<void> {}
}
