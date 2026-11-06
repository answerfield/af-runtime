import { describe, expect, test } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { createBookletInstance, createItemInstance, type ItemInstance, type RElement } from '../src/index.js';
import { workspace } from './workspace.js';
import { all, find } from './tree.js';

const source = `
    item hv1 "Am Bootssteg" {
      Listen(src: "https://example.org/boot.mp3", plays: 2, prepare: 30s, pause: 10s, finish: 1min)
      a = Gap("Wann legt das Boot ab?")
      show(when: heard() >= 2) { b = Gap("Nach dem zweiten Hören") }
    }
    item hv2 "Danach" { c = Gap("Weiter") }
    item self "Selbst starten" {
      Play(src: "https://example.org/a.mp3", plays: 2)
      d = Gap("Antwort")
    }
    item zeit "Bearbeitungszeit" {
      Ticket(minutes: 2min)
      e = Gap("Rechne")
    }
    component Ticket(minutes: Duration, state over: Bool = false) {
      timer(duration: minutes, label: "Bearbeitungszeit", on elapsed: over := true)
      flow(locked: over)
    }
    booklet hv "Hörverstehen" { part("Hören", navigation: forward) { hv1 hv2 } }
    booklet zh "Zeit" { part("Rechnen") { zeit hv2 } }`;

async function bundle(): Promise<Bundle> {
    const { compile } = await workspace({ hv: source });
    return compile('hv').bundle;
}

const media = (i: ItemInstance): RElement => find(i.nodes, 'media');
const timers = (i: ItemInstance) => all(i.nodes, 'timer').map(t => t.timer!.state.peek());
const phase = (i: ItemInstance) => i.snapshot()['/Listen#0.phase'];

describe('Uhr, Medien und Ablauf: Listen', () => {
    test('laden → Lesezeit → 2 Wiedergaben mit Pause → Nachbearbeitung → gesperrt', async () => {
        let now = 0;
        const item = createItemInstance(await bundle(), 'hv1', { now: () => now });
        expect(phase(item)).toBe('loading');
        expect(item.flow.navigation.peek()).toBe(false);

        media(item).media!.ready();
        expect(phase(item)).toBe('reading');
        expect(timers(item)[0]).toMatchObject({ running: true, remaining: 30000 });
        now = 12000; item.clock!.tick();
        expect(timers(item)[0].remaining).toBe(18000);
        now = 30000; item.clock!.tick();
        expect(phase(item)).toBe('playing');
        expect(media(item).media!.playing.peek()).toBe(true);

        find(item.nodes, 'input', 'Wann legt das Boot ab?').emit('bind', 'um 14 Uhr');
        media(item).media!.ended();
        expect(item.clock!.heard.peek()).toBe(1);
        expect(phase(item)).toBe('pausing');
        expect(timers(item)[1]).toMatchObject({ running: true, remaining: 10000 });
        now = 40000; item.clock!.tick();
        expect(phase(item)).toBe('playing');
        expect(item.snapshot()['/Listen#0.play']).toBe(2);
        media(item).media!.ended();
        expect(phase(item)).toBe('finishing');
        expect(timers(item)[2].remaining).toBe(60000);
        expect(item.responses().variables.b.displayed).toBe(true);

        now = 100000; item.clock!.tick();
        expect(phase(item)).toBe('done');
        expect(item.flow.locked.peek()).toBe(true);
        expect(item.flow.navigation.peek()).toBe(true);
        expect(item.flow.advance.peek()).toBe(true);
        find(item.nodes, 'input', 'Wann legt das Boot ab?').emit('bind', 'um 16 Uhr');
        expect(item.responses().variables.a.value).toBe('um 14 Uhr');
        expect(item.log.map(l => l.event).filter(e => /^(timer|media)\.|locked$/.test(e))).toEqual([
            'media.ready', 'timer.start', 'timer.elapsed', 'media.ended', 'timer.start', 'timer.elapsed', 'media.ended',
            'timer.start', 'timer.elapsed', 'input.bind.locked'
        ]);
    });

    test('verlängerte Zeit wirkt auf die Uhren, nicht auf die Wiedergabe', async () => {
        const item = createItemInstance(await bundle(), 'hv1', { now: () => 0, accommodations: ['extended_time'] });
        media(item).media!.ready();
        expect(timers(item)[0]).toMatchObject({ remaining: 45000, duration: 45000 });
    });

    test('Wiederaufnahme: Uhren laufen mit der Restzeit weiter, eine unterbrochene Wiedergabe beginnt neu', async () => {
        const b = await bundle();
        let now = 0;
        const first = createItemInstance(b, 'hv1', { now: () => now });
        media(first).media!.ready();
        now = 30000; first.clock!.tick();
        media(first).media!.ended();            // 1st play over, pause running
        now = 34000;
        const pause = JSON.parse(JSON.stringify(first.snapshot()));
        now = 40000; first.clock!.tick();        // 2nd play starts …
        const playing = JSON.parse(JSON.stringify(first.snapshot()));

        const resumedPause = createItemInstance(b, 'hv1', { now: () => now, restore: pause });
        expect(phase(resumedPause)).toBe('pausing');
        expect(timers(resumedPause)[1].remaining).toBe(6000);
        media(resumedPause).media!.ready();      // reload does not reset the phase
        expect(phase(resumedPause)).toBe('pausing');
        expect(resumedPause.clock!.heard.peek()).toBe(1);

        const resumedPlay = createItemInstance(b, 'hv1', { now: () => now, restore: playing });
        expect(media(resumedPlay).media!.playing.peek()).toBe(true);   // the renderer starts it from the beginning
        expect(resumedPlay.clock!.heard.peek()).toBe(1);
    });

    test('Testheft: keine Navigation während des Ablaufs, danach von selbst weiter; Pause der Testleitung danach', async () => {
        let now = 0;
        const booklet = createBookletInstance(await bundle(), 'hv', { now: () => now });
        const item = booklet.current.peek();
        media(item).media!.ready();
        booklet.tick();
        expect(booklet.canNext.peek()).toBe(false);
        booklet.next();
        expect(booklet.current.peek().item.name).toBe('hv1');
        booklet.control({ kind: 'pause' });
        expect(booklet.paused.peek()).toBe(false);
        now = 30000; booklet.tick();
        media(item).media!.ended();
        now = 40000; booklet.tick();
        media(item).media!.ended();
        expect(booklet.current.peek().item.name).toBe('hv1');
        now = 100000; booklet.tick();
        expect(booklet.current.peek().item.name).toBe('hv2');
        expect(booklet.paused.peek()).toBe(true);
        expect(booklet.log.map(l => l.event)).toEqual(expect.arrayContaining(['control.pause.deferred', 'flow.advance', 'control.pause']));
    });
});

