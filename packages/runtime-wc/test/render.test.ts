import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { codeResponses, createItemInstance, type ItemInstance } from '@answerfield/runtime-core';
import { AfMedia, renderItem, themeCss, type MediaPlayer, type Speech } from '../src/index.js';
import { normalize, texSpeech } from '../src/speak.js';
import { workspace } from './workspace.js';
import { find } from './tree.js';

let bundles: Record<string, Bundle>;

beforeAll(async () => {
    const { compile } = await workspace();
    bundles = Object.fromEntries(['fraction1', 'fraction2', 'fraction3'].map(n => [n, compile(`${n}.af`, { dev: true }).bundle]));
});

beforeEach(() => {
    document.body.innerHTML = '';
});

function render(name: string, accommodations: string[] = []): { instance: ItemInstance; root: HTMLElement } {
    const instance = createItemInstance(bundles[name], name, { accommodations });
    const { root } = renderItem(instance, document.body, { dev: true, profile: { display: { scale: 2 } } });
    return { instance, root };
}

function key(el: Element, key: string): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

async function tick(): Promise<void> {
    await new Promise(r => setTimeout(r, 0));
}

describe('fraction1', () => {
    test('Text, Lücke und Auswahl werden zugänglich gerendert', () => {
        const { root } = render('fraction1');
        const p = root.querySelector('af-p')!;
        expect(p.getAttribute('role')).toBe('paragraph');
        expect(p.textContent).toContain('Kürze den Bruch 6/8:');
        const gap = p.querySelector('af-input input')!;
        expect(gap.getAttribute('aria-label')).toBe('gekürzter Bruch');
        expect((gap as HTMLInputElement).style.width).toBe('4em');

        const group = root.querySelector('af-group')!;
        expect(group.getAttribute('role')).toBe('radiogroup');
        const legend = root.querySelector(`#${group.getAttribute('aria-labelledby')}`)!;
        expect(legend.textContent).toBe('Welcher Bruch ist größer als 1/2?');
        const radios = [...group.querySelectorAll('af-toggle')];
        expect(radios.map(r => [r.getAttribute('role'), r.getAttribute('aria-checked'), r.textContent])).toEqual([
            ['radio', 'false', '2/5'], ['radio', 'false', '3/5'], ['radio', 'false', '1/4']
        ]);
        // conditional section hidden
        expect(root.querySelector('af-show')!.hasAttribute('hidden')).toBe(true);
        // source reference
        expect(p.getAttribute('data-src')).toMatch(/^0:\d+:\d+$/);
    });

    test('Bedienung mit Maus und Tastatur, Antworten und Kodierung', async () => {
        const { instance, root } = render('fraction1');
        const input = root.querySelector('af-input input') as HTMLInputElement;
        input.value = '3/4';
        input.dispatchEvent(new Event('input'));

        const radios = [...root.querySelectorAll('af-toggle')] as HTMLElement[];
        await tick();
        expect(radios.map(r => r.tabIndex)).toEqual([0, -1, -1]); // roving tabindex
        radios[0].focus();
        key(radios[0], 'ArrowDown');            // arrow key selects the next option
        expect(radios[1].getAttribute('aria-checked')).toBe('true');
        expect(document.activeElement).toBe(radios[1]);
        await tick();
        expect(radios.map(r => r.tabIndex)).toEqual([-1, 0, -1]);

        expect(root.querySelector('af-show')!.hasAttribute('hidden')).toBe(false);
        const textarea = root.querySelector('af-show textarea') as HTMLTextAreaElement;
        expect(root.querySelector(`label[for="${textarea.id}"]`)!.textContent).toBe('Woher weißt du das?');
        expect(textarea.maxLength).toBe(500);

        const result = codeResponses(bundles.fraction1, instance.responses());
        expect(result.scores.total).toBe(2);
    });
});

describe('fraction2', () => {
    test('Sektoren als Form der Schalter: Bogen als Pfad, Klick auf den Sektor oder Leertaste färbt', () => {
        const { instance, root } = render('fraction2');
        const toggles = [...root.querySelectorAll('af-toggle')] as HTMLElement[];
        expect(toggles).toHaveLength(8);
        expect(toggles[0].hasAttribute('data-shape')).toBe(true);
        expect(toggles[0].getAttribute('aria-label')).toBe('Teil 1 von 8');
        // Each toggle's shape follows it: center, line to the arc's start, arc, closed
        const shapes = [...root.querySelectorAll('.af-toggle-shape')];
        expect(shapes).toHaveLength(8);
        expect(toggles[0].nextElementSibling).toBe(shapes[0]);
        const d = shapes[0].querySelector('path')!.getAttribute('d')!;
        expect(d).toMatch(/^M0,1\.2 L0,0\.2 A1,1 0 0 1 [\d.]+,[\d.]+ Z$/);

        shapes[0].querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        toggles.slice(1, 6).forEach(t => key(t, ' '));
        expect(toggles.map(t => t.getAttribute('aria-checked')).filter(c => c === 'true')).toHaveLength(6);
        key(toggles[5], ' ');
        expect(instance.responses().variables.shading.value).toBe(5);
    });
});

describe('fraction3', () => {
    test('Zahlenstrahl: Ticks, Tastatur in Schritten von 1/20, ARIA-Werte', () => {
        const { instance, root } = render('fraction3');
        const ticks = [...root.querySelectorAll('af-dot .af-shape-label')] as HTMLElement[];
        expect(ticks.map(t => [t.textContent, t.style.left])).toEqual([['0', '0%'], ['1/2', '50%'], ['1', '100%']]);
        const slider = root.querySelector('af-value') as HTMLElement;
        expect(slider.getAttribute('role')).toBe('slider');
        expect(slider.getAttribute('aria-label')).toBe('Zahlenstrahl von 0 bis 1');
        expect(slider.getAttribute('aria-valuetext')).toBe('kein Wert');

        key(slider, 'Home');
        for (let i = 0; i < 12; i++) key(slider, 'ArrowRight');
        expect(slider.getAttribute('aria-valuetext')).toBe('3/5');
        expect(slider.getAttribute('aria-valuenow')).toBe('0.6');
        expect((slider.querySelector('.af-thumb') as HTMLElement).style.left).toBe('60%');
        expect(slider.hasAttribute('data-in-plane')).toBe(true); // a marker is the default on a number line
        key(slider, 'End');
        key(slider, 'ArrowRight');
        expect(slider.getAttribute('aria-valuetext')).toBe('1');
        expect(instance.responses().variables.mark.value).toBe(1);
    });

    test('Profil: Vergrößerung und Kontrast an der Wurzel', () => {
        const { root } = render('fraction3', ['magnification', 'contrast']);
        expect(root.getAttribute('data-scale')).toBe('2');
        expect(root.getAttribute('data-contrast')).toBe('high');
        expect(root.style.getPropertyValue('--af-scale')).toBe('2');
    });
});

