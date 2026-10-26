import { database, result, allPages } from '../lib/data-api.ts';
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
  const found = await result<{ id: string } | null>(database().from('conversations').select('id').eq('user_id', userId).order('last_active_at', { ascending: false }).limit(1).maybeSingle());
  if (found) return found.id;

  const id = newId();
  const now = nowIso();
  await result(database().from('conversations').insert({ id, user_id: userId, started_at: now, last_active_at: now }));
  return id;
}

export async function touchConversation(conversationId: string): Promise<void> {
  await result(database().from('conversations').update({ last_active_at: nowIso() }).eq('id', conversationId));
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
    role: row.role as 'user' | 'elohim',
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
    role: 'user' | 'elohim';
    content: string;
    emotion?: Emotion;
    intent?: Intent;
    directive?: CharacterDirective;
    demo?: boolean;
  },
): Promise<ChatMessage> {
  const id = newId();
  const now = nowIso();
  await result(database().from('messages').insert({
    id, conversation_id: conversationId, role: message.role, content: message.content,
    emotion: message.emotion ?? null, intent: message.intent ?? null,
    directive_json: message.directive ? JSON.stringify(message.directive) : null,
    demo: message.demo ? 1 : 0, created_at: now,
  }));
  await touchConversation(conversationId);
  return { id, createdAt: now, ...message };
}

/** Oldest first. */
export async function recentMessages(
  conversationId: string,
  limit = 20,
): Promise<ChatMessage[]> {
  return (await result<MessageRow[]>(database().from('messages').select('id,role,content,emotion,intent,directive_json,demo,created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit)))
    .map(hydrateMessage)
    .reverse();
}

export interface ConversationExport {
  id: string;
  startedAt: string;
  lastActiveAt: string;
  title: string | null;
  messages: ChatMessage[];
}

/** Every transcript owned by one user, with no UI-oriented message limit. */
export async function exportTranscripts(userId: string): Promise<ConversationExport[]> {
  const conversations = await allPages<{ id: string; started_at: string; last_active_at: string; title: string | null }>(
    (from, to) => database().from('conversations').select('id,started_at,last_active_at,title').eq('user_id', userId).order('started_at').order('id').range(from, to),
  );
  return Promise.all(conversations.map(async (conversation) => ({
    id: conversation.id,
    startedAt: conversation.started_at,
    lastActiveAt: conversation.last_active_at,
    title: conversation.title,
    messages: (await allPages<MessageRow>((from, to) => database().from('messages').select('id,role,content,emotion,intent,directive_json,demo,created_at').eq('conversation_id', conversation.id).order('created_at').order('id').range(from, to))).map(hydrateMessage),
  })));
}

/** Complete memory list for portability; the normal reader remains capped. */
export async function exportMemories(userId: string): Promise<MemoryRecord[]> {
  const found = await allPages<{ id: string; kind: string; key: string; value: string; confidence: number; updated_at: string }>(
    (from, to) => database().from('memories').select('id,kind,key,value,confidence,updated_at').eq('user_id', userId).order('updated_at').order('id').range(from, to),
  );
  return found.map((memory) => ({
    id: memory.id,
    kind: memory.kind as MemoryRecord['kind'],
    key: memory.key,
    value: memory.value,
    confidence: memory.confidence,
    updatedAt: memory.updated_at,
  }));
}

// --- memories ---------------------------------------------------------------
// Durable facts, distinct from the transcript (ARCHITECTURE §2).

export async function upsertMemory(
  userId: string,
  write: MemoryWrite,
  sourceMessageId?: string,
): Promise<void> {
  await result(database().rpc('evia_upsert_memory', { p_row: {
    id: newId(), user_id: userId, kind: write.kind, key: write.key, value: write.value,
    confidence: write.confidence, source_message_id: sourceMessageId ?? null, updated_at: nowIso(),
  } }));
}

export async function listMemories(userId: string, limit = 60): Promise<MemoryRecord[]> {
  return (await result<{ id: string; kind: string; key: string; value: string; confidence: number; updated_at: string }[]>(
    database().from('memories').select('id,kind,key,value,confidence,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(limit),
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
  await result(database().from('memories').delete().eq('id', id).eq('user_id', userId));
}
