// Web Worker entry: runs the single-photo pipeline off the main thread (SPEC 3.6).
// Cancel = the main thread terminates this worker.
import { runSinglePhoto, type AnalysisInput, type PatchResult } from './pipeline';

export type WorkerRequest = { id: number; input: AnalysisInput };
export type WorkerMessage =
  | { id: number; type: 'progress'; step: string; fraction: number }
  | { id: number; type: 'done'; result: PatchResult }
  | { id: number; type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, input } = e.data;
  const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
  try {
    const result = runSinglePhoto(input, (step, fraction) => post({ id, type: 'progress', step, fraction }));
    post({ id, type: 'done', result }, [result.region.buffer, result.dRaw.buffer, result.dSmooth.buffer, result.conf.buffer]);
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
