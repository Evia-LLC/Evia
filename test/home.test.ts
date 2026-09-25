import { describe, expect, it } from 'vitest';
import { HOME_TAGLINE, HOME_WALL, buildHome, salutationFor } from '../src/view/home.ts';
import { SAMPLE_HOME } from '../src/sample/fixtures/home.ts';
import { TIPS, TIP_TITLE, tipFor } from '../src/pages/home/tips.ts';
import { LOUNGE_FALLBACK_FRAME, frameFromAnchors, plateRect, type PlateFrame } from '../src/pages/home/stage.ts';
import { parseAnchors } from '../src/stage/room-anchors.ts';
import { visibleMessages } from '../src/chat/transcript.ts';
import type { ChatMessage } from '../shared/types.ts';
import { readFileSync } from 'node:fs';

/*
 * Home in real mode shows only what the account has (specs/data-map.md
 * section 2), sample mode shows the mockup's own words, and the room plate
 * is placed so its edges are never seen.
 */

const afternoon = new Date(2026, 8, 24, 15, 0);

describe('buildHome (real mode)', () => {
  it('greets an account by its display name, with nothing it does not have', () => {
    const view = buildHome({ now: afternoon, guest: false, displayName: 'Ada', hasScan: true });
    expect(view.salutation).toBe('Good afternoon,');
    expect(view.name).toBe('Ada');
    expect(view.profileName).toBe('Ada');
    expect(view.membership).toBeNull();
    expect(view.notifications).toBe(0);
    expect(view.actions).toEqual({ look: true, changed: true });
  });

  it('gives a guest a salutation on its own, not "there"', () => {
    const view = buildHome({ now: afternoon, guest: true, displayName: 'there', hasScan: false });
    expect(view.name).toBeNull();
    expect(view.salutation).toBe('Good afternoon.');
    expect(view.profileName).toBe('Guest');
    expect(view.actions.changed).toBe(false);
  });

  it('treats a blank name, or the stored stand-in for one, as no name', () => {
    expect(buildHome({ now: afternoon, guest: false, displayName: '  ', hasScan: false }).name).toBeNull();
    const unnamed = buildHome({ now: afternoon, guest: false, displayName: 'friend', hasScan: false });
    expect(unnamed.name).toBeNull();
    expect(unnamed.salutation).toBe('Good afternoon.');
    expect(unnamed.profileName).toBe('');
  });

  it('draws its tip from the reviewed list, never anything else', () => {
    for (let day = 0; day < 40; day++) {
      const view = buildHome({ now: new Date(2026, 0, 1 + day, 9), guest: false, displayName: 'Ada', hasScan: false });
      expect(view.tip.title).toBe(TIP_TITLE);
      expect(TIPS).toContain(view.tip.body);
    }
  });

  it('shows no score, measurement or percentage anywhere', () => {
    const view = buildHome({ now: afternoon, guest: false, displayName: 'Ada', hasScan: true });
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/\d+\s*%|\/\s*100|score/i);
  });
});

describe('salutationFor', () => {
  it('follows the local clock', () => {
    const at = (h: number) => salutationFor(new Date(2026, 8, 24, h, 30));
    expect(at(3)).toBe('Still up');
    expect(at(8)).toBe('Good morning');
    expect(at(12)).toBe('Good afternoon');
    expect(at(19)).toBe('Good evening');
  });
});

describe('tipFor', () => {
  it('is the same all day and moves on the next', () => {
    expect(tipFor(new Date(2026, 8, 24, 0, 5))).toBe(tipFor(new Date(2026, 8, 24, 23, 55)));
    expect(tipFor(new Date(2026, 8, 24, 12))).not.toBe(tipFor(new Date(2026, 8, 25, 12)));
  });
});

describe('SAMPLE_HOME', () => {
  it('is the mockup, word for word (specs/home.md section 7)', () => {
    expect(SAMPLE_HOME.salutation).toBe('Good afternoon,');
    expect(SAMPLE_HOME.name).toBe('Destiny');
    expect(SAMPLE_HOME.question).toEqual(['How’s your skin', 'feeling today?']);
    expect(SAMPLE_HOME.membership).toBe('Premium Member');
    expect(SAMPLE_HOME.tip).toEqual({
      title: 'A quick tip from Evia',
      body: 'Your evening routine matters too — consistency is key.',
    });
    expect(SAMPLE_HOME.tagline).toEqual(HOME_TAGLINE);
    expect(SAMPLE_HOME.wall).toEqual(HOME_WALL);
  });
});

