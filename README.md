# af-runtime

answerfield ist eine typisierte, deklarativ-reaktive Sprache für digitale Assessments. Dieses Repository enthält die Runtime, die Aufgaben und Testhefte ausführt und darstellt.

## Pakete

| Paket | Inhalt |
|---|---|
| `@answerfield/runtime-core` | Interpreter, Testhefte, Antworten, Anpassungen und Kodierer |
| `@answerfield/runtime-wc` | Darstellung als Web Components |
| `@answerfield/player` | Schnittstelle zum Einbetten von Aufgaben und Testheften |
| `@answerfield/practice` | Üben: Antworten prüfen und Rückmeldung zeigen |

Die Pakete liegen als Dateien an den [Releases](https://github.com/answerfield/af-runtime/releases).

## Bauen und testen

Voraussetzung ist Node.js 22.12 oder neuer.

```sh
npm ci && npm run build && npm test
```

## Lizenzen

| Pfad | Lizenz |
|---|---|
| Code | Apache-2.0 |

Die Lizenz jeder Datei steht in `REUSE.toml`, die Lizenztexte liegen in `LICENSES/`.

## Mitwirken

Issues und Pull Requests sind willkommen, siehe [CONTRIBUTING.md](CONTRIBUTING.md).
