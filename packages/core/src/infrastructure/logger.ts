import process from 'node:process'
import pino, { type Logger } from 'pino'

export type { Logger }

// Pretty by default, JSON when NODE_ENV=production,
// so the bundled server emits machine-parseable lines for log aggregators.
// `BRAID_LOG_PRETTY` (true/false) overrides both.
function shouldPrettyPrint(): boolean {
  if (process.env.BRAID_LOG_PRETTY === 'true')
    return true
  if (process.env.BRAID_LOG_PRETTY === 'false')
    return false
  return process.env.NODE_ENV !== 'production'
}

/**
 * Build a Node-side logger tagged with the calling package's name.
 *
 * Convention: `ns` is the bare package name,
 * e.g. `server`, `agent-claude-code`, or `storage-kuzu`,
 * the package the calling file lives in, NOT the package it talks to.
 * Use a sub-namespace like `server/agent` when one package's logs get noisy.
 *
 * Studio (browser) and the Tauri Rust shell have their own loggers.
 * This factory is for Node processes only.
 */
export function createLogger(ns: string): Logger {
  return pino({
    name: ns,
    level: process.env.BRAID_LOG_LEVEL ?? 'info',
    ...(shouldPrettyPrint()
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  })
}
