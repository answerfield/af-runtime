import { beforeAll, describe, expect, test } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { Point, Rational, display } from '@answerfield/expr';
import { batch, codeResponses, computed, createItemInstance, effect, randomVersion, requestedAccommodations, signal, untracked, versionsFor } from '../src/index.js';
import { workspace } from './workspace.js';
import { all, find } from './tree.js';

let bundles: Record<string, Bundle>;

beforeAll(async () => {
    const { compile } = await workspace();
    bundles = Object.fromEntries(['fraction1', 'fraction2', 'fraction3', 'reading3'].map(n => [n, compile(`${n}.af`).bundle]));
});

describe('Signale', () => {
    test('computed und effect folgen Änderungen, batch fasst zusammen', () => {
        const a = signal(1), b = signal(2);
        const sum = computed(() => a.get() + b.get());
        const seen: number[] = [];
        const stop = effect(() => { seen.push(sum.get()); });
        a.set(5);
        b.set(5);
        stop();
        a.set(100);
        expect(seen).toEqual([3, 7, 10]);
    });

    test('batch lässt Effekte einmal am Ende laufen, untracked erzeugt keine Abhängigkeit', () => {
        const a = signal(1), b = signal(2);
        const seen: number[] = [];
        effect(() => { seen.push(a.get() + untracked(() => b.get())); });
        batch(() => { a.set(2); a.set(3); });
        b.set(10);
        expect(seen).toEqual([3, 5]);
    });

    test('gleiches Ergebnis eines computed löst Abnehmer nicht erneut aus', () => {
        const n = signal(1);
        const even = computed(() => n.get() % 2 === 0);
        let runs = 0;
        effect(() => { even.get(); runs++; });
        n.set(3);
        n.set(5);
        expect(runs).toBe(1);
        n.set(4);
        expect(runs).toBe(2);
    });

    test('eigene Gleichheit für Signale', () => {
        const pos = signal({ x: 1 }, (p, q) => p.x === q.x);
        let runs = 0;
        effect(() => { pos.get(); runs++; });
        pos.set({ x: 1 });
        expect(runs).toBe(1);
    });

    test('Fehler werden beim Lesen geworfen, bis die Ursache behoben ist', () => {
        const d = signal(0);
        const q = computed(() => { if (d.get() === 0) throw new Error('Division durch null'); return 1 / d.get(); });
        expect(() => q.get()).toThrow('Division durch null');
        expect(() => q.get()).toThrow('Division durch null');
        d.set(4);
        expect(q.get()).toBe(0.25);
        d.set(0);
        expect(() => q.peek()).toThrow('Division durch null');
    });

    test('computed, das sich selbst liest, meldet einen Zyklus statt Stack Overflow', () => {
        const self: { c?: ReturnType<typeof computed<number>> } = {};
        self.c = computed(() => self.c!.get() + 1);
        expect(() => self.c!.get()).toThrow('Zyklus');
    });

    test('Effekte aus einem Effekt heraus bleiben bestehen, wenn der äußere neu läuft', () => {
        // Renderers: loops create effects for new iterations inside their own effect
        const count = signal(1), label = signal('a');
        const seen: string[] = [];
        let created = 0;
        effect(() => {
            for (; created < count.get(); created++) effect(() => { seen.push(label.get()); });
        });
        count.set(2);
        label.set('b');
        expect(seen).toEqual(['a', 'a', 'b', 'b']);
    });

    test('Effekte räumen vor jedem Lauf und beim Abmelden auf', () => {
        const a = signal(1);
        const log: string[] = [];
        const stop = effect(() => { const v = a.get(); log.push(`run ${v}`); return () => log.push(`clean ${v}`); });
        a.set(2);
        stop();
        expect(log).toEqual(['run 1', 'clean 1', 'run 2', 'clean 2']);
    });
});

