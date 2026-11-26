# CLAUDE.md – PokerFriends (Poker-Spielleiter für Texas Hold'em)

Private Web-App von Aladin für Pokerabende mit Freunden (3–9 Personen). Echte Karten und Chips bleiben auf dem Tisch; die App ist nur der **Spielleiter**: wer dran ist, was gesetzt werden darf, Pots und Side-Pots, Chipstände, Blind-Timer und die Abrechnung in CHF. Ein Handy oder Tablet liegt in der Mitte des Tisches.

Live: `https://monkeydsvakidan.github.io/PokerFriends/` – Teil der App **GameMaster** (Startseite und Manifest im Repo `monkeydsvakidan.github.io`, dort steht auch die Anleitung «Neues Spiel einbauen»).

## Warum das Repo öffentlich ist
GitHub Pages (Gratis-Plan) geht nur mit öffentlichen Repos. Vom Nutzer am 26.11.2026 ausdrücklich so entschieden (Ausnahme von «neue Repos privat»). Deshalb: **nie Geheimnisse oder echte Daten ins Repo** – die App braucht keine (kein Server, kein Login, keine Datenbank).

## Tech
- Statisches HTML/CSS/JS ohne Build-Step und ohne Abhängigkeiten. Push auf `main` = live (GitHub Pages, «Deploy from a branch», `main` / root).
- `engine.js`: alle Regeln als reine Funktionen auf einem JSON-Spielstand (Reihenfolge, erlaubte Aktionen, Min-Raise, Pots/Side-Pots, Split, Ausscheiden, Nachkauf, Abrechnung). **Regeln nur hier ändern**, nie in `app.js`.
- `app.js`: Oberfläche. Jede Spielaktion läuft über `run()` auf einer Kopie des Stands (bei Fehler bleibt alles unverändert) und legt einen Rückgängig-Schritt an.
- Speicher: `localStorage` Schlüssel `poker-spielleiter-v1` (`{game, undo, setup, showChf}`). Beim Ändern des Formats `v` im Spielstand erhöhen und alte Stände sauber verwerfen oder umwandeln.
- Beträge: Geld immer in **Rappen** (Ganzzahl), Chips in **Punkten** (Ganzzahl). Anzeige über `chf()` und `pts()` (Schweizer Format 1’000).
- Cache: nach Änderungen `?v=` in `index.html` (CSS und `app.js`) und im Import in `app.js` (`engine.js?v=`) erhöhen.

## Regeln, die bewusst so umgesetzt sind
- Button wandert immer zur nächsten Person mit Chips («moving button», keine Dead-Button-Regel). Heads-up: Dealer = Small Blind, handelt preflop zuerst und postflop zuletzt.
- Ein All-in unter dem Mindest-Raise öffnet die Setzrunde für Leute, die schon gehandelt haben, nicht wieder (nur Call/Fold).
- Bets/Raises müssen durch den kleinsten Chipwert teilbar sein; Split-Pots werden in dieser Einheit geteilt, der Rest geht an die erste Gewinnerin/den ersten Gewinner links vom Dealer.
- Scheiden mehrere in derselben Hand aus, bekommt den schlechteren Platz, wer zu Beginn weniger Chips hatte (bei Gleichstand: Reihenfolge, kein geteilter Platz).
- Color-up-Hinweis nur für Farben, die auch in allen späteren Levels nicht mehr gebraucht werden. Die App rechnet nach einem Color-up nicht selbst um → danach «Chips zählen».
- Fold wird nur angezeigt, wenn etwas offen ist (sonst Check).
- Preisgeld-Verteilung folgt automatisch der Anzahl Personen (`suggestPayout`, auch nach Nachmelden), bis jemand die Prozente von Hand ändert (`payoutAuto`). Preistopf = alle Buy-ins + Rebuys + Nachmeldungen.
- Nachmelden im Turnier (optional, bis Level X): Buy-in zahlen, Startstack bekommen, Sitz frei wählbar.
- Einrichtung: Werte unter den Feldern (`data-live`, Funktion `live()`) werden bei jeder Eingabe neu gerechnet, ohne die Felder neu zu zeichnen.
- Preisgeld auf ganze Franken abgerundet, Rest an Platz 1. Zahlungen: zuerst gleich grosse Beträge direkt, dann grösster Schuldner an grössten Gläubiger (höchstens n−1 Zahlungen).

## Testen
- Spiellogik: `node --test` (oder `npm test`), läuft auch automatisch bei jedem Pull Request (`.github/workflows/test.yml`).
- Oberfläche: Startseiten-Repo und dieses Repo nebeneinander lokal ausliefern, damit `/icon-180.png` und `/manifest.webmanifest` gefunden werden, z. B. Ordner `site/` mit dem Inhalt von `monkeydsvakidan.github.io` und darin `PokerFriends` → dieses Repo, dann `python3 -m http.server` in `site/` und `http://localhost:8000/PokerFriends/` bei 375 px, Querformat (844×390) und 1280 px ansehen. Durchspielen: Turnier mit Raise/Showdown/Split, Rückgängig, Neu laden (Stand bleibt), Cash mit All-in, Nachkauf, neue Person, Abrechnung.

## Regeln für die Arbeit
- Änderungen als Pull Request, nie direkt auf `main`, ein PR pro Thema.
- Es gelten die Skills **webseiten-check** (Teil A Design, Teil C Sicherheit – privates Projekt), **ponytail**, bei Design **unslop** (falls vorhanden).
- Aladin programmiert nicht selbst: Erklärungen einfach, Deutsch (Schweiz, «ss»).
- Namen der Spielenden immer über `esc()` ausgeben.

## Design-Brief
- Zielgruppe: Aladin und Freunde am Pokertisch, Handy oder Tablet liegt in der Mitte, Bedienung mit einer Hand, oft im Halbdunkel.
- Stil «Kartentisch bei Nacht»: nur dunkel, Pot-Fläche in dunklem Filzgrün, sonst neutrale dunkle Grüntöne. Hintergrund: blasses Muster aus Pik/Herz/Karo/Kreuz (`muster.svg`, Deckkraft 6 %, wie das Masken-Muster der Startseite) und ein Hauch Filzgrün oben; Flächen darauf bleiben deckend. Vorbild: die anderen GameMaster-Spiele (gleiche Leiste, Maske oben links) und die Anzeige eines Turnier-Blind-Timers.
- Farben (Tokens oben in `styles.css`): Akzent Mint `#3ddc97` (Hauptaktion, wer dran ist, Poker-Farbe in der GameMaster-Leiste); Bernstein `#ffb347` nur für All-in; Rot `#ff7a7a` nur für Abweichungen/Fehler; Dealer-Button weiss wie echt.
- Schriften wie GameMaster: Barlow (Text), Barlow Condensed (Titel), Bungee (Zahlen und Knöpfe). Icons: Linien-SVGs, Strich 1.75.
- Abstände 4/8/12/16/24/32/48, Radien 8/14. Knöpfe mind. 48 px, Aktionsknöpfe 60 px, unten im Daumenbereich.
