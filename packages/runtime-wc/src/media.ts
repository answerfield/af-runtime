import { effect, type MediaControl, type TimerControl, type TimerState } from '@answerfield/runtime-core';
import { AfElement, assetUrl, setAttr, size } from './base.js';

/** Playback backend of a `media` element; replaceable (tests, other playback paths). */
export interface MediaPlayer {
    /** Element to show (video); undefined for audio. */
    readonly view?: HTMLElement;
    /** Loads completely; resolves once playback can run without stalling. */
    load(url: string): Promise<void>;
    /** Plays from `from` (seconds) to `to` or the end, then calls `onEnded`. */
    play(from: number | undefined, to: number | undefined, onEnded: () => void): Promise<void>;
    stop(): void;
    volume: number;
    dispose(): void;
}

const VIDEO = /\.(mp4|m4v|webm|ogv|mov)(\?|#|$)/i;

/** Default player: downloads the whole file, then plays from memory (no buffering mid-play). */
export class HtmlMediaPlayer implements MediaPlayer {
    private readonly media: HTMLMediaElement;
    private url?: string;
    private onEnded?: () => void;
    private to?: number;

    constructor(video: boolean, captions?: string) {
        this.media = video ? document.createElement('video') : new Audio();
        this.media.preload = 'auto';
        if (this.media instanceof HTMLVideoElement) {
            this.media.playsInline = true;
            this.media.className = 'af-media-video';
            if (captions) {
                const track = Object.assign(document.createElement('track'), { kind: 'captions', srclang: 'de', label: 'Untertitel', src: captions, default: true });
                this.media.append(track);
            }
        }
        this.media.addEventListener('ended', () => this.finish());
        this.media.addEventListener('timeupdate', () => {
            if (this.to !== undefined && this.media.currentTime >= this.to) this.finish();
        });
    }

    get view(): HTMLElement | undefined {
        return this.media instanceof HTMLVideoElement ? this.media : undefined;
    }

    async load(url: string): Promise<void> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.url = URL.createObjectURL(await response.blob());
        await new Promise<void>((resolve, reject) => {
            this.media.addEventListener('canplaythrough', () => resolve(), { once: true });
            this.media.addEventListener('error', () => reject(new Error('Datei nicht lesbar')), { once: true });
            this.media.src = this.url!;
            this.media.load();
        });
    }

    async play(from: number | undefined, to: number | undefined, onEnded: () => void): Promise<void> {
        this.onEnded = onEnded;
        this.to = to;
        this.media.currentTime = from ?? 0;
        await this.media.play();
    }

    private finish(): void {
        const done = this.onEnded;
        this.onEnded = undefined;
        this.media.pause();
        done?.();
    }

    stop(): void {
        this.onEnded = undefined;
        this.media.pause();
    }

    get volume(): number { return this.media.volume; }
    set volume(v: number) { this.media.volume = v; }

    dispose(): void {
        this.stop();
        if (this.url) URL.revokeObjectURL(this.url);
    }
}

/**
 * Audio or video without seek or pause controls: loads completely, plays while the runtime says so, offers volume.
 * Shows loading and errors; the start of playback is announced via a live region; a browser that blocks autoplay
 * gets a start button.
 */
export class AfMedia extends AfElement {
    /** Player factory; replaced in tests. */
    static createPlayer: (video: boolean, captions?: string) => MediaPlayer = (video, captions) => new HtmlMediaPlayer(video, captions);

    private control?: MediaControl;
    private player?: MediaPlayer;
    private status!: HTMLElement;
    private announce!: HTMLElement;
    private start!: HTMLButtonElement;
    private stopEffect?: () => void;
    private loaded = false;
    private failed = false;

    protected override init(): void {
        this.control = this.node?.media;
        const video = VIDEO.test(this.source());
        const label = this.text('label');
        this.setAttribute('role', 'group');
        this.setAttribute('aria-label', label ? `${video ? 'Video' : 'Hörtext'}: ${label}` : video ? 'Video' : 'Hörtext');
        this.dataset.kind = video ? 'video' : 'audio';
        this.status = Object.assign(document.createElement('div'), { className: 'af-media-status' });
        this.announce = Object.assign(document.createElement('div'), { className: 'af-media-announce' });
        this.announce.setAttribute('role', 'status');
        this.announce.setAttribute('aria-live', 'polite');
        this.start = Object.assign(document.createElement('button'), { type: 'button', className: 'af-media-start', hidden: true });
        // Reload after an error, or start playback the browser blocked
        this.start.addEventListener('click', () => {
            if (this.failed) this.load();
            else this.playNow();
        });
        const volume = Object.assign(document.createElement('label'), { className: 'af-media-volume' });
        const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: '1' });
        slider.addEventListener('input', () => { if (this.player) this.player.volume = Number(slider.value); });
        volume.append('Lautstärke ', slider);
        const captions = this.text('captions');
        this.player = AfMedia.createPlayer(video, captions ? assetUrl(this, captions) : undefined);
        if (this.player.view) {
            const width = size(this.arg('width'));
            if (width) this.player.view.style.width = width;
            this.append(this.player.view);
        }
        this.append(this.status, this.start, volume, this.announce);
        if (!this.control) return;
        this.load();
        this.stopEffect = effect(() => {
            const playing = this.control!.playing.get();
            if (!this.loaded) return;
            if (playing) this.playNow();
            else this.player?.stop();
            this.showStatus(playing);
        });
    }

    /** Source: the version with audio description if the profile asks for it. */
    private source(): string {
        const described = this.text('described');
        const wants = this.closest('af-root')?.hasAttribute('data-descriptions');
        return (wants && described) || this.text('src') || '';
    }

    private load(): void {
        this.failed = false;
        this.start.hidden = true;
        this.status.textContent = 'Wird geladen …';
        this.player!.load(assetUrl(this, this.source())).then(
            () => {
                this.loaded = true;
                this.control?.ready();
                const playing = this.control?.playing.peek() ?? false;
                if (playing) this.playNow();
                this.showStatus(playing);
            },
            () => {
                this.failed = true;
                this.status.textContent = 'Die Datei konnte nicht geladen werden.';
                this.start.textContent = 'Erneut laden';
                this.start.hidden = false;
            });
    }

    /** Loaded: the status line (loading, errors) disappears; whether it plays shows as a style, the component says more. */
    private showStatus(playing: boolean): void {
        this.dataset.playing = String(playing);
        this.status.textContent = '';
        this.status.hidden = true;
    }

    private playNow(): void {
        const control = this.control;
        if (!control || !this.player) return;
        this.start.hidden = true;
        this.announce.textContent = 'Die Wiedergabe beginnt.';
        this.player.play(control.from.peek(), control.to.peek(), () => control.ended()).then(
            () => control.started(),
            () => {
                // Autoplay blocked: the browser requires a user gesture before playing
                this.start.textContent = 'Wiedergabe starten';
                this.start.hidden = false;
            });
    }

    protected render(): void { }

    disconnectedCallback(): void {
        this.stopEffect?.();
        this.player?.dispose();
    }
}