describe('fraction1', () => {
    test('Eingaben, Auswahl, bedingter Abschnitt, Kodierung', () => {
        const instance = createItemInstance(bundles.fraction1, 'fraction1');
        const bundle = bundles.fraction1;

        // initially: everything displayed except reasoning, nothing changed
        let responses = instance.responses();
        expect(responses.variables.reduce).toEqual({ value: '', changed: false, displayed: true });
        expect(responses.variables.reasoning.displayed).toBe(false);
        expect(codeResponses(bundle, responses).variables).toEqual({
            reduce: { missing: 'omitted' },
            greater: { missing: 'omitted' }
        });

        find(instance.nodes, 'input', 'gekürzter Bruch').emit('bind', '6/8');
        const toggles = all(instance.nodes, 'toggle');
        expect(toggles.map(t => t.props.get().args.role)).toEqual(['radio', 'radio', 'radio']);
        toggles[0].emit('check');
        toggles[1].emit('check');
        expect(toggles.map(t => t.props.get().args.checked)).toEqual([false, true, false]);

        responses = instance.responses();
        expect(responses.variables.greater).toEqual({ value: [2], changed: true, displayed: true });
        expect(responses.variables.reasoning.displayed).toBe(true);

        const result = codeResponses(bundle, responses);
        expect(result.variables.reduce).toEqual({ code: 2, label: 'richtig, nicht gekürzt', score: 0 });
        expect(result.variables.greater).toEqual({ code: 1, label: 'richtig', score: 1 });
        expect(result.scores.total).toBe(1);

        find(instance.nodes, 'input', 'gekürzter Bruch').emit('bind', '3/4');
        expect(codeResponses(bundle, instance.responses()).scores.total).toBe(2);
        expect(instance.log.map(l => l.event)).toEqual(['input.bind', 'toggle.check', 'toggle.check', 'input.bind']);
    });

    test('Wiederaufnahme mit Snapshot', () => {
        const first = createItemInstance(bundles.fraction1, 'fraction1');
        find(first.nodes, 'input', 'gekürzter Bruch').emit('bind', '3/4');
        all(first.nodes, 'toggle')[1].emit('check');
        const snapshot = JSON.parse(JSON.stringify(first.snapshot()));
        expect(snapshot['/greater.selected']).toEqual([2]);

        const second = createItemInstance(bundles.fraction1, 'fraction1', { restore: snapshot });
        expect(second.responses()).toEqual(first.responses());
        expect(all(second.nodes, 'toggle')[1].props.get().args.checked).toBe(true);
    });
});

describe('Kodierung', () => {
    const source = `
        item k1 {
          a = Gap("Gartenschlauch")
          b = Gap("erstes")
          c = Gap("zweites")
          show(when: false) { d = Gap("versteckt") }
        }
        coding k1 {
          a: correct(accept(a, "(the) garden hose", typos: 1))
          bc: correct(accepted([b, c], ["säge", "zange"]) == 2)
          d: correct(d == "1")
          total: sum_score(a, bc)
        }`;

    test('Kurzform, Teilaufgabe über zwei Antworten, Missings aus dem Status', async () => {
        const { compile } = await workspace({ k1: source });
        const bundle = compile('k1').bundle;
        expect(bundle.codings[0].rules.map(r => [r.variable, r.answers])).toEqual([['a', ['a']], ['bc', ['b', 'c']], ['d', ['d']]]);
        const instance = createItemInstance(bundle, 'k1');
        const code = () => codeResponses(bundle, instance.responses());

        expect(code().variables).toEqual({ a: { missing: 'omitted' }, bc: { missing: 'omitted' }, d: { missing: 'not_reached' } });

        find(instance.nodes, 'input', 'Gartenschlauch').emit('bind', 'Garden hos.');
        find(instance.nodes, 'input', 'erstes').emit('bind', 'Zange');
        expect(code().variables.a).toEqual({ code: 1, label: 'richtig', score: 1 });
        expect(code().variables.bc).toEqual({ code: 0, label: 'falsch', score: 0 });

        find(instance.nodes, 'input', 'zweites').emit('bind', ' säge ');
        expect(code().variables.bc).toEqual({ code: 1, label: 'richtig', score: 1 });
        expect(code().scores.total).toBe(2);

        find(instance.nodes, 'input', 'Gartenschlauch').emit('bind', 'hose for the garden');
        expect(code().variables.a).toEqual({ code: 0, label: 'falsch', score: 0 });
    });
});

