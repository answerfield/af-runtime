import { beforeAll, describe, expect, test } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { bundleProblem } from '@answerfield/bundle';
import { createBookletInstance, createItemInstance, type BookletOptions } from '../src/index.js';
import { workspace } from './workspace.js';
import { all, find } from './tree.js';

let bundle: Bundle;

beforeAll(async () => {
    bundle = (await workspace()).compile('booklet.af').bundle;
});

function start(options: BookletOptions = {}) {
    let time = 1_000_000;
    const clock = { advance: (seconds: number) => { time += seconds * 1000; } };
    const booklet = createBookletInstance(bundle, 'brueche', { now: () => time, ...options });
    return { booklet, clock };
}

const at = (b: ReturnType<typeof start>['booklet']) => `${b.part.get().name}/${b.current.get().item.name}`;

describe('Testheft', () => {
    test('Ablauf: Instruktion, dann Teil mit Zeitlimit; kein Zurück in einen früheren Teil', () => {
        const { booklet } = start();
        expect(at(booklet)).toBe('teil1/brueche.teil1.1');
        expect(booklet.remaining.get()).toBeUndefined();
        expect(booklet.atPartEnd.get()).toBe(true);
        booklet.next();
        expect(at(booklet)).toBe('teil2/fraction1');
        expect(booklet.remaining.get()).toBe(1200);
        expect(booklet.canPrevious.get()).toBe(false);   // start of the part
        booklet.next();
        booklet.next();
        expect(at(booklet)).toBe('teil2/fraction3');
        expect(booklet.atPartEnd.get()).toBe(true);
        booklet.previous();
        expect(at(booklet)).toBe('teil2/fraction2');
        booklet.goTo(0);
        expect(at(booklet)).toBe('teil2/fraction1');
    });

    test('nicht erreichte Aufgaben werden als not_reached kodiert, gesehene als omitted', () => {
        const { booklet } = start();
        booklet.next();                                   // fraction1 is displayed
        const coding = booklet.coding();
        expect(coding.map(c => c.item)).toEqual(['fraction1', 'fraction2', 'fraction3']);
        expect(coding[0].variables.reduce).toEqual({ missing: 'omitted' });
        expect(coding[1].variables.shading).toEqual({ missing: 'not_reached' });
        expect(coding[2].variables.mark).toEqual({ missing: 'not_reached' });
    });

    test('Zeitlimit: Restzeit zählt herunter, bei Ablauf endet der Teil; extended_time verlängert', () => {
        const { booklet, clock } = start();
        booklet.next();
        clock.advance(300);
        booklet.tick();
        expect(booklet.remaining.get()).toBe(900);
        clock.advance(900);
        booklet.tick();
        expect(booklet.finished.get()).toBe(true);
        expect(booklet.log.map(l => l.event)).toContain('timeout');

        const extended = start({ profile: { timing: { extension: 1.5 } } }).booklet;
        extended.next();
        expect(extended.timeFactor).toBe(1.5);
        expect(extended.remaining.get()).toBe(1800);
    });

    test('Studienregeln begrenzen das Bedarfsprofil', () => {
        const { booklet } = start({ profile: { display: { contrast: 'high' }, content: { simple_language: true } } });
        expect([...booklet.accommodations]).toEqual(['contrast']);
    });

    test('Wiederaufnahme: Position, Antworten und verbrauchte Zeit bleiben erhalten', () => {
        const first = start();
        first.booklet.next();
        find(first.booklet.current.get().nodes, 'input', 'gekürzter Bruch').emit('bind', '3/4');
        first.clock.advance(100);
        first.booklet.next();
        all(first.booklet.current.get().nodes, 'toggle').slice(0, 6).forEach(t => t.emit('check'));
        first.clock.advance(50);
        const snapshot = JSON.parse(JSON.stringify(first.booklet.snapshot()));
        expect(snapshot.position).toEqual({ part: 1, entry: 1 });
        expect(snapshot.elapsed.teil2).toBe(150_000);

        const second = start({ restore: snapshot });
        expect(at(second.booklet)).toBe('teil2/fraction2');
        expect(second.booklet.remaining.get()).toBe(1050);
        // the log continues; times are relative to the booklet start
        expect(second.booklet.log.map(l => l.event)).toEqual(['start', 'part.leave', 'navigate', 'navigate', 'resume']);
        expect(second.booklet.items.get('fraction1')!.log.map(l => [l.event, l.t])).toEqual([['input.bind', 0]]);
        const coding = second.booklet.coding();
        expect(coding[0].variables.reduce).toMatchObject({ code: 1 });
        expect(coding[1].variables.shading).toMatchObject({ code: 1 });
        expect(coding[2].variables.mark).toEqual({ missing: 'not_reached' });
    });

    test('beenden: keine Navigation mehr, Antworten bleiben', () => {
        const { booklet } = start();
        booklet.next();
        booklet.finish();
        expect(booklet.finished.get()).toBe(true);
        booklet.next();
        expect(at(booklet)).toBe('teil2/fraction1');
        expect(booklet.canNext.get()).toBe(false);
    });
});

