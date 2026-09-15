/**
 * The client half of the character state machine.
 *
 * The server already sanitised the directive; this validates it a second time
 * against the transition table before anything reaches the rig. Two checks, not
 * one — the rule from the brief is that an unrecognised or illegal animation
 * command must never break the UI, and the renderer is the last place to enforce
 * that.
 */
import {
  canTransition,
  resolveDirective,
  sanitiseDirective,
  STATE_BLEND_SECONDS,
} from '@shared/character-fsm.ts';
import {
  DEFAULT_DIRECTIVE,
  type CharacterDirective,
  type CharacterState,
} from '@shared/types.ts';

export interface PoseTargets {
  /** Blend of the incoming state, 0..1. */
  blend: number;
  state: CharacterState;
  previous: CharacterState;
  directive: CharacterDirective;
}

export class CharacterStateMachine {
  private current: CharacterDirective = { ...DEFAULT_DIRECTIVE };
  private previousState: CharacterState = 'IDLE';
  private blend = 1;
  private blendDuration = 0.5;

  /** Rejections are surfaced so the app can log them rather than swallow them. */
  onRejected: ((info: { reason: string; detail: string }) => void) | null = null;

  get directive(): CharacterDirective {
    return this.current;
  }

  get state(): CharacterState {
    return this.current.state;
  }

  /** Accepts anything. Coerces, validates, and never throws. */
  apply(input: unknown): void {
    const { directive, rejected } = sanitiseDirective(input);
    if (rejected.length) {
      this.onRejected?.({ reason: 'unknown directive value', detail: rejected.join(', ') });
    }

    const { directive: resolved, blocked } = resolveDirective(this.current.state, directive);
    if (blocked) {
      this.onRejected?.({
        reason: 'illegal transition',
        detail: `${this.current.state} -> ${directive.state}`,
      });
    }

    if (resolved.state !== this.current.state) {
      this.previousState = this.current.state;
      this.blend = 0;
      this.blendDuration = STATE_BLEND_SECONDS[resolved.state];
    }
    this.current = resolved;
  }

  /** Direct state change from app logic (not the model) — still validated. */
  force(state: CharacterState, partial: Partial<CharacterDirective> = {}): void {
    if (!canTransition(this.current.state, state)) {
      // Application-driven transitions that the table forbids are a bug in the
      // caller, not in the model. Log loudly rather than silently allowing it.
      this.onRejected?.({
        reason: 'app requested illegal transition',
        detail: `${this.current.state} -> ${state}`,
      });
      return;
    }
    this.apply({ ...this.current, ...partial, state });
  }

  update(dt: number): PoseTargets {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / Math.max(0.01, this.blendDuration));
    }
    return {
      blend: this.blend,
      state: this.current.state,
      previous: this.previousState,
      directive: this.current,
    };
  }
}