describe('Manuelle Kodierung', () => {
    const source = `
        item m1 {
          where = Gap("Arbeitsort")
          k = Choice("gerade oder ungerade?", ["gerade", "ungerade"])
          why = FreeText("Begründung")
          expl = FreeText("Erklärung")
        }
        coding m1 {
          where: correct(accept(where, "(a) bakery") or manual("sinngemäß: Bäckerei", yes: ["Backstube"], no: ["Büro"]))
          why: correct(k == {1} and manual("Begründung nennt die Teilbarkeit durch 2"))
          expl: codes(
            code(1, "vollständig", score: 1, when: manual("nennt beide Gründe")),
            code(2, "teilweise", when: manual("nennt einen Grund"))
          )
        }`;

    test('offen bis zum Urteil; and/or entscheiden ohne Kodierende, wo möglich', async () => {
        const { compile } = await workspace({ m1: source });
        const bundle = compile('m1').bundle;
        const instance = createItemInstance(bundle, 'm1');
        const input = (label: string, value: string) => find(instance.nodes, 'input', label).emit('bind', value);
        const code = (judgments = {}) => codeResponses(bundle, instance.responses(), judgments).variables;

        // unchanged: missing, no question for coders
        expect(code().where).toEqual({ missing: 'omitted' });

        input('Arbeitsort', 'A bakery');
        expect(code().where).toEqual({ code: 1, label: 'richtig', score: 1 });

        input('Arbeitsort', 'in der Backstube');
        const q = { id: 'where: sinngemäß: Bäckerei', criterion: 'sinngemäß: Bäckerei', yes: ['Backstube'], no: ['Büro'] };
        expect(code().where).toEqual({ pending: [q] });
        expect(code({ [q.id]: true }).where).toEqual({ code: 1, label: 'richtig', score: 1 });
        expect(code({ [q.id]: false }).where).toEqual({ code: 0, label: 'falsch', score: 0 });

        // wrong tick: decided without coders; right tick: open
        input('Begründung', 'weil sie durch 2 teilbar ist');
        const toggles = all(instance.nodes, 'toggle');
        toggles[1].emit('check');
        expect(code().why).toEqual({ code: 0, label: 'falsch', score: 0 });
        toggles[0].emit('check');
        expect(code().why.pending?.map(p => p.criterion)).toEqual(['Begründung nennt die Teilbarkeit durch 2']);

        // several manual codes: all open questions at once, the first match applies
        input('Erklärung', 'weil …');
        expect(code().expl.pending?.map(p => p.id)).toEqual(['expl: nennt beide Gründe', 'expl: nennt einen Grund']);
        expect(code({ 'expl: nennt beide Gründe': false }).expl.pending?.map(p => p.id)).toEqual(['expl: nennt einen Grund']);
        expect(code({ 'expl: nennt beide Gründe': false, 'expl: nennt einen Grund': true }).expl).toEqual({ code: 2, label: 'teilweise', score: 0 });
        expect(code({ 'expl: nennt einen Grund': true }).expl.pending?.map(p => p.id)).toEqual(['expl: nennt beide Gründe']);
    });
});

describe('fraction2', () => {
    test('Einfärben aus toggle: Anzahl und diagnostischer Code', () => {
        const instance = createItemInstance(bundles.fraction2, 'fraction2');
        const toggles = all(instance.nodes, 'toggle');
        expect(toggles).toHaveLength(8);
        expect(toggles[2].props.get().args.label).toBe('Teil 3 von 8');
        toggles.slice(0, 3).forEach(t => t.emit('check'));
        expect(codeResponses(bundles.fraction2, instance.responses()).variables.shading).toMatchObject({ code: 2 });
        toggles.slice(3, 6).forEach(t => t.emit('check'));
        toggles[0].emit('uncheck');
        toggles[6].emit('check');
        expect(instance.responses().variables.shading.value).toBe(6);
        expect(codeResponses(bundles.fraction2, instance.responses()).variables.shading).toEqual({ code: 1, label: 'richtig', score: 1 });
    });
});

describe('fraction3', () => {
    test('Zahlenstrahl: exakter Wert, Bereich, none', () => {
        const instance = createItemInstance(bundles.fraction3, 'fraction3');
        const value = find(instance.nodes, 'value');
        expect(value.props.get().bind).toBe(null);
        expect(String(value.props.get().args.step)).toBe('1/20');
        expect(codeResponses(bundles.fraction3, instance.responses()).variables.mark).toEqual({ missing: 'omitted' });
        value.emit('bind', Rational.parse('13/20')!);
        expect(codeResponses(bundles.fraction3, instance.responses()).variables.mark).toMatchObject({ code: 2 });
        value.emit('bind', Rational.parse('12/20')!);
        expect(instance.responses().variables.mark.value).toBe('3/5');
        expect(codeResponses(bundles.fraction3, instance.responses()).variables.mark).toMatchObject({ code: 1, score: 1 });
        expect(all(instance.nodes, 'dot').map(t => display(t.props.get().args.label ?? null))).toEqual(['0', '1/2', '1']);
    });
});

