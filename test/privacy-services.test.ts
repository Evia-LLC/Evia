import { describe, expect, it, vi } from 'vitest';
import { assembleDataExport, DATA_EXPORT_VERSION, type DataExportRepositories } from '../server/privacy/export.ts';
import { deleteAccount } from '../server/privacy/delete-account.ts';
import { DEFAULT_PREFERENCES, type UserSummary } from '../shared/types.ts';

const account: UserSummary = {
  id: 'owner',
  email: 'owner@example.test',
  displayName: 'Owner',
  createdAt: '2025-01-01T00:00:00.000Z',
  profile: {
    skinType: 'unknown', fitzpatrick: null, concerns: [], sensitivities: [],
    pregnancyStatus: 'unknown', updatedAt: '2025-01-01T00:00:00.000Z',
  },
  preferences: DEFAULT_PREFERENCES,
  consents: { image_storage: false, cloud_reasoning: false },
  scanCount: 0,
};

function repositories(content = ''): DataExportRepositories {
  return {
    account: vi.fn(async () => account),
    consentHistory: vi.fn(async () => [
      { kind: 'cloud_reasoning', granted: true, recordedAt: '2025-01-02T00:00:00.000Z' },
      { kind: 'cloud_reasoning', granted: false, recordedAt: '2025-01-03T00:00:00.000Z' },
    ]),
    skinScans: vi.fn(async () => []),
    bodyScans: vi.fn(async () => []),
    routine: vi.fn(async () => []),
    memories: vi.fn(async () => []),
    transcripts: vi.fn(async () => [{
      id: 'conversation', startedAt: '2025-01-01', lastActiveAt: '2025-01-01', title: null,
      messages: [{ id: 'message', role: 'user', content, createdAt: '2025-01-01' }],
    }]),
  };
}

describe('structured data export', () => {
  it('scopes every repository call to the authenticated owner and includes every category', async () => {
    const repos = repositories();
    const result = await assembleDataExport('owner', repos);
    for (const reader of Object.values(repos)) expect(reader).toHaveBeenCalledWith('owner');
    expect(result).toMatchObject({
      metadata: { format: 'elohim-user-data', version: DATA_EXPORT_VERSION, photoBinariesIncluded: false },
      account: { id: 'owner' }, preferences: {}, consentHistory: [{ granted: true }, { granted: false }],
      scans: { skin: [], body: [] }, routine: { products: [] }, memories: [], transcripts: [{}],
    });
  });

  it('contains no credential or session fields and supports an empty account', async () => {
    const result = await assembleDataExport('owner', repositories());
    const encoded = JSON.stringify(result);
    expect(encoded).not.toMatch(/password_hash|passwordSalt|session_token|encryption_key|provider_credentials/i);
    expect(result.scans.skin).toEqual([]);
    expect(result.memories).toEqual([]);
  });

  it('does not truncate a large transcript', async () => {
    const content = 'conversation '.repeat(100_000);
    const result = await assembleDataExport('owner', repositories(content));
    expect(result.transcripts[0].messages[0].content).toBe(content);
  });
});

describe('account deletion service', () => {
  it('continues cascade deletion after a blob-shred failure and reports it accurately', async () => {
    const removeUser = vi.fn(async () => undefined);
    const result = await deleteAccount('owner', {
      skinBlobRefs: async () => ['good', 'bad'], bodyBlobRefs: async () => [],
      progressPhotoRefs: async () => ['progress-photo'],
      shred: async (ref) => { if (ref === 'bad') throw new Error('storage unavailable'); },
      deleteUser: removeUser,
    });
    expect(result).toEqual({ ok: true, blobsShredded: 2, blobsFailed: 1 });
    expect(removeUser).toHaveBeenCalledWith('owner');
  });
});