describe('plateRect', () => {
  const lounge = frameFromAnchors(parseAnchors(JSON.parse(readFileSync('public/env/lounge/anchors.json', 'utf8'))));

  const covers = (frame: PlateFrame, right: number, height: number, compact: boolean) => {
    const r = plateRect(frame, { right, height, compact });
    expect(r.left).toBeLessThanOrEqual(0.001);
    expect(r.top).toBeLessThanOrEqual(0.001);
    expect(r.left + r.width).toBeGreaterThanOrEqual(right - 0.001);
    expect(r.top + r.height).toBeGreaterThanOrEqual(height - 0.001);
    return r;
  };

  it('reads the published lounge render', () => {
    expect(lounge.w).toBe(2560);
    expect(lounge.h).toBe(1440);
    expect(lounge.ref[2]).toBeGreaterThan(lounge.ref[0]);
  });

  it('reproduces ref1 under the Routine panel: its Home panel fills the visible part', () => {
    const r = covers(lounge, 1000, 1024, false);
    const [x0, y0, x1, y1] = lounge.ref;
    // ref1's panel is as tall as the window and ends where Home ends.
    expect((y1 - y0) * r.height).toBeCloseTo(1024, 0);
    expect(r.left + x1 * r.width).toBeCloseTo(1000, 0);
    expect(r.left + x0 * r.width).toBeCloseTo(1000 - 994, 0);
  });

  it('covers every window shape it is given, with no edge showing', () => {
    for (const [w, h] of [
      [1536, 1024],
      [1280, 800],
      [1920, 1080],
      [2560, 1080],
      [1024, 1366],
      [820, 1180],
    ]) {
      covers(lounge, w, h, false);
      covers(LOUNGE_FALLBACK_FRAME, w, h, false);
    }
    for (const [w, h] of [
      [390, 844],
      [360, 740],
      [768, 1024],
      [812, 375],
    ]) {
      covers(lounge, w, h, true);
      covers(LOUNGE_FALLBACK_FRAME, w, h, true);
    }
  });

  it('keeps the armchair and the sign beside it whole on a phone', () => {
    for (const [w, h] of [
      [390, 844],
      [360, 740],
      [430, 932],
    ]) {
      const r = covers(lounge, w, h, true);
      const x = (u: number) => r.left + u * r.width;
      expect(x(lounge.group[0])).toBeGreaterThanOrEqual(0);
      expect(x(lounge.group[1])).toBeLessThanOrEqual(w);
      expect(x(lounge.seat[0])).toBeGreaterThan(w * 0.25);
      expect(x(lounge.seat[0])).toBeLessThan(w * 0.6);
    }
  });

  it('frames the phone-portrait render (anchors-mobile.json) with the armchair in view', () => {
    const phone = frameFromAnchors(parseAnchors(JSON.parse(readFileSync('public/env/lounge/anchors-mobile.json', 'utf8'))));
    expect([phone.w, phone.h]).toEqual([1080, 2340]);
    for (const [w, h] of [
      [390, 844],
      [360, 740],
      [430, 932],
      [768, 1024],
    ]) {
      const r = covers(phone, w, h, true);
      const seatX = r.left + phone.seat[0] * r.width;
      const seatY = r.top + phone.seat[1] * r.height;
      expect(seatX).toBeGreaterThan(w * 0.2);
      expect(seatX).toBeLessThan(w * 0.8);
      expect(seatY).toBeGreaterThan(h * 0.3);
      expect(seatY).toBeLessThan(h * 0.85);
    }
  });

  it('falls back to the stand-in frame without a render', () => {
    expect(frameFromAnchors(null)).toBe(LOUNGE_FALLBACK_FRAME);
  });
});

describe('the chat transcript in sample mode', () => {
  const since = Date.parse('2026-09-24T12:00:00Z');
  const line = (id: string, at: string, role: ChatMessage['role'] = 'elohim'): ChatMessage => ({
    id,
    role,
    content: id,
    createdAt: at,
  });
  const stored = [line('old-1', '2026-09-24T10:38:08Z'), line('old-2', '2026-09-24T11:49:03Z')];
  const now = [line('local-1', '2026-09-24T12:00:05Z', 'user'), line('elohim-1', '2026-09-24T12:00:06Z')];
  const all = [...stored, ...now];

  it('shows everything outside sample mode', () => {
    expect(visibleMessages(all, { sampleOn: false, guest: false, sampleSince: since })).toBe(all);
  });

  it("keeps an account's stored transcript out of the sample", () => {
    const shown = visibleMessages(all, { sampleOn: true, guest: false, sampleSince: since });
    expect(shown.map((m) => m.id)).toEqual(['local-1', 'elohim-1']);
  });

  it('has nothing to hide for a guest', () => {
    expect(visibleMessages(all, { sampleOn: true, guest: true, sampleSince: since })).toBe(all);
  });

  it('drops a line whose time cannot be read rather than guess', () => {
    const odd = [line('odd', 'not a date')];
    expect(visibleMessages(odd, { sampleOn: true, guest: false, sampleSince: since })).toEqual([]);
  });
});
