import { mkdir } from 'node:fs/promises';

/**
 * Ensure a directory exists before a service tries to write persistent data.
 *
 * @param {string} directory
 * @returns {Promise<void>}
 */
export async function prepareDirectory(directory) {
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    throw new Error(`Unable to create data directory "${directory}"`, { cause: error });
  }
}
