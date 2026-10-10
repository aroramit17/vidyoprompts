import { randomUUID } from "node:crypto";
import type { Job } from "@/lib/studio/types";

// Survive dev-server module reloads.
const g = globalThis as unknown as { __studioJobs?: Map<string, Job>; __studioLocks?: Map<string, Promise<unknown>> };
const jobs = (g.__studioJobs ??= new Map<string, Job>());
const locks = (g.__studioLocks ??= new Map<string, Promise<unknown>>());

export function startJob(projectId: string, kind: Job["kind"], format: Job["format"], run: (progress: (p: number, message?: string) => void) => Promise<unknown>): Job {
  const running = [...jobs.values()].find((j) => j.projectId === projectId && j.kind === kind && j.format === format && j.status === "running");
  if (running) return running;
  const job: Job = { id: randomUUID(), projectId, kind, format, status: "running", progress: 0, message: "Starting…", startedAt: new Date().toISOString() };
  jobs.set(job.id, job);
  const progress = (p: number, message?: string) => {
    job.progress = Math.max(0, Math.min(1, p));
    if (message) job.message = message;
  };
  run(progress)
    .then((result) => {
      job.status = "done";
      job.progress = 1;
      job.message = "Done";
      job.result = result;
    })
    .catch((e: Error) => {
      job.status = "error";
      job.message = e.message;
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function projectJobs(projectId: string): Job[] {
  return [...jobs.values()].filter((j) => j.projectId === projectId);
}

/** Serialise mutations per project so concurrent requests cannot clobber JSON files. */
export function withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(
    projectId,
    next.catch(() => undefined),
  );
  return next;
}
