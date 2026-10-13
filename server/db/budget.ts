import { database, result, allPages } from '../lib/data-api.ts';
import type { Json } from './database.types.ts';

export interface ReservationRow {
  operation_id: string;
  user_id: string;
  day: string;
  provider: string;
  unit: string;
  estimated_units: number;
  status: 'pending' | 'settled' | 'refunded' | 'failed';
  actual_units: number | null;
  fail_reason: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface BudgetUsage {
  userLedgerTurns: number;
  userPendingTurns: number;
  globalLedgerTurns: number;
  globalPendingTurns: number;
  globalLedgerTokens: number;
  globalPendingTokenEstimates: number;
}

export interface BudgetCaps { p_user_cap: number; p_turn_cap: number; p_token_cap: number }
type StoredResult<R extends string> = { ok: true; reservation: ReservationRow; duplicate: boolean } | { ok: false; reason: R };

export function reserveBudget(input: Json, caps: BudgetCaps) {
  return result<StoredResult<'user_turns' | 'global_turns' | 'global_tokens'>>(
    database().rpc('evia_budget_reserve', { p_input: input, ...caps }),
  );
}

export function transitionBudget(operationId: string, status: 'settled' | 'refunded' | 'failed',
  actualUnits: number | null, failReason: string | null, inputTokens = 0, outputTokens = 0) {
  return result<StoredResult<'unknown_operation'>>(database().rpc('evia_budget_transition', {
    p_operation_id: operationId, p_status: status, p_actual_units: actualUnits, p_fail_reason: failReason,
    p_input_tokens: inputTokens, p_output_tokens: outputTokens,
  }));
}

export function readBudgetUsage(day: string, userId: string) {
  return result<BudgetUsage>(database().rpc('evia_budget_usage', { p_day: day, p_user_id: userId }));
}

export function readBudgetAllowance(day: string, userId: string, caps: BudgetCaps) {
  return result<{ ok: boolean; reason: '' | 'user_turns' | 'global_turns' | 'global_tokens' }>(
    database().rpc('evia_budget_allowance', { p_day: day, p_user_id: userId, ...caps }),
  );
}

const columns = 'operation_id,user_id,day,provider,unit,estimated_units,status,actual_units,fail_reason,created_at,settled_at';

export function getBudgetReservation(operationId: string) {
  return result<ReservationRow | null>(database().from('budget_reservations').select(columns).eq('operation_id', operationId).maybeSingle());
}

export function pendingBudgetReservations(day?: string) {
  return allPages<ReservationRow>((from, to) => {
    let query = database().from('budget_reservations').select(columns).eq('status', 'pending');
    if (day !== undefined) query = query.eq('day', day);
    return query.order('created_at').order('operation_id').range(from, to);
  });
}
