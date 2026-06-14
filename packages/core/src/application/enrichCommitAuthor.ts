import type { CommitMessage } from '@braidhq/schema'
import type { UserDirectory } from '../domain/users/UserDirectory.js'

/**
 * Resolve the human author for a commit and snapshot `displayName` /
 * `email` into the message so a later rename of the user record can't
 * retroactively rewrite git history. Pass-through when the caller has
 * already populated those fields, or when the directory has no record.
 */
export async function enrichCommitAuthor(
  message: CommitMessage,
  userDirectory: UserDirectory,
): Promise<CommitMessage> {
  if (message.authorName !== undefined || message.authorEmail !== undefined)
    return message
  const author = await userDirectory.resolve(message.userId)
  if (!author)
    return message
  return {
    ...message,
    authorName: author.displayName,
    ...(author.email ? { authorEmail: author.email } : {}),
  }
}