describe('Tabellen und Fließtext', () => {
    const source = `item ft1 "Fließtext" {
  table(caption: "Steckbrief") {
    row(head: true) { cell "Frage" cell "Antwort" }
    row { cell "Wie heißt er?" cell { p(tone: hint) "Tom" } }
    row { cell "Wo wohnt er?" cell { where = Gap("Wo wohnt er?") } }
  }
  p { "Das Wort " mark("sie") " meint " title("Die Katze") ", m" sup("2") "." }
  lines(every: 5) {
    "Erste Zeile" "zweite" "dritte" "vierte" "fünfte" "sechste"
  }
  p { "Erd" g1 = Gap("Lücke 1", width: 3ch) "beeren" }
  circled = MarkWords("Ich kam spät nach Hause", label: "Kreise die Verben ein")
  struck = MarkWords("Hund Katze Auto Maus", label: "Streiche das unpassende Wort", look: strike)
  commas = Commas("Nachdem es regnete glänzte die Straße", label: "Setze die Kommas")
}
coding ft1 {
  where: correct(accept(where, "(in) Berlin"))
  g1: correct(g1 == "ische")
  circled: correct(circled == {2})
  struck: correct(struck == {3})
  commas: correct(commas == {3})
}
`;

    test('Tabelle, Auszeichnung, feste Zeilen, Lücke im Wort, Markieren und Kommas', async () => {
        const { compile } = await workspace({ ft1: source });
        const bundle = compile('ft1', { dev: true }).bundle;
        const instance = createItemInstance(bundle, 'ft1');
        const { root } = renderItem(instance, document.body, { dev: true });
        await tick();

        // table with roles and caption
        const table = root.querySelector('af-table')!;
        expect(table.getAttribute('role')).toBe('table');
        expect(document.getElementById(table.getAttribute('aria-labelledby')!)!.textContent).toBe('Steckbrief');
        expect(root.querySelector('af-row[data-head]')!.getAttribute('role')).toBe('row');
        expect([...root.querySelectorAll('af-row[data-head] af-cell')].map(c => c.getAttribute('role'))).toEqual(['columnheader', 'columnheader']);
        const rows = root.querySelectorAll('af-table > af-row:not([data-head])');
        expect([...rows].map(r => r.getAttribute('role'))).toEqual(['row', 'row']);
        expect(rows[1].querySelector('af-cell')!.getAttribute('role')).toBe('cell');
        expect(rows[1].querySelector('af-input input')!.getAttribute('aria-label')).toBe('Wo wohnt er?');

        // markup in running text
        const paragraphs = [...root.children].filter(e => e.localName === 'af-p');
        const p = paragraphs[0];
        expect(p.querySelector('mark')!.textContent).toBe('sie');
        expect(p.querySelector('cite')!.textContent).toBe('Die Katze');
        expect(p.querySelector('sup')!.textContent).toBe('2');
        expect(p.textContent).toBe('Das Wort sie meint Die Katze, m2.');

        // fixed lines: every fifth shows its number
        const lines = [...root.querySelector('af-lines')!.children];
        expect(lines.map(l => l.textContent)).toEqual(['Erste Zeile', 'zweite', 'dritte', 'vierte', 'fünfte', 'sechste']);
        expect(lines.map(l => l.getAttribute('data-line'))).toEqual(['1', null, null, null, '5', null]);

        // gap in the middle of a word
        const word = paragraphs[1];
        expect(word.textContent).toBe('Erdbeeren');
        const gap = word.querySelector('af-input input') as HTMLInputElement;
        gap.value = 'ische';
        gap.dispatchEvent(new Event('input'));

        // highlighting: words as toggles in running text
        const [circled, struck] = root.querySelectorAll('af-component[data-component="MarkWords"]');
        const words = circled.querySelectorAll('af-toggle');
        expect([...words].map(w => w.textContent)).toEqual(['Ich', 'kam', 'spät', 'nach', 'Hause']);
        expect(words[0].getAttribute('data-look')).toBe('encircle');
        (words[1] as HTMLElement).click();
        expect(words[1].getAttribute('aria-checked')).toBe('true');
        (struck.querySelectorAll('af-toggle')[2] as HTMLElement).click();
        expect(struck.querySelectorAll('af-toggle')[2].getAttribute('data-look')).toBe('strike');

        // commas: slots between the words
        const slots = [...root.querySelectorAll('af-component[data-component="Commas"] af-toggle')].filter(t => !t.closest('[hidden]'));
        expect(slots).toHaveLength(5);
        expect(slots[2].getAttribute('aria-label')).toBe('Komma vor „glänzte“');
        (slots[2] as HTMLElement).click();

        const coding = codeResponses(bundle, instance.responses()).variables;
        expect(Object.fromEntries(Object.entries(coding).map(([k, v]) => [k, v.code ?? v.missing]))).toEqual({
            where: 'omitted', g1: 1, circled: 1, struck: 1, commas: 1
        });
    });
});

describe('Zuordnen und Matrix', () => {
    const source = `
        item match1 {
          jobs = Match(label: "Wer macht was?", rows: ["Anna", "Ben", "Cem"],
                       options: ["Koch", "Pilot", "Lehrerin", "Arzt"], once: true)
          yn = Matrix(rows: ["Die Tür ist offen.", "Das Licht brennt."], columns: ["ja", "nein"])
        }
        coding match1 {
          job1: correct(jobs[1] == 4)
          job2: correct(jobs[2] == 2)
          pair1: correct(yn[1] == 1 and yn[2] == 2)
        }`;

    test('Auswahlliste je Zeile mit Sperre, Radiogruppe je Matrixzeile, Kodierung je Zeile', async () => {
        const { compile } = await workspace({ match1: source });
        const bundle = compile('match1', { dev: true }).bundle;
        const instance = createItemInstance(bundle, 'match1');
        const { root } = renderItem(instance, document.body, { dev: true });
        await tick();

        const selects = [...root.querySelectorAll('af-component[data-component="Match"] select')] as HTMLSelectElement[];
        expect(selects).toHaveLength(3);
        expect(selects[0].getAttribute('aria-label')).toBe('Anna');
        expect([...selects[0].options].map(o => o.textContent)).toEqual(['–', 'Koch', 'Pilot', 'Lehrerin', 'Arzt']);
        const choose = (select: HTMLSelectElement, index: number) => {
            select.selectedIndex = index;
            select.dispatchEvent(new Event('change'));
        };
        choose(selects[0], 4);
        choose(selects[1], 2);
        await tick();
        // once: Arzt and Pilot are disabled in the other rows but not in their own
        expect([...selects[2].options].map(o => o.disabled)).toEqual([false, false, true, false, true]);
        expect(selects[0].options[4].disabled).toBe(false);
        expect(selects[0].selectedIndex).toBe(4);

        // matrix: header row, one radio group per row named by the row text
        const matrix = root.querySelector('af-component[data-component="Matrix"]')!;
        expect([...matrix.querySelectorAll('af-row[data-head] af-cell')].map(c => c.textContent)).toEqual(['', 'ja', 'nein']);
        const groups = matrix.querySelectorAll('af-group[role="radiogroup"]');
        expect(groups).toHaveLength(2);
        const radios = [...matrix.querySelectorAll('af-toggle')] as HTMLElement[];
        expect(radios.map(r => r.getAttribute('aria-label'))).toEqual(['ja', 'nein', 'ja', 'nein']);
        radios[0].click();
        radios[3].click();

        expect(instance.responses().variables.jobs.value).toEqual([4, 2, null]);
        const coding = codeResponses(bundle, instance.responses()).variables;
        expect([coding.job1.code, coding.job2.code, coding.pair1.code]).toEqual([1, 1, 1]);

        // the empty choice clears the assignment
        choose(selects[1], 0);
        expect(instance.responses().variables.jobs.value).toEqual([4, null, null]);
        expect(codeResponses(bundle, instance.responses()).variables.job2).toMatchObject({ code: 0 });
    });
});