describe('Anpassungen', () => {
    test('Profil ∩ Aufgabe: ausgeschlossene Anpassungen wirken nicht, Varianten werden gewählt', () => {
        const requested = requestedAccommodations({
            display: { scale: 2, contrast: 'high' },
            content: { simple_language: true, extended_descriptions: true, read_aloud: 'on_demand' }
        });
        const instance = createItemInstance(bundles.reading3, 'reading3', { accommodations: requested });
        // read_aloud and simple_language would distort reading: the item denies them
        expect([...instance.accommodations].sort()).toEqual(['contrast', 'extended_descriptions', 'magnification']);
        expect(instance.responses().accommodations).toEqual(['contrast', 'extended_descriptions', 'magnification']);
        expect(bundles.reading3.items[0].accommodations?.reason).toBe('misst Leseverstehen');
    });

    test('Einfache Sprache ersetzt Inhalt, erweiterte Beschreibung wird mitgegeben', async () => {
        const { compile } = await workspace({ levels: `item levels {
            p { "Lies den Text und beantworte die Frage." variant(simple_language) "Lies den Text. Dann beantworte die Frage." }
            p { image(src: "https://example.org/d.svg", alt: "Dreieck") variant(extended_descriptions) "Das Dreieck steht auf der Seite a." }
          }` });
        const instance = createItemInstance(compile('levels').bundle, 'levels', { accommodations: ['simple_language', 'extended_descriptions'] });
        const p = find(instance.nodes, 'p');
        expect(p.children[0].kind === 'content' && p.children[0].value.get()).toBe('Lies den Text. Dann beantworte die Frage.');
        // image as content; the description belongs to the enclosing paragraph
        expect(all(instance.nodes, 'p')[1].props.get().variants).toEqual({ extended_descriptions: 'Das Dreieck steht auf der Seite a.' });
    });
});

describe('Sprachstufe neben einer Antwort', () => {
    test('ersetzt den Text davor, die Lücke bleibt mit ihrer Antwort', async () => {
        const { compile } = await workspace({ level_gap: `item level_gap {
            p {
              "Wie viele Äpfel liegen noch im Korb? " rest = Gap("übrige Äpfel") " Stück"
              variant(easy_language) "Wie viele Äpfel sind noch da? "
            }
          }` });
        const bundle = compile('level_gap').bundle;
        const easy = createItemInstance(bundle, 'level_gap', { accommodations: ['easy_language'] });
        const p = find(easy.nodes, 'p');
        expect(p.children.map(c => c.kind)).toEqual(['content', 'component', 'content']);
        expect(p.children[0].kind === 'content' && p.children[0].value.get()).toBe('Wie viele Äpfel sind noch da? ');
        find(easy.nodes, 'input').emit('bind', '6');
        expect(easy.responses().variables.rest.value).toBe('6');
        const plain = createItemInstance(bundle, 'level_gap');
        expect(find(plain.nodes, 'p').children[0].kind === 'content' && (find(plain.nodes, 'p').children[0] as { value: { get(): unknown } }).value.get())
            .toBe('Wie viele Äpfel liegen noch im Korb? ');
    });
});

describe('Optionen per Text', () => {
    test('der Compiler setzt die Optionsnummern ein; Kodierung wie mit Nummern', async () => {
        const { compile } = await workspace({ option_text: `
            item option_text { g = Choice("Welcher Bruch?", ["2/5", "3/5", "1/4"]) }
            coding option_text { g: correct(g == {"3/5"}) }` });
        const bundle = compile('option_text').bundle;
        expect(JSON.stringify(bundle.codings[0])).not.toContain('3/5');
        const instance = createItemInstance(bundle, 'option_text');
        all(instance.nodes, 'toggle')[1].emit('check');
        expect(codeResponses(bundle, instance.responses()).variables.g.code).toBe(1);
        all(instance.nodes, 'toggle')[0].emit('check');
        expect(codeResponses(bundle, instance.responses()).variables.g.code).toBe(0);
    });
});

