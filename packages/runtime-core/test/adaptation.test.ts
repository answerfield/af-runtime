import { describe, expect, test } from 'vitest';
import { adaptationReport } from '../src/index.js';
import { workspace } from './workspace.js';

describe('Übersicht für Adaptierende', () => {
    test('Sprachstufen: angepasste und unveränderte Texte; Grafiken mit Beschreibung; Ausschlüsse mit Begründung', async () => {
        const { compile } = await workspace({
            overview: `
            item ue1 "Eier" {
              p {
                "In einen Eierkarton passen sechs Eier hinein."
                variant(simple_language) "In einen Karton passen 6 Eier."
                variant(easy_language) { p "Ein Karton hat 6 Eier." }
              }
              p "Herr Lindqvist kauft vier volle Kartons."
              plane(x: 0 .. 4, y: 0 .. 2) {
                variant(extended_descriptions) "Ein Karton mit zwei Reihen."
                dot(at: point(1, 1))
              }
              plane(x: 0 .. 4) { dot(at: point(1, 0)) }
              count = Choice(wording("Mit welcher Rechnung geht es?", easy: "Welche Rechnung passt?"), ["6 + 4", "6 · 4"])
            }
            item ue2 "Lesen" {
              deny({simple_language, easy_language}, reason: "misst Leseverstehen")
              p "Lies den Text ganz genau."
            }`
        });
        const bundle = compile('overview').bundle;
        const report = adaptationReport(bundle, 'ue1');
        expect(report.denied).toEqual([]);
        expect(report.levels).toEqual([
            { level: 'simple', total: 3, adapted: 1, unchanged: ['Herr Lindqvist kauft vier volle Kartons.', 'Mit welcher Rechnung geht es?'] },
            { level: 'easy', total: 3, adapted: 2, unchanged: ['Herr Lindqvist kauft vier volle Kartons.'] }
        ]);
        expect(report.graphics).toEqual({ total: 2, described: 1 });
        expect(report.varies).toBe(false);

        const reading = adaptationReport(bundle, 'ue2');
        expect(reading).toMatchObject({ denied: ['simple_language', 'easy_language'], reason: 'misst Leseverstehen', levels: [] });
        expect(() => adaptationReport(bundle, 'fehlt')).toThrow(/nicht im Bundle/);
    });
});