describe('Medien', () => {
    test('Host löst Medienpfade auf (z. B. CDN nach Hash); ohne Auflöser gilt baseUrl', async () => {
        const { compile } = await workspace({ med1: 'item med1 { image(src: "images/circle.svg", alt: "Kreis") }' });
        const bundle = compile('med1').bundle;
        bundle.assets = { 'images/circle.svg': { hash: 'sha256:abc', size: 1, type: 'image/svg+xml' } };
        const seen: unknown[] = [];
        const instance = createItemInstance(bundle, 'med1');
        const { root } = renderItem(instance, document.body, {
            asset: (path, info) => { seen.push([path, info?.hash]); return `https://cdn.example.org/af/${info!.hash!.slice(7)}.svg`; }
        });
        expect(root.querySelector('img')!.getAttribute('src')).toBe('https://cdn.example.org/af/abc.svg');
        expect(seen).toEqual([['images/circle.svg', 'sha256:abc']]);

        document.body.innerHTML = '';
        const plain = renderItem(createItemInstance(bundle, 'med1'), document.body, { baseUrl: 'https://example.org/items/' });
        expect(plain.root.querySelector('img')!.getAttribute('src')).toBe('https://example.org/items/images/circle.svg');
    });
});

describe('Hören und Sehen: media, timer, flow', () => {
    class FakePlayer implements MediaPlayer {
        static last?: FakePlayer;
        volume = 1;
        loaded?: string;
        plays: Array<[number | undefined, number | undefined]> = [];
        onEnded?: () => void;
        blocked = false;
        private resolveLoad?: () => void;
        constructor(readonly video = false, readonly captions?: string) { FakePlayer.last = this; }
        load(url: string) { this.loaded = url; return new Promise<void>(r => { this.resolveLoad = r; }); }
        finishLoading() { this.resolveLoad?.(); }
        async play(from: number | undefined, to: number | undefined, onEnded: () => void) {
            if (this.blocked) throw new Error('NotAllowedError');
            this.plays.push([from, to]);
            this.onEnded = onEnded;
        }
        stop() { this.onEnded = undefined; }
        dispose() { }
    }

    test('Listen: lädt vorab, Uhren mit Ansagen, spielt ohne Steuerung, sperrt danach', async () => {
        AfMedia.createPlayer = (video, captions) => new FakePlayer(video, captions);
        let now = 0;
        const { compile } = await workspace({ hv1: `
            item hv1 {
              Listen(src: "audio/summer.mp3", plays: 2, prepare: 30s, pause: 10s, finish: 1min, from: 5s, to: 65s)
              a = Gap("Wohin?")
              c = Choice("Wann?", ["morgens", "abends"])
            }` });
        const bundle = compile('hv1').bundle;
        bundle.assets = { 'audio/summer.mp3': { hash: 'sha256:abc', size: 1, type: 'audio/mpeg' } };
        const instance = createItemInstance(bundle, 'hv1', { now: () => now });
        const { root } = renderItem(instance, document.body, { asset: (p, i) => `https://cdn.example.org/${i!.hash!.slice(7)}.mp3` });
        const media = root.querySelector('af-media')!;
        const player = FakePlayer.last!;
        const visibleTimer = () => [...root.querySelectorAll<HTMLElement>('af-timer')].find(t => !t.hidden);
        const text = (el: Element | undefined, sel: string) => el?.querySelector(sel)?.textContent;

        expect(player.loaded).toBe('https://cdn.example.org/abc.mp3');
        expect(player.video).toBe(false);
        expect(media.getAttribute('aria-label')).toBe('Hörtext');
        expect(text(media, '.af-media-status')).toBe('Wird geladen …');
        expect(media.querySelectorAll('input[type="range"]')).toHaveLength(1);    // volume only
        expect(visibleTimer()).toBeUndefined();

        player.finishLoading();
        await tick();
        expect(text(visibleTimer(), '.af-timer-label')).toBe('Lesezeit');
        expect(text(visibleTimer(), '.af-timer-value')).toBe('noch 0:30');
        expect(text(visibleTimer(), '.af-media-announce')).toBe('Lesezeit: 30 Sekunden.');

        now = 30000; instance.clock!.tick();
        expect(player.plays).toEqual([[5, 65]]);
        expect(media.getAttribute('data-playing')).toBe('true');
        expect(text(media, '.af-media-announce')).toBe('Die Wiedergabe beginnt.');
        expect(root.textContent).toContain('1. von 2 Wiedergaben');
        expect(visibleTimer()).toBeUndefined();
        player.onEnded!();
        expect(text(visibleTimer(), '.af-timer-label')).toBe('Pause');
        now = 40000; instance.clock!.tick();
        expect(player.plays).toHaveLength(2);
        player.onEnded!();
        expect(text(visibleTimer(), '.af-media-announce')).toBe('Zeit zum Vervollständigen: 1 Minute.');
        now = 90000; instance.clock!.tick();
        expect(text(visibleTimer(), '.af-media-announce')).toBe('Zeit zum Vervollständigen: noch 10 Sekunden.');

        now = 100000; instance.clock!.tick();
        expect(root.hasAttribute('data-locked')).toBe(true);
        expect((root.querySelector('af-input input') as HTMLInputElement).readOnly).toBe(true);
        expect(root.querySelector('af-toggle')!.getAttribute('aria-disabled')).toBe('true');
        expect(root.textContent).toContain('Der Hörtext ist beendet.');
        expect(root.querySelector('af-flow')!.hasAttribute('hidden')).toBe(true);
    });

    test('verlangt der Browser eine Bedienung, erscheint „Wiedergabe starten“', async () => {
        AfMedia.createPlayer = () => Object.assign(new FakePlayer(), { blocked: true });
        const { compile } = await workspace({ hv2: 'item hv2 { Listen(src: "https://example.org/x.mp3") a = Gap("x") }' });
        const instance = createItemInstance(compile('hv2').bundle, 'hv2', { now: () => 0 });
        const { root } = renderItem(instance, document.body, {});
        const player = FakePlayer.last!;
        player.finishLoading();
        await tick();
        instance.clock!.tick();                        // reading time 0s elapses
        await tick();
        const button = root.querySelector('button.af-media-start') as HTMLButtonElement;
        expect(button.hidden).toBe(false);
        player.blocked = false;
        button.click();
        await tick();
        expect(player.plays).toEqual([[undefined, undefined]]);
        expect(button.hidden).toBe(true);
    });

    test('Video mit Untertiteln und Audiodeskription; Play startet per Knopf', async () => {
        AfMedia.createPlayer = (video, captions) => new FakePlayer(video, captions);
        const { compile } = await workspace({ vid: `
            item vid { Play(src: "https://example.org/film.mp4", plays: 1, captions: "https://example.org/film.vtt",
                            described: "https://example.org/film-ad.mp4", label: "Der Hafen") }` });
        const instance = createItemInstance(compile('vid').bundle, 'vid', { now: () => 0, accommodations: ['extended_descriptions'] });
        const { root } = renderItem(instance, document.body, {});
        const media = root.querySelector<HTMLElement>('af-media')!;
        const player = FakePlayer.last!;
        expect(player).toMatchObject({ video: true, captions: 'https://example.org/film.vtt', loaded: 'https://example.org/film-ad.mp4' });
        expect(media.dataset.kind).toBe('video');
        expect(media.getAttribute('aria-label')).toBe('Video: Der Hafen');
        player.finishLoading();
        await tick();
        find(instance.nodes, 'toggle').emit('check');      // the start button
        await tick();
        expect(player.plays).toHaveLength(1);
    });
});

