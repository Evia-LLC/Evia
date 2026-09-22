import { row, rows, run } from './index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import type {
  CharacterDirective,
  ChatMessage,
  Emotion,
  Intent,
  MemoryRecord,
  MemoryWrite,
} from '../../shared/types.ts';

// --- conversations ----------------------------------------------------------

export async function currentConversation(userId: string): Promise<string> {
  const found = await row<{ id: string }>(
    'SELECT id FROM conversations WHERE user_id = ? ORDER BY last_active_at DESC LIMIT 1',
    userId,
  );
  if (found) return found.id;

  const id = newId();
  const now = nowIso();
  await run(
    'INSERT INTO conversations (id, user_id, started_at, last_active_at) VALUES (?, ?, ?, ?)',
    id,
    userId,
    now,
    now,
  );
  return id;
}

export async function touchConversation(conversationId: string): Promise<void> {
  await run(
    'UPDATE conversations SET last_active_at = ? WHERE id = ?',
    nowIso(),
    conversationId,
  );
}

// --- messages ---------------------------------------------------------------

interface MessageRow {
  id: string;
  role: string;
  content: string;
  emotion: string | null;
  intent: string | null;
  directive_json: string | null;
  demo: number;
  created_at: string;
}

function hydrateMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role as 'user' | 'evia',
    content: row.content,
    createdAt: row.created_at,
    emotion: (row.emotion as Emotion) ?? undefined,
    intent: (row.intent as Intent) ?? undefined,
    directive: row.directive_json ? JSON.parse(row.directive_json) : undefined,
    demo: row.demo === 1,
  };
}

export async function appendMessage(
  conversationId: string,
  message: {
    role: 'user' | 'evia';
    content: string;
    emotion?: Emotion;
    intent?: Intent;
    directive?: CharacterDirective;
    demo?: boolean;
  },
): Promise<ChatMessage> {
  const id = newId();
  const now = nowIso();
  await run(
    `INSERT INTO messages (id, conversation_id, role, content, emotion, intent, directive_json, demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    conversationId,
    message.role,
    message.content,
    message.emotion ?? null,
    message.intent ?? null,
    message.directive ? JSON.stringify(message.directive) : null,
    message.demo ? 1 : 0,
    now,
  );
  await touchConversation(conversationId);
  return { id, createdAt: now, ...message };
}

/** Oldest first. */
export async function recentMessages(
  conversationId: string,
  limit = 20,
): Promise<ChatMessage[]> {
  return (await rows<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?',
    conversationId,
    limit,
  ))
    .map(hydrateMessage)
    .reverse();
}

// --- memories ---------------------------------------------------------------
// Durable facts, distinct from the transcript (ARCHITECTURE §2).

export async function upsertMemory(
  userId: string,
  write: MemoryWrite,
  sourceMessageId?: string,
): Promise<void> {
  await run(
    /*
     * GREATEST, not MAX.
     *
     * SQLite's MAX doubles as a two-argument scalar; Postgres reserves MAX for
     * the aggregate and would reject this outright. The intent is unchanged:
     * a memory that is re-stated never becomes less certain than it already was.
     */
    `INSERT INTO memories (id, user_id, kind, key, value, confidence, source_message_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, kind, key) DO UPDATE SET
       value = excluded.value,
       confidence = GREATEST(memories.confidence, excluded.confidence),
       source_message_id = excluded.source_message_id,
       updated_at = excluded.updated_at`,
    newId(),
    userId,
    write.kind,
    write.key,
    write.value,
    write.confidence,
    sourceMessageId ?? null,
    nowIso(),
  );
}

export async function listMemories(userId: string, limit = 60): Promise<MemoryRecord[]> {
  return (await rows<{
    id: string;
    kind: string;
    key: string;
    value: string;
    confidence: number;
    updated_at: string;
  }>(
    'SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
    userId,
    limit,
  )).map((r) => ({
    id: r.id,
    kind: r.kind as MemoryRecord['kind'],
    key: r.key,
    value: r.value,
    confidence: r.confidence,
    updatedAt: r.updated_at,
  }));
}

export async function forgetMemory(userId: string, id: string): Promise<void> {
  await run('DELETE FROM memories WHERE id = ? AND user_id = ?', id, userId);
}