describe('Play: selbst starten (wie im IQB-Player)', () => {
    test('Knopf je Wiedergabe, höchstens plays-mal, keine Sperre, Navigation frei', async () => {
        const item = createItemInstance(await bundle(), 'self', { now: () => 0 });
        const button = find(item.nodes, 'toggle');
        expect(media(item).media!.playing.peek()).toBe(false);
        expect(item.flow.navigation.peek()).toBe(true);
        button.emit('check');
        expect(media(item).media!.playing.peek()).toBe(true);
        media(item).media!.ended();
        expect(media(item).media!.playing.peek()).toBe(false);
        button.emit('check');
        media(item).media!.ended();
        expect(item.clock!.heard.peek()).toBe(2);
        expect(button.props.peek().args.disabled).toBe(true);
        button.emit('check');
        expect(media(item).media!.playing.peek()).toBe(false);
        expect(item.flow.locked.peek()).toBe(false);
        find(item.nodes, 'input', 'Antwort').emit('bind', 'noch möglich');
        expect(item.responses().variables.d.value).toBe('noch möglich');
    });
});

describe('timer als allgemeine Uhr', () => {
    test('läuft nur, solange die Aufgabe zu sehen ist; war sie beim Speichern abgelaufen, feuert elapsed nach dem Neuladen genau einmal', async () => {
        const b = await bundle();
        let now = 0;
        const booklet = createBookletInstance(b, 'zh', { now: () => now });
        const item = booklet.current.peek();
        expect(timers(item)[0]).toMatchObject({ running: true, remaining: 120000 });
        now = 60000; booklet.tick();
        booklet.control({ kind: 'pause' });      // no fixed schedule: pauses at once, the clock stands
        now = 600000; booklet.tick();
        expect(timers(item)[0].remaining).toBe(60000);
        booklet.control({ kind: 'resume' });
        now = 630000; booklet.tick();
        expect(item.flow.locked.peek()).toBe(false);
        now = 660000;                             // time is up, saved before the next tick
        const saved = JSON.parse(JSON.stringify(booklet.snapshot()));

        now = 900000;                             // time without the page loaded does not count
        const again = createBookletInstance(b, 'zh', { now: () => now, restore: saved });
        const resumed = again.current.peek();
        again.tick();
        expect(resumed.flow.locked.peek()).toBe(true);
        expect(resumed.log.filter(l => l.event === 'timer.elapsed')).toHaveLength(1);
        again.tick();
        expect(resumed.log.filter(l => l.event === 'timer.elapsed')).toHaveLength(1);
    });
});
