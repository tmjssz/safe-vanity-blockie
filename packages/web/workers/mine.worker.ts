/// <reference lib="webworker" />
import { runBrowserMiner } from '../lib/browser-miner'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol'

let stopRequested = false

const post = (event: WorkerEvent) => self.postMessage(event)

self.onmessage = async (message: MessageEvent<WorkerRequest>) => {
  if (message.data.type === 'stop') {
    stopRequested = true
    return
  }

  const { input } = message.data
  stopRequested = false

  try {
    const result = await runBrowserMiner({
      ...input,
      onSlice: (progress) =>
        post({ type: 'progress', scanned: progress.scanned, candidates: progress.candidates }),
      shouldStop: () => stopRequested,
    })
    post({ type: 'done', scanned: result.scanned, candidates: result.candidates })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
