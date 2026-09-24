import { REGISTRATION_TERMS_VERSION } from '../../shared/age-flow.ts';
/**
 * The only place the client talks to the server.
 *
 * Everything is typed against the shared contract, and the session token is held
 * in memory plus an HttpOnly cookie the server sets — the token in localStorage
 * is a deliberate omission.
 */
import type {
  BodyAnalysisRecord,
  BodySnapshot,
  ChatMessage,
  ElohimTurn,
  LongitudinalSummary,
  MemoryRecord,
  Preferences,
  Product,
  ProductAssessment,
  ProductPick,
  ProductUsage,
  ProgressPhoto,
  CatalogueStatus,
  SkinAppearanceMetrics,
  SkinAnalysis,
  RoutinePlan,
  RoutineOutcome,
  RoutineReview,
  SkinProfile,
  UserSummary,
  ConsentDecision,
  ConsentState,
  ConsentSummaries,
  ConsentSummary,
} from '@shared/types.ts';

let token: string | null = null;

export function setToken(value: string | null): void {
  token = value;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

function attachmentFilename(value: string | null): string {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? 'elohim-data.json';
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      modelAvailable: boolean;
      model: string | null;
      imageStorage: boolean;
      demoMode: boolean;
      /** Whether the licensed voice is configured, and whether guests may use it. */
      clonedVoice?: boolean;
      guestVoice?: boolean;
      /** Absent on a healthy server; `false` when nothing is attached to store into. */
      database?: boolean;
    }>(
      '/health',
    ),

  register: (email: string, password: string, displayName: string, dateOfBirth: string, termsAccepted: boolean) =>
    request<{ token: string; user: UserSummary }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, dateOfBirth, termsAccepted, termsVersion: REGISTRATION_TERMS_VERSION }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: UserSummary }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  me: () => request<{ user: UserSummary; modelAvailable: boolean }>('/me'),

  updateProfile: (patch: Partial<SkinProfile>) =>
    request<{ profile: SkinProfile }>('/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  updatePreferences: (patch: Partial<Preferences>) =>
    request<{ preferences: Preferences }>('/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  consentHistory: () => request<{ decisions: ConsentDecision[] }>('/me/consents/history'),

  consents: () => request<{ consents: ConsentSummaries }>('/me/consents'),

  recordConsentDecision: (
    consentType: string, wordingVersionId: string, state: ConsentState,
    metadata?: Record<string, unknown>, idempotencyKey = crypto.randomUUID(),
  ) =>
    request<{ decision: ConsentDecision; current: ConsentSummary }>(
      `/me/consents/${encodeURIComponent(consentType)}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ wordingVersionId, state, metadata, idempotencyKey }),
    }),

  async exportMyData(): Promise<{ blob: Blob; filename: string }> {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch('/api/me/data-export', { headers, credentials: 'same-origin' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new ApiError(res.status, body.error ?? res.statusText);
    }
    return {
      blob: await res.blob(),
      filename: attachmentFilename(res.headers.get('Content-Disposition')),
    };
  },

  deleteAccount: () =>
    request<{ ok: true; blobsShredded: number; blobsFailed: number }>('/me/data', { method: 'DELETE' }),

  chatHistory: () => request<{ messages: ChatMessage[] }>('/chat/history'),

  chat: (message: string) =>
    request<{ turn: ElohimTurn }>('/chat', { method: 'POST', body: JSON.stringify({ message }) }),

  /** Turns produced by app events — no fabricated user message in the transcript. */
  chatEvent: (event: 'opened' | 'scan_complete' | 'body_scan_complete', body?: BodySnapshot) =>
    request<{ turn: ElohimTurn }>('/chat/event', {
      method: 'POST',
      body: JSON.stringify({ event, body }),
    }),

  memories: () => request<{ memories: MemoryRecord[] }>('/memories'),
  forget: (id: string) => request<{ ok: true }>(`/memories/${id}`, { method: 'DELETE' }),

  scans: () => request<{ scans: SkinAnalysis[] }>('/scans'),
  scanSummary: () => request<{ summary: LongitudinalSummary }>('/scans/summary'),

  /** Whether each product in the routine achieved what it was suggested for. */
  routineOutcomes: () => request<{ outcomes: RoutineOutcome[] }>('/routine/outcomes'),

  saveScan: (analysis: SkinAnalysis, cloudImageBase64?: string) =>
    request<{ scan: SkinAnalysis; summary: LongitudinalSummary }>('/scans', {
      method: 'POST',
      body: JSON.stringify({ analysis, imageBase64: cloudImageBase64 }),
    }),

  deleteScan: (id: string) => request<{ ok: true }>(`/scans/${id}`, { method: 'DELETE' }),

  /*
   * Body readings live on their own endpoint against their own table.
   *
   * Two captures, so two optional images — both gated behind the same storage
   * consent as a face scan. The response hands back the previous scan too,
   * because that is what a trend needs and the client should not have to fetch
   * the whole history to find one row.
   */
  bodyScans: () => request<{ scans: BodyAnalysisRecord[] }>('/body-scans'),

  deleteBodyScan: (id: string) =>
    request<{ ok: true }>(`/body-scans/${id}`, { method: 'DELETE' }),

  saveBodyScan: (
    analysis: BodyAnalysisRecord,
    imageBase64?: string,
    profileImageBase64?: string,
  ) =>
    request<{ scan: BodyAnalysisRecord; previous: BodyAnalysisRecord | null }>('/body-scans', {
      method: 'POST',
      body: JSON.stringify({ analysis, imageBase64, profileImageBase64 }),
    }),

  /**
   * The stored capture for a scan, as an object URL.
   *
   * Fetched rather than pointed at with an `<img src>`, because the route is
   * authenticated with a bearer token and an image element cannot send one.
   * Callers own the returned URL and must revoke it.
   */
  progressPhotos: () => request<{ photos: ProgressPhoto[] }>('/progress-photos'),

  saveProgressPhoto: (scanId: string, imageBase64: string) =>
    request<{ photo: ProgressPhoto }>(`/scans/${scanId}/progress-photo`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    }),

  deleteProgressPhoto: (id: string) =>
    request<{ ok: true }>(`/progress-photos/${id}`, { method: 'DELETE' }),

  async progressPhotoImage(id: string): Promise<string | null> {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`/api/progress-photos/${id}/image`, { headers, credentials: 'same-origin' });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

  searchProducts: (q: string) =>
    request<{ products: Product[] }>(`/products/search?q=${encodeURIComponent(q)}`),

  addProduct: (input: { name: string; brand?: string; category?: string; ingredients?: string[] }) =>
    request<{ product: Product }>('/products', { method: 'POST', body: JSON.stringify(input) }),

  assessProduct: (id: string) =>
    request<{ assessment: ProductAssessment }>(`/products/${id}/assess`, { method: 'POST' }),

  readLabel: (imageBase64: string) =>
    request<{ ingredients: string[]; rawText: string; confidence: number }>(
      '/products/read-label',
      { method: 'POST', body: JSON.stringify({ imageBase64 }) },
    ),

  routinePlan: () => request<{ plan: RoutinePlan | null }>('/routine/plan'),

  /** What to buy for the latest scan, from the shelf and the web. */
  picks: () => request<{ picks: ProductPick[] }>('/routine/picks'),

  /**
   * The same picks for a reading that was never stored - a guest's. The
   * numbers go up, one answer comes back, nothing is kept.
   */
  publicPicks: (
    metrics: SkinAppearanceMetrics,
    confidence: number,
    profile?: Partial<SkinProfile>,
  ) =>
    request<{ plan: RoutinePlan; picks: ProductPick[] }>('/public/picks', {
      method: 'POST',
      body: JSON.stringify({ metrics, confidence, profile }),
    }),

  catalogueStatus: () => request<{ status: CatalogueStatus }>('/public/catalogue/status'),

  routine: () =>
    request<{ usage: ProductUsage[]; review: RoutineReview }>('/routine'),

  startRoutine: (productId: string, frequency?: string) =>
    request<{ id: string; usage: ProductUsage[] }>('/routine', {
      method: 'POST',
      body: JSON.stringify({ productId, frequency }),
    }),

  stopRoutine: (id: string) =>
    request<{ usage: ProductUsage[] }>(`/routine/${id}`, { method: 'DELETE' }),
};