describe('Steuerung durch die Testleitung', () => {
    const source = `
        item s1 "Eins" { a = Gap("A") }
        item s2 "Zwei" { b = Gap("B") }
        booklet steuer "Gesteuert" {
          part("Einführung") { instruction("Willkommen") { p "Gleich geht es los." } }
          part("Aufgaben", time: 10min, start: released) { s1 s2 }
        }`;
    async function begin(restore?: BookletOptions['restore']) {
        const b = (await workspace({ control: source })).compile('control').bundle;
        expect(b.booklets![0].parts[1].start).toBe('released');
        let time = 0;
        const clock = { advance: (s: number) => { time += s * 1000; } };
        return { booklet: createBookletInstance(b, 'steuer', { now: () => time, restore }), clock, bundle: b };
    }

    test('Teil wartet auf Freigabe; seine Zeit läuft erst danach', async () => {
        const { booklet, clock } = await begin();
        booklet.next();
        expect(booklet.part.get().name).toBe('teil2');
        expect(booklet.waiting.get()).toBe(true);
        expect(booklet.canNext.get()).toBe(false);
        clock.advance(120);
        booklet.tick();
        expect(booklet.remaining.get()).toBe(600);
        // before release nothing is displayed (not reached)
        expect(booklet.responses()[0].variables.a.displayed).toBe(false);
        booklet.control({ kind: 'release' });
        expect(booklet.waiting.get()).toBe(false);
        expect(booklet.responses()[0].variables.a.displayed).toBe(true);
        clock.advance(60);
        booklet.tick();
        expect(booklet.remaining.get()).toBe(540);
    });

    test('Pause hält Uhr und Eingaben an, Verlängern und Beenden', async () => {
        const { booklet, clock } = await begin();
        booklet.control({ kind: 'release', part: 'teil2' });
        booklet.next();
        expect(booklet.waiting.get()).toBe(false);
        clock.advance(100);
        booklet.control({ kind: 'pause' });
        expect(booklet.paused.get()).toBe(true);
        expect(booklet.canNext.get()).toBe(false);
        clock.advance(300);
        booklet.tick();
        expect(booklet.remaining.get()).toBe(500);
        booklet.control({ kind: 'resume' });
        booklet.control({ kind: 'extend', seconds: 120 });
        clock.advance(20);
        booklet.tick();
        expect(booklet.remaining.get()).toBe(600);
        booklet.control({ kind: 'end', part: 'teil2' });
        expect(booklet.finished.get()).toBe(true);
        expect(booklet.log.map(l => l.event).filter(e => e.startsWith('control'))).toEqual([
            'control.release', 'control.pause', 'control.resume', 'control.extend', 'control.end']);
    });

    test('Befehle mit Nummer wirken einmal; Zustand übersteht die Wiederaufnahme', async () => {
        const { booklet, clock, bundle } = await begin();
        booklet.next();
        booklet.control({ kind: 'release', seq: 1 });
        booklet.control({ kind: 'extend', seconds: 60, seq: 2 });
        booklet.control({ kind: 'extend', seconds: 60, seq: 2 });   // delivered twice
        booklet.control({ kind: 'pause', seq: 3 });
        clock.advance(30);
        const snapshot = JSON.parse(JSON.stringify(booklet.snapshot()));
        expect(snapshot.control).toEqual({ released: ['teil2'], paused: true, extra: { teil2: 60 }, seq: 3 });
        const resumed = createBookletInstance(bundle, 'steuer', { now: () => 30_000, restore: snapshot });
        expect(resumed.paused.get()).toBe(true);
        expect(resumed.remaining.get()).toBe(660);
        resumed.control({ kind: 'resume', seq: 3 });   // old sequence number: ignored
        expect(resumed.paused.get()).toBe(true);
        resumed.control({ kind: 'resume', seq: 4 });
        expect(resumed.paused.get()).toBe(false);
    });
});

describe('Robust gegenüber fremden und alten Daten', () => {
    test('Bundle mit falschem Format oder anderer Version wird abgelehnt', () => {
        expect(() => createBookletInstance({ ...bundle, format: 'x' as never }, 'brueche')).toThrow(/Kein AF-Bundle/);
        expect(() => createBookletInstance({ ...bundle, version: '9.0' }, 'brueche')).toThrow(/Version 9.0 wird nicht unterstützt/);
        expect(() => createItemInstance({ ...bundle, version: '0.2' }, 'fraction1')).toThrow(/nicht unterstützt/);
        expect(bundleProblem(bundle)).toBeUndefined();
    });

    test('gespeicherter Zustand ändert sich nicht nachträglich (Protokoll als Kopie)', () => {
        const { booklet } = start();
        const snap = booklet.snapshot();
        const before = JSON.stringify(snap);
        booklet.next();
        booklet.next();
        expect(JSON.stringify(snap)).toBe(before);
        const item = createItemInstance(bundle, 'fraction1');
        const own = item.snapshot();
        find(item.nodes, 'input', 'gekürzter Bruch').emit('bind', '3/4');
        expect((own.$log as unknown[]).length).toBe(0);
    });

    test('Stelle aus einer anderen Fassung des Testhefts: Beginn statt Absturz; fehlende Aufgabenzustände', () => {
        const restore = { ...start().booklet.snapshot(), position: { part: 7, entry: 3 }, items: undefined as never };
        const { booklet } = start({ restore });
        expect(at(booklet)).toBe('teil1/brueche.teil1.1');
        const page = createItemInstance(bundle, 'fraction1', { restore: { $page: -1 } });
        expect(page.page.get()).toBe(0);
    });
});