describe('Platzhalter in Texten', () => {
    test('Namen, Glieder und Funktionsparameter; doppelte Klammern und LaTeX bleiben Text', async () => {
        const { compile } = await workspace({ placeholders: `
            fn wert(n: Int): Text = "Wert {n}"
            component Teile(parts: Int) {
              for i in 1 .. parts { toggle(label: "Teil {i} von {parts}") }
            }
            item placeholders(k: Int = 3) {
              versions(when: k in 1 .. 5)
              let p = (2 | 5)
              p "Es sind {k} Kuchen, Punkt bei {p.y}; {wert(k)}"
              p { wert(k) }
              p "Mengen schreibt man {{1, 2}}, die Punkte {3, 9} bleiben Text."
              p { math("\\frac{3}{4}") }
              Teile(parts: 2)
            }` });
        const instance = createItemInstance(compile('placeholders').bundle, 'placeholders');
        const texts = all(instance.nodes, 'p').map(p => p.children.map(c => c.kind === 'content' ? display(c.value.get()) : '').join(''));
        expect(texts[0]).toBe('Es sind 3 Kuchen, Punkt bei 5; {wert(k)}');
        expect(texts[1]).toBe('Wert 3');
        expect(texts[2]).toBe('Mengen schreibt man {1, 2}, die Punkte {3, 9} bleiben Text.');
        expect(all(instance.nodes, 'toggle').map(t => display(t.props.get().args.label))).toEqual(['Teil 1 von 2', 'Teil 2 von 2']);
    });
});

describe('Ereignisse', () => {
    test('bind löst on change aus', async () => {
        const { compile } = await workspace({ change: `
            component Counted(label: Content): response Int {
              state text: Text = ""
              state edits: Int = 0
              input(bind: text, label: label, on change: edits := edits + 1)
              response edits
            }
            item change1 { page { n = Counted(label: "x") } }` });
        const bundle = compile('change').bundle;
        const instance = createItemInstance(bundle, 'change1');
        const input = find(instance.nodes, 'input');
        input.emit('bind', 'a');
        input.emit('bind', 'ab');
        expect(instance.responses().variables.n.value).toBe(2);
    });
});

describe('bind an Listenelemente', () => {
    test('jedes Feld schreibt sein Element; Index außerhalb ändert nichts', async () => {
        const { compile } = await workspace({ lb1: `
            component Faces(): response List<Text> {
              state faces: List<Text> = repeat("", 3)
              for f, i in faces { input(bind: faces[i], label: "Fläche " + i) }
              input(bind: faces[4], label: "außerhalb")
              response faces
            }
            item lb1 { net = Faces() }` });
        const instance = createItemInstance(compile('lb1').bundle, 'lb1');
        find(instance.nodes, 'input', 'Fläche 2').emit('bind', '3');
        find(instance.nodes, 'input', 'Fläche 3').emit('bind', '1');
        find(instance.nodes, 'input', 'außerhalb').emit('bind', '9');
        expect(instance.responses().variables.net.value).toEqual(['', '3', '1']);
        expect(find(instance.nodes, 'input', 'Fläche 2').props.get().bind).toBe('3');
        expect(find(instance.nodes, 'input', 'außerhalb').props.get().bind).toBe(null);
    });
});

describe('Komponenten mit Inhalt', () => {
    test('Inhalt im Bereich des Aufrufers; Antworten darin gehören zur Aufgabe; Sichtbarkeit folgt der Komponente', async () => {
        const { compile } = await workspace({ ch1: `
            component Panel(title: Text, open: Bool = true) children {
              section(heading: title) {
                show(when: open) { children }
              }
            }
            item ch1 {
              let who = "Henrike"
              Panel(title: "Eins") { p { "von " who } }
              Panel(title: "Kurz") "nur Text"
              Panel(title: "Zu", open: false) { hidden = Gap("versteckt") }
              Panel(title: "Antwort") { a = Gap("Antwort") }
            }
            coding ch1 { a: correct(a == "x") }` });
        const instance = createItemInstance(compile('ch1').bundle, 'ch1');
        const texts = (n: ReturnType<typeof find>) => n.children.flatMap(c => c.kind === 'content' ? [c.value.get()] : []);
        const sections = all(instance.nodes, 'section');
        expect(sections.map(s => s.props.get().args.heading)).toEqual(['Eins', 'Kurz', 'Zu', 'Antwort']);
        expect(find(instance.nodes, 'p').children.map(c => c.kind === 'content' ? c.value.get() : null)).toEqual(['von ', 'Henrike']);
        expect(texts(sections[1]).length).toBe(0); // the content is inside the show
        find(instance.nodes, 'input', 'Antwort').emit('bind', 'x');
        const responses = instance.responses();
        expect(responses.variables.a).toMatchObject({ value: 'x', changed: true, displayed: true });
        expect(responses.variables.hidden.displayed).toBe(false);
        expect(codeResponses(compile('ch1').bundle, responses).variables.a.code).toBe(1);
    });
});