describe('Material neben den Aufgaben', () => {
    test('stimulus ist ein benannter, per Tastatur scrollbarer Bereich vor den Seiten', async () => {
        const { compile } = await workspace({ st1: `
            item st1 {
              stimulus(label: "Bookridge") { lines { "Als Tom aufwachte," "war es noch dunkel." } }
              page { a = Gap("Wer?") }
              page { b = Gap("Wann?") }
            }` });
        const { root } = renderItem(createItemInstance(compile('st1').bundle, 'st1'), document.body, {});
        const stimulus = root.querySelector('af-stimulus')!;
        expect(stimulus.getAttribute('role')).toBe('region');
        expect(stimulus.getAttribute('aria-label')).toBe('Bookridge');
        expect((stimulus as HTMLElement).tabIndex).toBe(0);
        expect(root.firstElementChild).toBe(stimulus);
    });
});

describe('Inhalte mit Bild und Auszeichnung', () => {
    test('picture als Option einer Auswahl, Folge aus Text und Auszeichnung', async () => {
        const { compile } = await workspace({ pic1: `
            item pic1 {
              tier = Choice("Welches Tier?", [image("images/dog.png", "Hund"), image("images/cat.png", "Katze")])
              p { "fröhlich / " + del("frölich") }
            }` });
        const bundle = compile('pic1').bundle;
        expect(Object.keys(bundle.assets ?? {})).toEqual(['images/cat.png', 'images/dog.png']);
        const { root } = renderItem(createItemInstance(bundle, 'pic1'), document.body, { baseUrl: 'https://example.org/a/' });
        const imgs = [...root.querySelectorAll('af-toggle img')] as HTMLImageElement[];
        expect(imgs.map(i => [i.getAttribute('src'), i.alt])).toEqual([
            ['https://example.org/a/images/dog.png', 'Hund'], ['https://example.org/a/images/cat.png', 'Katze']]);
        const p = [...root.children].find(e => e.localName === 'af-p')!;
        expect(p.querySelector('del')!.textContent).toBe('frölich');
        expect(p.textContent).toBe('fröhlich / frölich');
    });
});

describe('Formeln', () => {
    test('math wird beim Übersetzen zu MathML; als Text gilt das LaTeX', async () => {
        const { compile } = await workspace({ fo1: String.raw`
            item fo1 {
              p { "Berechne " math("\frac{3}{4}") "." }
              k = Choice("Welche Gleichung?", [math("y = 2x + 3"), math("y = x^2")])
            }` });
        const bundle = compile('fo1').bundle;
        const { root } = renderItem(createItemInstance(bundle, 'fo1'), document.body, {});
        const p = [...root.children].find(e => e.localName === 'af-p')!;
        const math = p.querySelector('.af-math math')!;
        expect(math.querySelector('mfrac')).not.toBeNull();
        expect(math.querySelector('annotation')!.textContent).toBe('\\frac{3}{4}');
        expect(root.querySelectorAll('af-toggle .af-math math')).toHaveLength(2);
    });
});

describe('Auswahllücke im Fließtext', () => {
    test('Select im Satz; Lückentext mit Wortspeicher: jedes Wort nur einmal (taken)', async () => {
        const { compile } = await workspace({ cl1: `
            item cl1 {
              p { "Ich fahre " mode = Select("Verkehrsmittel", ["mit dem", "zu"]) " Bus." }
              p { "A " fox1 = Select("Lücke 1", ["x", "y", "z"], taken: [fox2]) " B "
                  fox2 = Select("Lücke 2", ["x", "y", "z"], taken: [fox1]) " C" }
            }
            coding cl1 { mode: correct(mode == 1)  fox1: correct(fox1 == 2)  fox2: correct(fox2 == 1) }` });
        const bundle = compile('cl1').bundle;
        const instance = createItemInstance(bundle, 'cl1');
        const { root } = renderItem(instance, document.body, {});
        await tick();
        const p = [...root.children].find(e => e.localName === 'af-p')!;
        const select = p.querySelector('select')!;
        expect(select.getAttribute('aria-label')).toBe('Verkehrsmittel');
        const choose = (s: HTMLSelectElement, i: number) => { s.selectedIndex = i; s.dispatchEvent(new Event('change')); };
        choose(select, 1);
        const gaps = [...root.querySelectorAll('select')].filter(s => s.getAttribute('aria-label')?.startsWith('Lücke')) as HTMLSelectElement[];
        expect(gaps.map(g => g.getAttribute('aria-label'))).toEqual(['Lücke 1', 'Lücke 2']);
        choose(gaps[0], 2);
        await tick();
        expect([...gaps[1].options].map(o => o.disabled)).toEqual([false, false, true, false]);
        choose(gaps[1], 1);
        expect([instance.responses().variables.fox1.value, instance.responses().variables.fox2.value]).toEqual([2, 1]);
        const coding = codeResponses(bundle, instance.responses()).variables;
        expect([coding.mode.code, coding.fox1.code, coding.fox2.code]).toEqual([1, 1, 1]);
    });
});

