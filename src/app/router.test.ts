import { describe, expect, it } from 'vitest';
import { parseHash, hashFor } from './router';

describe('hash router parseHash', () => {
  it('maps empty / root hashes to the list route', () => {
    expect(parseHash('')).toEqual({ name: 'list', params: {} });
    expect(parseHash('#')).toEqual({ name: 'list', params: {} });
    expect(parseHash('#/')).toEqual({ name: 'list', params: {} });
  });

  it('maps #/add to the add route', () => {
    expect(parseHash('#/add')).toEqual({ name: 'add', params: {} });
    // Trailing slash tolerated.
    expect(parseHash('#/add/')).toEqual({ name: 'add', params: {} });
  });

  it('falls back to the list route for unknown hashes', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'list', params: {} });
    expect(parseHash('#/random/path')).toEqual({ name: 'list', params: {} });
  });

  it('is shaped to parse a future edit route with params', () => {
    expect(parseHash('#/edit/list-1/task-9')).toEqual({
      name: 'edit',
      params: { listId: 'list-1', taskId: 'task-9' },
    });
    // Missing segments fall back to list rather than yielding a broken edit.
    expect(parseHash('#/edit/list-1')).toEqual({ name: 'list', params: {} });
    expect(parseHash('#/edit')).toEqual({ name: 'list', params: {} });
  });

  it('parses the snooze route with params (and falls back on missing segments)', () => {
    expect(parseHash('#/snooze/list-1/task-9')).toEqual({
      name: 'snooze',
      params: { listId: 'list-1', taskId: 'task-9' },
    });
    expect(parseHash('#/snooze/list-1')).toEqual({ name: 'list', params: {} });
    expect(parseHash('#/snooze')).toEqual({ name: 'list', params: {} });
  });

  it('round-trips a snooze hash back to decoded params', () => {
    const hash = hashFor('snooze', { listId: '@default', taskId: 'task-9' });
    expect(hash).toBe('#/snooze/%40default/task-9');
    expect(parseHash(hash)).toEqual({
      name: 'snooze',
      params: { listId: '@default', taskId: 'task-9' },
    });
  });

  it('builds the hash for a navigable target', () => {
    expect(hashFor('add')).toBe('#/add');
    expect(hashFor('list')).toBe('#/');
  });

  it('builds an edit hash from its params (percent-encoding reserved chars)', () => {
    expect(hashFor('edit', { listId: 'list-1', taskId: 'task-9' })).toBe(
      '#/edit/list-1/task-9',
    );
    // The built-in `@default` list id is encoded so it survives the round trip.
    expect(hashFor('edit', { listId: '@default', taskId: 'task-9' })).toBe(
      '#/edit/%40default/task-9',
    );
  });

  it('round-trips an edit hash back to decoded params', () => {
    const hash = hashFor('edit', { listId: '@default', taskId: 'task-9' });
    expect(parseHash(hash)).toEqual({
      name: 'edit',
      params: { listId: '@default', taskId: 'task-9' },
    });
  });
});
