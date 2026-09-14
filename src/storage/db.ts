import type { AppConfig, PendingMutation, Snapshot } from '../types';

/**
 * Default app configuration used when nothing has been persisted yet.
 * `listInclusion` is empty (all lists default to included), theme is 'inbox',
 * and there is no auth state.
 */
export const DEFAULT_CONFIG: AppConfig = {
  listInclusion: {},
  theme: 'inbox',
  auth: null,
};

/** Read the persisted {@link AppConfig}, falling back to {@link DEFAULT_CONFIG}. */
export async function getConfig(): Promise<AppConfig> {
  throw new Error('not implemented');
}

/** Merge a partial config patch into the persisted {@link AppConfig}. */
export async function setConfig(_patch: Partial<AppConfig>): Promise<void> {
  throw new Error('not implemented');
}

/** Read the last cached {@link Snapshot}, or null if none has been stored. */
export async function getSnapshot(): Promise<Snapshot | null> {
  throw new Error('not implemented');
}

/** Persist the latest {@link Snapshot}, replacing any prior one. */
export async function setSnapshot(_s: Snapshot): Promise<void> {
  throw new Error('not implemented');
}

/** Append a mutation to the offline queue. */
export async function enqueueMutation(_m: PendingMutation): Promise<void> {
  throw new Error('not implemented');
}

/** List all queued mutations in insertion order. */
export async function listMutations(): Promise<PendingMutation[]> {
  throw new Error('not implemented');
}

/** Remove a queued mutation by its queue-entry id. */
export async function deleteMutation(_id: string): Promise<void> {
  throw new Error('not implemented');
}
