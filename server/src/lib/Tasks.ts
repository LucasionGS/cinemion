import type { TaskInfo } from "@shared/media.ts";
import log from "./Logger.ts";

/**
 * Background jobs, like library scans, with live progress for the UI.
 * A job with the same id as a running one isn't started twice; the caller gets the running one.
 */
export namespace Tasks {
  export interface Handle {
    /**
     * Report what the job is doing. `progress` is 0 to 1, or `null` when unknown.
     */
    update(status: string, progress?: number | null): void;
  }

  interface Running {
    info: TaskInfo;
    promise: Promise<unknown>;
  }

  const _running = new Map<string, Running>();
  // Jobs in the same queue run one after another; SQLite only has one writer anyway
  const _queues = new Map<string, Promise<unknown>>();

  /**
   * Start a job, or return the one already running with this id.
   * @param queue Jobs sharing a queue name run one at a time, in order.
   */
  export function run<T>(id: string, label: string, opts: { libraryId?: number; queue?: string }, job: (task: Handle) => Promise<T>): Promise<T> {
    const existing = _running.get(id);
    if (existing) return existing.promise as Promise<T>;

    const info: TaskInfo = { id, label, status: "Waiting", progress: null, libraryId: opts.libraryId ?? null, startedAt: new Date().toISOString() };
    const handle: Handle = {
      update(status, progress = null) {
        info.status = status;
        info.progress = progress;
      },
    };

    const queue = opts.queue ?? id;
    const previous = _queues.get(queue) ?? Promise.resolve();
    const promise = previous.catch(() => { }).then(async () => {
      info.status = "Starting";
      info.startedAt = new Date().toISOString();
      try {
        return await job(handle);
      } catch (error) {
        log.error(`${label} failed`, { error });
        throw error;
      } finally {
        _running.delete(id);
      }
    });
    _running.set(id, { info, promise });
    _queues.set(queue, promise);
    return promise;
  }

  export function list(): TaskInfo[] {
    return [..._running.values()].map((r) => ({ ...r.info }));
  }

  export function get(id: string): TaskInfo | null {
    const running = _running.get(id);
    return running ? { ...running.info } : null;
  }
}

export default Tasks;
