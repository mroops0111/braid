/**
 * Wait for something the runner does after the request returns.
 *
 * A run drains asynchronously,
 * so a fixed sleep asserts on whatever was true when the timer fired.
 * Under load that is a different moment than on an idle machine,
 * which is how a suite acquires a test that passes here and fails in CI.
 * Polling asks the same condition the production code checks,
 * and fails loudly rather than silently early.
 */
export async function waitFor(
  condition: () => boolean,
  description: string,
  { attempts = 200, everyMs = 10 } = {},
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition())
      return
    await new Promise(resolve => setTimeout(resolve, everyMs))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

/**
 * Wait until nothing more is going to happen.
 *
 * A run can spawn a successor once its own teardown is done,
 * so there is a moment where nothing is running and something still will be.
 * One reading of idle would stop there and assert on a half-finished story.
 * Several consecutive readings put a real gap between the two,
 * without the test having to know how many runs it is waiting for.
 */
export async function waitUntilIdle(
  isIdle: () => boolean,
  description: string,
  { readings = 4, everyMs = 10 } = {},
): Promise<void> {
  let consecutive = 0
  await waitFor(
    () => {
      consecutive = isIdle() ? consecutive + 1 : 0
      return consecutive >= readings
    },
    description,
    { everyMs },
  )
}

interface RunnerActivity {
  isActive: (runId: never) => boolean
}

/** The run itself is finished, whatever it left behind for others to do. */
export async function waitForRunToEnd(runner: RunnerActivity, runId: string): Promise<void> {
  await waitFor(() => !runner.isActive(runId as never), `run "${runId}" to finish draining`)
}