describe('Zustandsparameter', () => {
    test('gebunden an ein Listenelement des Aufrufers, ungebunden mit eigenem Zustand; once über taken', async () => {
        const { compile } = await workspace({ sp1: `
            item sp1 {
              jobs = Match(rows: ["Anna", "Ben"], options: ["Koch", "Pilot", "Ärztin"], once: true)
              one = Select("Allein", ["a", "b"])
              for x, i in ["p", "q"] { p { i ": " x } }
            }` });
        const instance = createItemInstance(compile('sp1').bundle, 'sp1');
        const groups = all(instance.nodes, 'group');
        const toggles = (g: number) => groups[g].children.flatMap(c => c.kind === 'for' ? c.iterations.get().flat() : [c])
            .filter((n): n is ReturnType<typeof find> => n.kind === 'element');
        toggles(0)[1].emit('check');                                    // Anna: pilot
        expect(instance.responses().variables.jobs.value).toEqual([2, null]);
        expect(toggles(1).map(t => t.props.get().args.disabled)).toEqual([false, true, false]); // pilot taken
        toggles(1)[2].emit('check');                                    // Ben: doctor
        expect(instance.responses().variables.jobs.value).toEqual([2, 3]);
        toggles(2)[0].emit('check');
        expect(instance.responses().variables.one.value).toBe(1);
        // loop index is 1-based
        expect(all(instance.nodes, 'p').map(p => p.children.map(c => c.kind === 'content' ? display(c.value.get()) : '').join(''))).toEqual(['1: p', '2: q']);
        // own state of an unbound call is saved and restored
        const restored = createItemInstance(compile('sp1').bundle, 'sp1', { restore: instance.snapshot() });
        expect(restored.responses().variables.one.value).toBe(1);
        expect(restored.responses().variables.jobs.value).toEqual([2, 3]);
    });
});

describe('Eigene Funktionen', () => {
    test('fn in der Aufgabe und Geometrie aus std (is_right_angle, on_line, slope) in einer Kodierung', async () => {
        const { compile } = await workspace({ fn1: `
            /** Steigung 2 mit Toleranz, als eigene Funktion benannt */
            fn steigung_zwei(s: Rational?): Bool = s >= 1.9 and s <= 2.1
            component Pts(): response List<Point?> {
              state c: Point? = none
              plane(x: 0 .. 8, y: 0 .. 8) {
                value(bind: c, min: point(0, 0), max: point(8, 8), step: 1/2, label: "C")
              }
              response [c]
            }
            item fn1 { pt = Pts() }
            coding fn1 {
              right: correct(is_right_angle(point(1, 1), point(4, 1), pt[1]))
              line: correct(on_line(pt[1], point(0, 0), point(4, 4), tolerance: 0.1))
              steep: correct(steigung_zwei(slope(point(0, 0), pt[1])))
            }` });
        const bundle = compile('fn1').bundle;
        // the bundle contains only built-ins: user functions are inlined
        expect(JSON.stringify(bundle.codings)).not.toMatch(/is_right_angle|steigung_zwei|on_line|slope/);
        const code = (x: number, y: number) => {
            const instance = createItemInstance(bundle, 'fn1');
            all(instance.nodes, 'value')[0].emit('bind', new Point(Rational.of(x), Rational.of(y)));
            const v = codeResponses(bundle, instance.responses()).variables;
            return [v.right.code, v.line.code, v.steep.code];
        };
        expect(code(4, 4)).toEqual([1, 1, 0]);   // right angle at B, on the bisector, slope 1
        expect(code(2, 4)).toEqual([0, 0, 1]);   // slope 2
        expect(code(0, 6)).toEqual([0, 0, 0]);   // vertical: slope is none
    });
});

