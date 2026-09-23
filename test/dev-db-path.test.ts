import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareDirectory } from '../scripts/lib/prepare-directory.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('prepareDirectory', () => {
  it('recursively creates the data directory and is safe to call again', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'evia-dev-db-'));
    temporaryDirectories.push(root);
    const dataDirectory = path.join(root, 'nested', 'data');

    await prepareDirectory(dataDirectory);
    await prepareDirectory(dataDirectory);

    expect((await stat(dataDirectory)).isDirectory()).toBe(true);
  });

  it('adds the directory path when creation fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'evia-dev-db-'));
    temporaryDirectories.push(root);
    const filePath = path.join(root, 'not-a-directory');
    await writeFile(filePath, 'occupied');
    const dataDirectory = path.join(filePath, 'data');

    await expect(prepareDirectory(dataDirectory)).rejects.toThrow(
      `Unable to create data directory "${dataDirectory}"`,
    );
  });
});