describe('Koordinatensystem', () => {
    test('Punkt setzen per Tastatur mit Fang am Raster und Ansage; Vieleck folgt', async () => {
        const { compile } = await workspace({ geo1: `
            component Square(a: Point?, b: Point?): response List<Point?> {
              state c: Point? = none
              plane(x: -1 .. 7, y: -1 .. 6, grid: 1, x_axis: "", y_axis: "") {
                polygon(points: [a, b, c])
                dot(at: a, label: "A")
                line(a: a, b: b)
                right_angle(vertex: b, a: a, b: point(4, 4))
                caption(at: point(2.5, 0.5), text: "a")
                value(bind: c, min: point(-1, -1), max: point(7, 6), step: 1/2, label: "Punkt C", display: "C")
              }
              response [c]
            }
            item geo1 { sq = Square(a: point(1, 1), b: point(4, 1)) }` });
        const instance = createItemInstance(compile('geo1').bundle, 'geo1');
        const { root } = renderItem(instance, document.body, {});
        const plane = root.querySelector('af-plane')!;
        expect((plane.querySelector('.af-plane-area') as HTMLElement).style.aspectRatio).toBe('8 / 7');
        const c = root.querySelector('af-value[data-point]') as HTMLElement;
        expect(c.getAttribute('aria-valuetext')).toMatch(/Punkt C: noch nicht gesetzt/);
        key(c, 'ArrowRight');                       // first key press: center (3 | 2,5)
        expect(c.getAttribute('aria-valuetext')).toBe('Punkt C bei (3 | 5/2)');
        key(c, 'ArrowRight'); key(c, 'ArrowRight'); key(c, 'ArrowUp'); key(c, 'PageUp');
        expect(instance.responses().variables.sq.value).toEqual([{ x: 4, y: '11/2' }]); // Page Up: 5 steps
        expect(c.style.left).toBe('62.5%');
        expect(root.querySelector('af-polygon path.af-fill')).not.toBeNull();
        expect(root.querySelector('af-dot .af-shape-label')!.textContent).toBe('A');
        // shapes from std: line extended far, right angle as a corner with a dot, label centered
        const lines = [...root.querySelectorAll('af-polygon path:not(.af-fill)')].map(l => l.getAttribute('d'));
        expect(lines[0]).toBe('M-2996,5 L3001,5');
        expect(lines[1]).toBe('M3.6,5 L3.6,4.6 L4,4.6');
        expect([...root.querySelectorAll('af-caption .af-shape-label')].map(t => [t.textContent, (t as HTMLElement).dataset.place]))
            .toEqual([['·', 'center'], ['a', 'center']]);
    });

    test('Schaltflächen und Eingabe an Koordinaten, Hintergrundbild', async () => {
        const { compile } = await workspace({ geo2: `
            component Corners(): response Set<Int> {
              state chosen: Set<Int> = {}
              state name: Text = ""
              plane(x: 0 .. 10, y: 0 .. 8, background: "https://cdn.example.org/triangle.svg") {
                for p, i in [point(1, 1), point(9, 1)] {
                  toggle(at: p, label: "Ecke " + i, checked: i in chosen,
                         on check: chosen := chosen + {i}, on uncheck: chosen := chosen - {i})
                }
                input(bind: name, label: "Name", at: point(5, 4))
              }
              response chosen
            }
            item geo2 { corners = Corners() }` });
        const instance = createItemInstance(compile('geo2').bundle, 'geo2');
        const { root } = renderItem(instance, document.body, {});
        const toggles = root.querySelectorAll('af-toggle[data-at]') as NodeListOf<HTMLElement>;
        expect([toggles[1].style.left, toggles[1].style.top]).toEqual(['90%', '87.5%']);
        toggles[1].click();
        expect(instance.responses().variables.corners.value).toEqual([2]);
        const input = root.querySelector('af-input[data-at]') as HTMLElement;
        expect([input.style.left, input.style.top]).toEqual(['50%', '50%']);
        expect((root.querySelector('.af-plane-background') as HTMLImageElement).src).toBe('https://cdn.example.org/triangle.svg');
    });
});