describe('Bausteine aus std', () => {
    test('Brackets: ein Klammerpaar im Term, Kodierung über eine Menge von Mengen', async () => {
        const { compile } = await workspace({ br1: `
            item br1 { b = Brackets(label: "Term", numbers: ["9", "3", "2", "1"], operators: ["−", "·", "+"], rest: "= 13") }
            coding br1 { b: correct(b in {{1, 4}, {1, 4, 7, 8}}) }` });
        const bundle = compile('br1').bundle;
        const code = (slots: number[]) => {
            const instance = createItemInstance(bundle, 'br1');
            const toggles = all(instance.nodes, 'toggle');
            expect(toggles).toHaveLength(8);
            slots.forEach(s => toggles[s - 1].emit('check'));
            return codeResponses(bundle, instance.responses()).variables.b.code;
        };
        expect(code([1, 4])).toBe(1);        // (9 − 3) · 2 + 1
        expect(code([1, 4, 7, 8])).toBe(1);  // (9 − 3) · 2 + (1)
        expect(code([3, 8])).toBe(0);        // 9 − (3 · 2 + 1)
    });

    test('Ruler und SetSquare: Griff am Nullpunkt verschiebt, Drehgriff dreht', async () => {
        const { compile } = await workspace({ tools: `
            item tools {
              plane(x: 0 .. 20, y: 0 .. 12) {
                Ruler(at: point(1, 2), min: point(0, 0), max: point(20, 12))
                SetSquare(at: point(10, 1), min: point(0, 0), max: point(20, 12), size: 8)
              }
            }` });
        const instance = createItemInstance(compile('tools').bundle, 'tools');
        const [start, end, center, handle] = all(instance.nodes, 'value');
        const at = (v: typeof start) => display(v.props.get().bind ?? null);
        expect(at(end)).toBe('(11 | 2)');
        start.emit('bind', new Point(Rational.of(3), Rational.of(4)));
        expect(at(end)).toBe('(13 | 4)');                    // bind triggers on change: moved, direction kept
        end.emit('bind', new Point(Rational.of(3), Rational.of(9)));
        expect(at(end)).toBe('(3 | 14)');                    // rotated to 90°, length stays 10
        expect(at(handle)).toBe('(18 | 1)');
        handle.emit('bind', new Point(Rational.of(10), Rational.of(5)));
        expect(at(handle)).toBe('(10 | 9)');                 // rotation handle stays at distance 8 from the center
        expect(at(center)).toBe('(10 | 1)');
    });
});

describe('Ablauf aus importierten Units', () => {
    test('current_page(), Button und Tabs steuern, was zu sehen ist', async () => {
        const { compile } = await workspace({ flow: `
            item flow1 "Ablauf" {
              stimulus(label: "Text") {
                p { "Siehe " if current_page() == 2 then mark("hier") else "hier" "." }
                view = Tabs(label: "Ansicht", options: ["Text 1", "Text 2"])
                show(when: view == 2) { p "Zweiter Text" }
              }
              go = Button("los geht es", once: true)
              page { show(when: go) { a = Gap("Erste") } }
              page { show(when: go) { b = Gap("Zweite") } }
            }` });
        const instance = createItemInstance(compile('flow').bundle, 'flow1');
        const shown = () => instance.responses().variables;
        expect(shown().a.displayed).toBe(false);
        // order: two tabs, then the button
        const [, second, go] = all(instance.nodes, 'toggle');
        expect(go.props.get().args.role).toBe('button');
        go.emit('check');
        expect(shown().a.displayed).toBe(true);
        expect(shown().go.value).toBe(true);
        // pressed once: stays pressed
        go.emit('uncheck');
        expect(shown().go.value).toBe(true);
        expect(shown().view.value).toBe(1);
        instance.page.set(1);
        second.emit('check');
        expect(shown().view.value).toBe(2);
    });
});