/** Milliseconds as `m:ss`, rounded up. */
function clock(ms: number): string {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Spoken duration: "30 Sekunden", "2 Minuten", "1 Minute 30 Sekunden". */
function spoken(ms: number): string {
    const s = Math.ceil(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    const min = m > 0 ? `${m} ${m === 1 ? 'Minute' : 'Minuten'}` : '';
    const sec = r > 0 || m === 0 ? `${r} ${r === 1 ? 'Sekunde' : 'Sekunden'}` : '';
    return [min, sec].filter(Boolean).join(' ');
}

/**
 * Countdown of a `timer`: label and remaining time (text or bar), visible only while it runs. Announces the start and
 * one minute and ten seconds before the end, not every second.
 */
export class AfTimer extends AfElement {
    private control?: TimerControl;
    private label!: HTMLElement;
    private value!: HTMLElement;
    private bar!: HTMLProgressElement;
    private announce!: HTMLElement;
    private stopEffect?: () => void;
    private interval?: ReturnType<typeof setInterval>;
    private wasRunning = false;
    private said = new Set<number>();
    /** With focus emphasis the clock shows on request only. */
    private reveal!: HTMLButtonElement;
    private revealed = false;
    private last?: TimerState;

    protected override init(): void {
        this.control = this.node?.timer;
        this.reveal = Object.assign(document.createElement('button'), { type: 'button', className: 'af-timer-reveal' });
        this.reveal.addEventListener('click', () => {
            this.revealed = !this.revealed;
            if (this.last) this.show(this.last);
        });
        this.label = Object.assign(document.createElement('span'), { className: 'af-timer-label' });
        this.value = Object.assign(document.createElement('span'), { className: 'af-timer-value' });
        this.value.setAttribute('role', 'timer');
        this.bar = Object.assign(document.createElement('progress'), { className: 'af-timer-bar' });
        this.announce = Object.assign(document.createElement('div'), { className: 'af-media-announce' });
        this.announce.setAttribute('role', 'status');
        this.announce.setAttribute('aria-live', 'polite');
        this.append(this.label, this.value, this.bar, this.reveal, this.announce);
        if (!this.control) return;
        this.stopEffect = effect(() => this.show(this.control!.state.get()));
        this.interval = setInterval(() => this.control?.tick(), 250);
    }

    private show(state: TimerState): void {
        this.last = state;
        // Whether the clock shows on request depends on the root; before mounting, decide once mounted
        if (!this.isConnected) queueMicrotask(() => { if (this.isConnected && this.last) this.show(this.last); });
        const look = this.text('look') ?? 'remaining';
        const label = this.text('label') ?? 'Zeit';
        const onRequest = this.closest('af-root')?.hasAttribute('data-focus') === true;
        const visible = !onRequest || this.revealed;
        this.hidden = !state.running || look === 'hidden';
        this.dataset.look = look;
        this.label.textContent = label;
        const remaining = state.remaining ?? 0;
        this.value.textContent = `noch ${clock(remaining)}`;
        this.value.hidden = look === 'bar' || !visible;
        this.bar.hidden = look !== 'bar' || !visible;
        this.reveal.hidden = !onRequest;
        this.reveal.textContent = this.revealed ? 'Zeit ausblenden' : 'Zeit zeigen';
        this.bar.max = Math.max(1, state.duration);
        this.bar.value = Math.max(0, state.duration - remaining);
        setAttr(this.bar, 'aria-label', label);
        if (state.running && !this.wasRunning) {
            this.said.clear();
            this.announce.textContent = look === 'hidden' ? '' : `${label}: ${spoken(state.duration)}.`;
        } else if (state.running && look !== 'hidden' && visible) {
            for (const mark of [60000, 10000]) {
                if (state.duration > mark && remaining <= mark && !this.said.has(mark)) {
                    this.said.add(mark);
                    this.announce.textContent = `${label}: noch ${spoken(mark)}.`;
                }
            }
        }
        this.wasRunning = state.running;
    }

    protected render(): void { }

    disconnectedCallback(): void {
        this.stopEffect?.();
        if (this.interval) clearInterval(this.interval);
    }
}

/** `flow` only steers the runtime; nothing to show. */
export class AfFlow extends AfElement {
    protected override init(): void {
        this.hidden = true;
    }

    protected render(): void { }
}