describe('Blöcke, Listen und Chat', () => {
    test('Message aus std: Verlauf als Liste, eigene Nachricht rechts; Schild als benannte Gruppe', async () => {
        const { compile } = await workspace({ chat1: `
            item chat1 {
              list {
                p(tone: hint) "Wednesday"
                Message(from: "Jonas", at: "16:40") "Bring the ladder?"
                Message(from: "Henrike", own: true) { p "On my way." }
              }
              box(label: "Schild") { list(ordered: true) { "eins" "zwei" } }
              box(tone: warning, heading: "Mind the step!") { p "Wet paint." }
            }` });
        const instance = createItemInstance(compile('chat1').bundle, 'chat1');
        const { root } = renderItem(instance, document.body, {});
        await tick();
        const chat = root.querySelector('af-list')!;
        expect(chat.getAttribute('role')).toBe('list');
        const items = [...chat.querySelectorAll('[role="listitem"]')];
        expect(items.map(i => i.localName)).toEqual(['af-p', 'af-box', 'af-box']);
        expect(items[1].textContent).toBe('Jonas, 16:40Bring the ladder?');
        expect([items[1].getAttribute('data-side'), items[2].getAttribute('data-side')]).toEqual(['start', 'end']);
        expect(items[2].getAttribute('data-tone')).toBe('accent');
        const sign = root.querySelector('af-box[aria-label="Schild"]')!;
        expect(sign.getAttribute('role')).toBe('group');
        const ordered = sign.querySelector('af-list')!;
        expect(ordered.hasAttribute('data-ordered')).toBe(true);
        expect(ordered.querySelectorAll('[role="listitem"]').length).toBe(2);
        const warning = root.querySelector('af-box[data-tone="warning"]')!;
        const heading = warning.querySelector('.af-box-heading')!;
        expect(heading.textContent).toBe('Mind the step!');
        expect(warning.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(warning.hasAttribute('aria-label')).toBe(false);
    });
});

describe('Bild als Inhalt, starke Hervorhebung, Beschreibung', () => {
    test('image mit Breite im Absatz, strong, extended_descriptions an jedem Element', async () => {
        const { compile } = await workspace({ im1: `
            item im1 {
              p {
                image("https://example.org/a.png", "Dreieck", width: 8em)
                strong("Achtung")
                variant(extended_descriptions) "Das Dreieck ist rechtwinklig."
              }
            }` });
        const instance = createItemInstance(compile('im1').bundle, 'im1', { accommodations: ['extended_descriptions'] });
        const { root } = renderItem(instance, document.body, {});
        const img = root.querySelector('img.af-image') as HTMLImageElement;
        expect([img.alt, img.style.width]).toEqual(['Dreieck', '8em']);
        expect(root.querySelector('strong')!.textContent).toBe('Achtung');
        const p = root.querySelector('af-p')!;
        const description = p.querySelector('.af-description')!;
        expect(description.textContent).toBe('Das Dreieck ist rechtwinklig.');
        expect(p.getAttribute('aria-describedby')).toBe(description.id);
    });
});

describe('Bedienung mit Tastatur und Tastern', () => {
    const source = `item sw1 "Taster" {
  a = Choice("Welche Zahl ist gerade?", ["3", "4", "5"])
  w = MarkWords("Der Hund bellt laut", label: "Markiere das Verb")
  t = Gap("Wie heißt du?")
  s = Select("Farbe", ["rot", "grün"])
}
`;
    async function setup(accommodations: string[] = [], profile = {}) {
        const { compile } = await workspace({ sw1: source });
        const instance = createItemInstance(compile('sw1').bundle, 'sw1', { accommodations });
        const rendered = renderItem(instance, document.body, { profile });
        await rendered.ready;
        await tick();
        return { instance, ...rendered };
    }
    const marked = (root: HTMLElement) => root.querySelector('[data-af-scan]');

    test('Taster-Bedienung wird nur bei Bedarf geladen', async () => {
        const without = await setup();
        expect(document.getElementById('af-scan-styles')).toBeNull();
        expect(without.root.hasAttribute('data-scanning')).toBe(false);
        without.dispose();
        // item disposed before the module has loaded: no scanner
        const { compile } = await workspace({ sw1: source });
        const early = renderItem(createItemInstance(compile('sw1').bundle, 'sw1', { accommodations: ['switch_access'] }), document.body, {});
        early.dispose();
        await early.ready;
        expect(document.querySelector('[data-scanning], [data-af-scan]')).toBeNull();
    });

    test('Schalter im Text: eine Tab-Haltestelle, Pfeiltasten wandern, Leertaste markiert', async () => {
        const { instance, root } = await setup();
        const words = [...root.querySelectorAll<HTMLElement>('af-toggle[data-look]')];
        expect(words.map(w => w.tabIndex)).toEqual([0, -1, -1, -1]);
        words[0].focus();
        key(words[0], 'ArrowRight');
        key(words[1], 'ArrowRight');
        expect(document.activeElement).toBe(words[2]);
        expect(words.map(w => w.tabIndex)).toEqual([-1, -1, 0, -1]);
        expect(instance.responses().variables.w.value).toEqual([]);
        key(words[2], ' ');
        expect(instance.responses().variables.w.value).toEqual([3]);
        key(words[2], 'End');
        expect(document.activeElement).toBe(words[3]);
    });

    test('Scanning mit zwei Tastern: Gruppen betreten, wählen, schreiben, Auswahlliste über die Leiste', async () => {
        const { instance, root, dispose } = await setup(['switch_access'], { interaction: { switch_access: { mode: 'step' } } });
        const doc = root.ownerDocument;
        const press = (k: string) => key(doc.activeElement ?? doc.body, k);
        const radiogroup = root.querySelector('af-group[role="radiogroup"]')!;
        expect(marked(root)).toBe(radiogroup);

        // choose an option: enter the group, advance to the second, select, back to the group
        press('Enter');
        expect(marked(root)?.textContent).toBe('3');
        press(' ');
        press('Enter');
        expect(instance.responses().variables.a.value).toEqual([2]);
        expect(marked(root)).toBe(radiogroup);

        // highlight a word: stay in the group, return to the group at its end
        press(' ');
        const words = root.querySelector('af-group:not([role="radiogroup"])')!;
        expect(marked(root)).toBe(words);
        press('Enter');
        press(' ');
        press(' ');
        expect(marked(root)?.textContent).toBe('bellt');
        press('Enter');
        expect(instance.responses().variables.w.value).toEqual([3]);
        press(' ');
        press(' ');
        expect(marked(root)).toBe(words);

        // writing: the field gets focus and owns the keys, Escape resumes scanning
        press(' ');
        press('Enter');
        const field = root.querySelector('af-input input') as HTMLInputElement;
        expect(document.activeElement).toBe(field);
        key(field, ' ');
        expect(marked(root)).toBe(root.querySelector('af-input'));
        field.value = 'Mia';
        field.dispatchEvent(new Event('input'));
        key(field, 'Escape');
        expect(instance.responses().variables.t.value).toBe('Mia');

        // dropdown: control toolbar with „vorige“, „nächste“, „fertig“
        press(' ');
        expect(marked(root)?.localName).toBe('select');
        press('Enter');
        const panel = root.querySelector('.af-scan-panel')!;
        expect([...panel.querySelectorAll('button')].map(b => b.textContent)).toEqual(['vorige', 'nächste', 'fertig']);
        press(' ');
        press('Enter');
        expect(instance.responses().variables.s.value).toBe(1);
        press(' ');
        press('Enter');
        expect(root.querySelector('.af-scan-panel')).toBeNull();
        expect(marked(root)?.localName).toBe('select');

        // cycle wraps around
        press(' ');
        expect(marked(root)).toBe(radiogroup);
        dispose();
        expect(marked(document.body as HTMLElement)).toBeNull();
    });

    test('Scanning im Takt: die Markierung wandert von selbst, eine Taste wählt', async () => {
        vi.useFakeTimers();
        try {
            const { compile } = await workspace({ sw1: source });
            const instance = createItemInstance(compile('sw1').bundle, 'sw1', { accommodations: ['switch_access'] });
            const { root, ready } = renderItem(instance, document.body, { profile: { interaction: { switch_access: { mode: 'auto', interval: 1 } } } });
            await ready;
            await vi.advanceTimersByTimeAsync(0);
            expect(marked(root)).toBe(root.querySelector('af-group[role="radiogroup"]'));
            await vi.advanceTimersByTimeAsync(1000);
            expect(marked(root)).toBe(root.querySelector('af-group:not([role="radiogroup"])'));
            key(document.body, ' ');
            expect(marked(root)?.textContent).toBe('Der');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Sprachstufen', () => {
    const source = `item lv1 "Stufen" {
  stimulus(label: "Text") {
    p "Erster Absatz mit langen Sätzen."
    p "Zweiter Absatz."
    variant(easy_language) {
      p "Kurz."
      p { "Noch " strong("kurz") "." }
      p "Drei."
    }
  }
  p { "Lena winkt ihrer Freundin Mia zu." variant(simple_language) "Lena winkt Mia." variant(easy_language) "Lena winkt." }
  p { "Nur ein Text." variant(simple_language) "Nur einfach." }
  a = Choice(wording("Was macht die Frau am Nachmittag im Park?", easy: "Was macht die Frau?"),
             ["Blumen gießen", wording("im Park joggen", simple: "joggen")])
}
coding lv1 {
  a: correct(a == {2})
}
`;
    test('Einfache und Leichte Sprache in Absätzen, Fragen und Optionen; Kodierung bleibt gleich', async () => {
        const { compile } = await workspace({ lv1: source });
        const bundle = compile('lv1').bundle;
        const view = (accommodations: string[]) => {
            document.body.innerHTML = '';
            const instance = createItemInstance(bundle, 'lv1', { accommodations });
            const { root } = renderItem(instance, document.body, {});
            const texts = [...root.querySelectorAll(':scope > af-p')].map(p => p.textContent);
            const stimulus = [...root.querySelectorAll('af-stimulus af-p')].map(p => p.textContent);
            const legend = root.querySelector('.af-legend')!.textContent;
            const options = [...root.querySelectorAll('af-toggle')].map(t => t.textContent);
            return { instance, root, texts, stimulus, legend, options };
        };
        expect(view([]).stimulus).toEqual(['Erster Absatz mit langen Sätzen.', 'Zweiter Absatz.']);
        expect(view(['simple_language']).stimulus).toEqual(['Erster Absatz mit langen Sätzen.', 'Zweiter Absatz.']);
        expect(view(['easy_language']).stimulus).toEqual(['Kurz.', 'Noch kurz.', 'Drei.']);
        expect(view([])).toMatchObject({ texts: ['Lena winkt ihrer Freundin Mia zu.', 'Nur ein Text.'],
            legend: 'Was macht die Frau am Nachmittag im Park?', options: ['Blumen gießen', 'im Park joggen'] });
        expect(view(['simple_language'])).toMatchObject({ texts: ['Lena winkt Mia.', 'Nur einfach.'],
            legend: 'Was macht die Frau am Nachmittag im Park?', options: ['Blumen gießen', 'joggen'] });
        // easy language: falls back to simple language, then to the plain text
        const easy = view(['easy_language']);
        expect(easy).toMatchObject({ texts: ['Lena winkt.', 'Nur einfach.'], legend: 'Was macht die Frau?',
            options: ['Blumen gießen', 'joggen'] });
        (easy.root.querySelectorAll('af-toggle')[1] as HTMLElement).click();
        expect(codeResponses(bundle, easy.instance.responses()).variables.a.code).toBe(1);
    });
});

describe('Themes', () => {
    const theme = { name: 'probe', css: '& { --af-color-accent: #123456; }\naf-toggle { font-weight: 700; }', keyframes: '@keyframes probe-x { to { opacity: 1; } }' };

    test('ohne Theme kein data-theme; mit Theme data-theme und eingebettetes CSS, einmal je Dokument', () => {
        document.head.querySelector('#af-theme-probe')?.remove();
        expect(renderItem(createItemInstance(bundles.fraction1, 'fraction1'), document.body).root.dataset.theme).toBeUndefined();
        const { root } = renderItem(createItemInstance(bundles.fraction1, 'fraction1'), document.body, { theme });
        renderItem(createItemInstance(bundles.fraction2, 'fraction2'), document.body, { theme });
        expect(root.dataset.theme).toBe('probe');
        expect(document.querySelectorAll('#af-theme-probe')).toHaveLength(1);
        // accommodations win: nested under af-root without high contrast, disabled under forced colors
        expect(themeCss(theme)).toBe('@media not (forced-colors: active) {\naf-root[data-theme="probe"]:not([data-contrast="high"]) {\n'
            + theme.css + '\n}\n}\n' + theme.keyframes);
    });

    test('reduzierte Bewegung schaltet Animationen im Standard-Theme ab, auch die eines Themes', () => {
        renderItem(createItemInstance(bundles.fraction1, 'fraction1'), document.body, { theme });
        expect(document.getElementById('af-theme')!.textContent).toContain('af-root[data-reduced-motion] * { transition: none !important; animation: none !important; }');
    });

    test('ungültiger Name', () => {
        expect(() => themeCss({ name: 'x"]{}', css: '' })).toThrow(/Theme-Name/);
    });
});

describe('Zuordnen durch Ziehen', () => {
    test('Karten der Gruppe auf Plätze legen: Antippen von Karte und Platz, Karte verschwindet, Liste bleibt', async () => {
        const { compile } = await workspace({ drag1: `
            item drag1 {
              group(label: "Wer bringt was mit?", cards: end) {
                p { "Ingmar " a = Select("Ingmar", ["Kompass", "Laterne", "Fernglas"], taken: [a, b]) }
                p { "Paulina " b = Select("Paulina", ["Kompass", "Laterne", "Fernglas"], taken: [a, b]) }
              }
            }` });
        const instance = createItemInstance(compile('drag1', { dev: true }).bundle, 'drag1');
        const { root } = renderItem(instance, document.body, { dev: true });
        await tick();
        const cards = () => [...root.querySelectorAll<HTMLElement>('.af-cards .af-card')];
        expect(cards().map(c => c.textContent)).toEqual(['Kompass', 'Laterne', 'Fernglas']);
        expect(root.querySelector('.af-cards')!.getAttribute('aria-hidden')).toBe('true');
        const slots = [...root.querySelectorAll<HTMLSelectElement>('af-group[data-slot] select')];
        expect(slots).toHaveLength(2);
        expect(slots.every(s => s.classList.contains('af-slot'))).toBe(true);

        // tap: card „Fernglas“, then Paulina's slot
        const tap = (el: Element) => {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
        };
        tap(cards()[2]);
        expect(cards()[2].classList.contains('af-picked')).toBe(true);
        slots[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        await tick();
        expect(instance.responses().variables.b.value).toBe(3);
        expect(cards().filter(c => !c.hidden).map(c => c.textContent)).toEqual(['Kompass', 'Laterne']);
        expect(root.querySelectorAll('af-group[data-slot]')[1].querySelector('.af-slot-face')!.textContent).toBe('Fernglas');

        // the dropdown stays operable and returns the card
        slots[1].selectedIndex = 0;
        slots[1].dispatchEvent(new Event('change'));
        await tick();
        expect(instance.responses().variables.b.value).toBe(null);
        expect(cards().filter(c => !c.hidden)).toHaveLength(3);
    });
});

describe('Zeichenleiste', () => {
    test('Knöpfe fügen an der Schreibmarke ein, mit gesprochenem Namen', async () => {
        const { compile } = await workspace({ keys1: `
            item keys1 { why = FreeText("Begründe.", keys: ["·", "²", "√"]) }` });
        const instance = createItemInstance(compile('keys1', { dev: true }).bundle, 'keys1');
        const { root } = renderItem(instance, document.body, { dev: true });
        await tick();
        const field = root.querySelector('textarea')!;
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('.af-keys button')];
        expect(buttons.map(b => b.textContent)).toEqual(['·', '²', '√']);
        expect(buttons[1].getAttribute('aria-label')).toBe('hoch 2 einfügen');
        field.value = '3 4';
        field.setSelectionRange(1, 1);
        buttons[0].click();
        expect(instance.responses().variables.why.value).toBe('3· 4');
        expect(field.selectionStart).toBe(2);
    });
});

describe('Zeichenzähler', () => {
    test('steht am Feld (beschreibend) und wird nur an Schwellen angesagt', async () => {
        const { compile } = await workspace({ cnt: `item cnt1 { a = FreeText("Antwort", max: 100) }` });
        const instance = createItemInstance(compile('cnt').bundle, 'cnt1');
        const { root } = renderItem(instance, document.body, {});
        const field = root.querySelector('textarea')!;
        const counter = root.querySelector('.af-counter')!;
        const status = root.querySelector('af-input [role="status"]')!;
        expect(field.getAttribute('aria-describedby')).toBe(counter.id);
        expect(counter.hasAttribute('aria-live')).toBe(false);
        const type = (t: string) => { field.value = t; field.dispatchEvent(new Event('input')); };
        type('a'.repeat(50));
        expect(counter.textContent).toBe('50 / 100');
        expect(status.textContent).toBe('');
        type('a'.repeat(92));
        expect(status.textContent).toBe('Noch 8 Zeichen frei.');
        type('a'.repeat(95));
        expect(status.textContent).toBe('Noch 8 Zeichen frei.');   // no new announcement per character
        type('a'.repeat(100));
        expect(status.textContent).toBe('Höchstlänge erreicht.');
    });
});

describe('Vorlesen und Fokus', () => {
    class FakeSpeech implements Speech {
        spoken: string[] = [];
        cancelled = 0;
        private finish?: () => void;
        speak(text: string) { this.spoken.push(text); return new Promise<void>(r => { this.finish = r; }); }
        cancel() { this.cancelled++; this.finish?.(); }
        end() { this.finish?.(); }
    }

    test('Knopf an Absatz, Frage und beschriftetem Feld; liest, was angezeigt wird, und markiert den Block', async () => {
        const speech = new FakeSpeech();
        const instance = createItemInstance(bundles.fraction1, 'fraction1', { accommodations: ['read_aloud'] });
        const { root, ready } = renderItem(instance, document.body, { speech });
        await ready;
        expect(root.hasAttribute('data-read-aloud')).toBe(true);
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('button.af-speak')];
        expect(buttons.map(b => b.parentElement!.localName)).toEqual(['af-p', 'af-group', 'af-input']);
        expect(buttons.every(b => b.getAttribute('aria-label') === 'Vorlesen')).toBe(true);

        buttons[0].click();
        expect(speech.spoken).toEqual(['Kürze den Bruch 6/8: (Feld: gekürzter Bruch)']);
        expect(root.querySelector('af-p')!.hasAttribute('data-speaking')).toBe(true);
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
        buttons[1].click();                              // another block: the first stops
        expect(root.querySelector('af-p')!.hasAttribute('data-speaking')).toBe(false);
        expect(speech.spoken[1]).toBe('Welcher Bruch ist größer als 1/2? 2/5. 3/5. 1/4.');
        buttons[1].click();                              // the same again: stop
        expect(root.querySelector('af-group')!.hasAttribute('data-speaking')).toBe(false);
        expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
    });

    test('ohne Stimme keine Knöpfe; ohne read_aloud nichts', async () => {
        const quiet = renderItem(createItemInstance(bundles.fraction1, 'fraction1', { accommodations: ['read_aloud'] }), document.body);
        await quiet.ready;
        expect(quiet.root.querySelector('.af-speak')).toBeNull();
        const off = renderItem(createItemInstance(bundles.fraction1, 'fraction1'), document.body, { speech: new FakeSpeech() });
        await off.ready;
        expect(off.root.querySelector('.af-speak')).toBeNull();
    });

    test('Formeln und Rechenzeichen als Sprache', () => {
        expect(texSpeech('\\frac{3}{4}')).toBe('3 Viertel');
        expect(texSpeech('\\frac{1}{2}')).toBe('ein Halb');
        expect(texSpeech('\\frac{a}{b}')).toBe('a durch b');
        expect(texSpeech('6 \\cdot 4 = 24')).toBe('6 mal 4 gleich 24');
        expect(texSpeech('x^2 - 1')).toBe('x hoch 2 minus 1');
        expect(normalize('6 · 4')).toBe('6 mal 4');
        expect(normalize('6 : 4')).toBe('6 geteilt durch 4');
        expect(normalize('6 − 4')).toBe('6 minus 4');
        expect(normalize('Um 10:30 Uhr')).toBe('Um 10:30 Uhr');
    });

    test('Fokus: Rahmen und Uhr auf Knopfdruck', async () => {
        const { compile } = await workspace({ fz: `item fz { timer(duration: 30s, label: "Zeit") a = Gap("Antwort") }` });
        const instance = createItemInstance(compile('fz').bundle, 'fz', { accommodations: ['focus_emphasis'] });
        const { root } = renderItem(instance, document.body);
        await tick();
        expect(root.hasAttribute('data-focus')).toBe(true);
        const timer = root.querySelector('af-timer')!;
        const value = timer.querySelector<HTMLElement>('.af-timer-value')!;
        const reveal = timer.querySelector<HTMLButtonElement>('.af-timer-reveal')!;
        expect(value.hidden).toBe(true);
        expect(reveal.hidden).toBe(false);
        expect(reveal.textContent).toBe('Zeit zeigen');
        reveal.click();
        expect(value.hidden).toBe(false);
        expect(reveal.textContent).toBe('Zeit ausblenden');
        // without focus emphasis: no button, the time shows
        document.body.innerHTML = '';
        const plain = renderItem(createItemInstance(compile('fz').bundle, 'fz'), document.body);
        await tick();
        expect(plain.root.querySelector<HTMLElement>('.af-timer-reveal')!.hidden).toBe(true);
        expect(plain.root.querySelector<HTMLElement>('.af-timer-value')!.hidden).toBe(false);
    });
});