describe('Geoboard auf dem Raster', () => {
    test('Geoboard: zwei Punkte ergeben eine Strecke, nochmal nimmt sie weg; shape vergleicht ohne Lage und Stücke', async () => {
        const { compile } = await workspace({ geo: `
            item geo1 "Dreieck" {
              plane(x: 0 .. 4, y: 0 .. 3) { drawn = Geoboard(cols: 4, rows: 3, label: "Raster") }
            }
            coding geo1 {
              drawn: correct(shape(drawn) == shape({[point(0, 0), point(2, 0)], [point(2, 0), point(0, 2)], [point(0, 2), point(0, 0)]}))
            }` });
        const bundle = compile('geo').bundle;
        const instance = createItemInstance(bundle, 'geo1');
        const dots = all(instance.nodes, 'toggle');
        expect(dots).toHaveLength(20);
        const at = (i: number, j: number) => dots[j * 5 + i];
        const line = (a: [number, number], b: [number, number]) => { at(...a).emit('check'); at(...b).emit('check'); };
        // triangle elsewhere, one side in two pieces
        line([1, 1], [2, 1]); line([2, 1], [3, 1]); line([3, 1], [1, 3]); line([1, 3], [1, 1]);
        expect(codeResponses(bundle, instance.responses()).variables.drawn.code).toBe(1);
        // the same segment again removes it
        line([1, 3], [1, 1]);
        expect(codeResponses(bundle, instance.responses()).variables.drawn.code).toBe(0);
        // tapping the start point again cancels
        at(0, 0).emit('check'); at(0, 0).emit('uncheck');
        expect((instance.responses().variables.drawn.value as unknown[]).length).toBe(3);
    });
});

describe('Fassungen mit Parametern', () => {
    const SOURCE = `item eggs(per_box: Int = 6, boxes: Int = 4) "Eier" {
      versions(when: per_box in 4 .. 10 and boxes in 2 .. 6 and per_box * boxes <= 50
                     and (not (easy_language in accommodations()) or per_box * boxes <= 20))
      p { "In einen Karton passen " per_box " Eier, " boxes " Kartons." }
      show(when: easy_language in accommodations()) { p "Rechne mal." }
      total = Gap("Wie viele Eier?")
    }
    coding eggs { total: correct(number(total) == per_box * boxes, right: "Richtig: " + per_box * boxes + " Eier.") }`;
    let bundle: Bundle;
    beforeAll(async () => {
        const { compile } = await workspace({ eggs: SOURCE });
        bundle = compile('eggs').bundle;
    });

    test('Parameter wirken in Aufgabe, Kodierung und Schnappschuss', () => {
        const instance = createItemInstance(bundle, 'eggs', { params: { per_box: 5, boxes: 3 } });
        const texts = find(instance.nodes, 'p').children.map(c => c.kind === 'content' ? display(c.value.get()) : '');
        expect(texts).toEqual(['In einen Karton passen ', '5', ' Eier, ', '3', ' Kartons.']);
        const input = find(instance.nodes, 'input');
        input.emit('bind', '15');
        const responses = instance.responses();
        expect(responses.params).toEqual({ per_box: 5, boxes: 3 });
        expect(codeResponses(bundle, responses).variables.total).toMatchObject({ code: 1 });
        // resume: same version
        const again = createItemInstance(bundle, 'eggs', { restore: instance.snapshot() });
        expect(again.params).toEqual({ per_box: 5, boxes: 3 });
    });

    test('Fassungen je Profil; ohne Wahl die Standardwerte oder die erste passende', () => {
        const item = bundle.items[0];
        const all = versionsFor(item);
        expect(all).toContainEqual({ per_box: 10, boxes: 5 });
        expect(all).not.toContainEqual({ per_box: 10, boxes: 6 });
        const easy = versionsFor(item, ['easy_language']);
        expect(easy.every(v => (v.per_box as number) * (v.boxes as number) <= 20)).toBe(true);
        expect(createItemInstance(bundle, 'eggs').params).toEqual({ per_box: 6, boxes: 4 });
        const plain = createItemInstance(bundle, 'eggs', { accommodations: ['easy_language'] });
        expect(plain.params).toEqual(easy[0]);
        // accommodations() in the item: the effective accommodations
        const shown = (i: typeof plain) => i.nodes.filter(n => n.kind === 'show').map(n => (n as { visible: { get(): boolean } }).visible.get());
        expect(shown(plain)).toEqual([true]);
        expect(shown(createItemInstance(bundle, 'eggs'))).toEqual([false]);
        expect(randomVersion(item, [], { per_box: 6, boxes: 4 }, () => 0)).not.toEqual({ per_box: 6, boxes: 4 });
    });
});
