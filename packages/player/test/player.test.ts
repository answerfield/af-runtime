import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { assetResolver, mountBooklet, mountItem, randomVersion, type BookletState, type ItemState } from '../src/index.js';
import * as practiceModule from '../src/practice.js';
import { workspace } from './workspace.js';

const SOURCE = `
    item p1 "Zwei Seiten" {
      page { a = Gap("Erste Frage") }
      page { b = Choice("Zweite Frage", ["ja", "nein"]) }
    }
    item p2 "Danach" { c = Gap("Letzte Frage") }
    item p3(n: Int = 2) "Mit Fassungen" {
      versions(when: n in 2 .. 4)
      p { "Rechne mit " n }
      d = Gap("Ergebnis")
    }
    coding p1 { a: correct(a == "42") }
    booklet pb "Heft" { part("Teil", time: 2min, navigation: free) { p1 p2 } }`;

let bundle: Bundle;
beforeAll(async () => {
    const { compile } = await workspace({ player: SOURCE });
    bundle = compile('player').bundle;
});

const input = (root: HTMLElement, label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (el: HTMLInputElement, value: string) => { el.value = value; el.dispatchEvent(new Event('input')); };

describe('mountItem', () => {
    test('Zustand, Seiten, Ereignisse nach Änderungen (nicht beim Start), Kodierung, Wiederaufnahme', () => {
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host')!;
        const player = mountItem(host, bundle, 'p1');
        expect(player.state).toMatchObject({ item: 'p1', page: 0, pageCount: 2, locked: false, navigation: true, timed: false } satisfies Partial<ItemState>);
        const changes: ItemState[] = [], answers: unknown[] = [], snapshots: unknown[] = [];
        player.on('change', s => changes.push(s));
        const off = player.on('responses', r => answers.push(r));
        player.on('snapshot', s => snapshots.push(s));
        expect(changes).toEqual([]);

        type(input(host, 'Erste Frage'), '42');
        expect(answers).toHaveLength(1);
        expect(snapshots).toHaveLength(1);
        expect(player.coding().variables.a.code).toBe(1);
        player.page(5);                                  // clamped
        expect(player.state.page).toBe(1);
        expect(changes.at(-1)?.page).toBe(1);
        // the second question is now displayed: that is part of the responses too
        expect(answers).toHaveLength(2);
        off();
        type(input(host, 'Erste Frage'), '43');
        expect(answers).toHaveLength(2);

        const saved = JSON.parse(JSON.stringify(player.snapshot()));
        player.dispose();
        player.dispose();                                // idempotent
        expect(host.querySelector('af-root')).toBeNull();
        const again = mountItem(host, bundle, 'p1', { restore: saved });
        expect(again.responses().variables.a.value).toBe('43');
        expect(again.state.page).toBe(1);
        expect(again.log().map(l => l.event)).toContain('input.bind');
        again.dispose();
    });

    test('Fassungen: randomVersion nach Bedarfsprofil, params im Zustand', () => {
        const next = randomVersion(bundle, 'p3', {}, { n: 2 });
        expect([3, 4]).toContain(next?.n);
        expect(randomVersion(bundle, 'p1')).toBeUndefined();
        expect(randomVersion(bundle, 'fehlt')).toBeUndefined();
        document.body.innerHTML = '<div id="host"></div>';
        const player = mountItem(document.getElementById('host')!, bundle, 'p3', { params: next! });
        expect(player.state.params).toEqual(next);
        player.dispose();
    });

    test('unbekannte Aufgabe: Fehler beim Einbetten', () => {
        expect(() => mountItem(document.body, bundle, 'fehlt')).toThrow(/nicht im Bundle/);
    });
});

describe('mountBooklet', () => {
    test('Navigation, Zeit, Testleitung, Ereignisse, Protokoll, Ende', () => {
        let now = 0;
        const realNow = Date.now;
        Date.now = () => now;
        try {
            document.body.innerHTML = '<main id="frame"></main>';
            const host = document.getElementById('frame')!;
            const player = mountBooklet(host, bundle, 'pb', { tickInterval: 0, saveInterval: 0 });
            expect(host.tabIndex).toBe(-1);
            expect(player.state).toMatchObject({ item: 'p1', itemNumber: 1, itemCount: 2, page: 0, pageCount: 2, remaining: 120, canNext: true, finished: false } satisfies Partial<BookletState>);
            const states: BookletState[] = [];
            let finished = 0;
            player.on('change', s => states.push(s));
            player.on('finished', () => finished++);

            player.next();
            expect(player.state.page).toBe(1);
            player.next();
            expect(player.state.item).toBe('p2');
            expect(document.activeElement).toBe(host);

            player.control({ kind: 'pause' });
            expect(player.state.paused).toBe(true);
            expect(host.querySelector('.af-booklet-halt')?.textContent).toBe('Pause. Es geht gleich weiter.');
            expect(host.querySelector('af-root')).toBeNull();
            player.control({ kind: 'resume' });
            expect(host.querySelector('af-root')).not.toBeNull();

            now = 30_000; player.tick();
            expect(player.state.remaining).toBe(90);
            expect(states.length).toBeGreaterThan(3);
            player.finish();
            expect(finished).toBe(1);
            expect(player.state.finished).toBe(true);
            expect(player.responses().map(r => r.item)).toEqual(['p1', 'p2']);
            expect(player.log().booklet.map(l => l.event)).toEqual(expect.arrayContaining(['start', 'navigate', 'control.pause', 'finish']));
            expect(player.accommodations()).toEqual({ accommodations: [], timeFactor: 1 });
            player.dispose();
        } finally {
            Date.now = realNow;
        }
    });
});

describe('Hilfen', () => {
    test('assetResolver: Dateiname nach Inhalt, ohne Hash aus bundles/', () => {
        const resolve = assetResolver('https://cdn.example.org/');
        expect(resolve('bilder/kreis.svg', { hash: 'sha256:abc123', size: 1, type: 'image/svg+xml' })).toMatch(/^https:\/\/cdn\.example\.org\/abc123.*\.svg$/);
        expect(resolve('bilder/kreis.svg', undefined)).toBe('bundles/bilder/kreis.svg');
    });
});

describe('Üben ohne Paket', () => {
    test('check() lehnt mit einer verständlichen Meldung ab, wenn practice fehlt', async () => {
        const spy = vi.spyOn(practiceModule, 'loadPractice').mockRejectedValue(new Error('Üben braucht das Paket @answerfield/practice.'));
        document.body.innerHTML = '<div id="host"></div>';
        const player = mountItem(document.getElementById('host')!, bundle, 'p2', { practice: true });
        await expect(player.check()).rejects.toThrow('Üben braucht das Paket @answerfield/practice.');
        player.dispose();
        spy.mockRestore();
    });
});
