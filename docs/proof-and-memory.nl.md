# Bewijsdossiers, bewakers en geheugen

Drie kleine toevoegingen die de bevindingen van een agent eerlijk houden. Alle drie draaien lokaal, hebben geen extra
installatie nodig en zitten niet in de weg als je ze niet gebruikt.

_English: [proof-and-memory.md](proof-and-memory.md)_

## Bewijsdossiers (`re_case`)

Een bewijsdossier is een logboek voor één onderzoek, build-inspectie of port. Het staat in de werkmap
(`~/.reverseport/cases/<caseId>/`) en bevat:

| Onderdeel  | Wat het is                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Evidence   | Een bewaarde kopie van een bestand of tool-resultaat, met de SHA-256, de precieze herkomst en een notitie                    |
| Claim      | Een bewering die bewijs-id's noemt; een `observed` claim noemt ook een andere verklaring en een check die hem kan weerleggen |
| Unknown    | Een open vraag; die houdt de oplevering tegen tot een claim hem beantwoordt of hij als beperking wordt meegenomen            |
| Decision   | De gekozen route, de afgewezen opties, waarom, en wanneer je er opnieuw naar kijkt                                           |
| Test       | Een bewaard log van een echte run, met de exitcode                                                                           |
| Limitation | Een open risico dat in het eindantwoord moet staan                                                                           |

De fases gaan één stap tegelijk: investigate → decide → build → verify → deliver. Elke stap heeft een poort: bewijs
voordat je beslist, een beslissing voordat je bouwt, een testlog voordat je verifieert, en beperkingen, geen open
vragen en een rapport voordat je oplevert. `check` controleert op elk moment de hashes, verwijzingen en poorten;
`report` schrijft `REPORT.md`.

```bash
reverseport case init --question "Which engine made this build?" --target ./Build --authorized
reverseport case evidence <caseId> --file ./Build/Game.pck --locator "Build/Game.pck" --note "pack header"
reverseport case claim <caseId> --statement "Godot 4.3 pack" --evidence '["E001"]' --confidence observed \
  --locator "offset 0: GDPC v2, 4.3.0" --alternative "Repacked by a mod tool" --falsifier "Check the .exe version string"
reverseport case check <caseId>
reverseport case report <caseId>
```

Een hash bewijst dat een bewaard bestand niet is veranderd. Hij bewijst niet dat de bron echt was, dat een claim klopt,
dat de gebruiker toestemming gaf of dat een test echt heeft gedraaid. Het rapport zegt dat er ook bij.

Het logboek is een Node-versie van `proof.py` uit [Digfox](https://github.com/Devaretanmay/digfox) (MIT, Digfox
contributors), aangepast aan ReversePort: dossiers staan in de werkmap, tool-resultaten kun je direct bewaren, en elk
antwoord noemt de volgende stap. Open vragen werken zoals de unknowns van REA.

## Bewakers (hooks in de Claude Code-plugin)

De plugin levert `hooks/hooks.json` mee, met vier vaste hooks rond de tools van ReversePort:

| Wanneer       | Wat het doet                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start sessie  | Een notitie van twee regels: houd een bewijsdossier bij, zeg "onbekend" in plaats van te gokken                                                                                                                  |
| Voor een tool | Weigert een CDP/Inspector-adres op een andere machine; vraagt eerst voordat een tool een programma start, eraan koppelt of het bestuurt; vraagt eerst als een argument op een wachtwoord, token of sleutel lijkt |
| Na een tool   | Schrijft een klein regeltje (tool, hash van de invoer, ok/fout, caseId) naar `~/.reverseport/sessions/<session>.jsonl`                                                                                           |
| Stop          | Eén keer per stop: houdt "klaar" tegen zolang een dossier uit deze sessie zijn check niet haalt                                                                                                                  |

Er wordt geen model en geen netwerk aangeroepen. `REVERSEPORT_HOOKS=off` zet ze uit; `REVERSEPORT_HOOKS=shadow` logt
alleen. De vier hookpunten en de lijst met runtime-tools komen uit [rea-jev](https://github.com/juan-viox/rea-jev) (MIT,
Juan Alvarado). Het System One-model daarvan (Jev) zit er niet in: dat is een betaalde dienst op afstand, en ReversePort
blijft lokaal.

## Geheugen tussen sessies (Stashpad, optioneel)

[Stashpad](https://github.com/laaielichter/stashpad) bewaart het geheugen van een agent als leesbare Markdown-bestanden,
met een bron, data en een betrouwbaarheidsniveau. Wat een agent schrijft, wacht in een controlelijst tot een mens het
goedkeurt. Als Stashpad is geïnstalleerd:

- `re_case init` geeft `recalled` terug: actuele herinneringen die bij de vraag en het doel passen, gemarkeerd als
  bewaarde gegevens, niet als instructies.
- `re_case remember` zet de beslissingen, `observed` claims en beperkingen van het dossier in de controlelijst van
  Stashpad (brontype `agent`). Wat al eerder is voorgesteld, wordt overgeslagen. Een mens keurt ze goed met
  `stashpad review` en `stashpad accept <id>`.
- `remember` laat ook een overdracht achter in Stashpad (de volgende sessie leest die één keer) met waar het dossier
  staat: fase, open vragen, de laatste beslissing en de volgende stap. `re_case init` toont open overdrachten zonder ze
  te pakken; de sessie die het werk overneemt, claimt er een met `stashpad handoff claim`. Overdrachten hebben een
  Stashpad-versie met `stashpad handoff` nodig; oudere versies slaan deze stap over en zeggen dat.

ReversePort vindt Stashpad via `STASHPAD_BIN` (pad naar `bin/stashpad.mjs` of een uitvoerbaar bestand), anders via
`stashpad` op het `PATH`. Stashpad bewaart zijn gegevens waar het dat altijd doet (`STASHPAD_DIR`, anders
`./.stashpad/memories`). `REVERSEPORT_STASHPAD=off` zet de koppeling uit. Zonder Stashpad verandert er niets.

## Hoeveel context het kost

Gemeten op de tooldefinities die ReversePort zelf toont (JSON met naam, titel, beschrijving en invoerschema; tokens
geschat als tekens ÷ 4, dus bij benadering). De tools van de diepe-analyse-engine komen daar nog bij en hangen af van
de engineversie.

| Profiel                  | Tools van ReversePort         | Tekens | Ongeveer tokens |
| ------------------------ | ----------------------------- | ------ | --------------- |
| `compact`                | 8, beschrijving van één regel | 6.675  | 1.700           |
| `standard` / `full`      | 23, volledige beschrijvingen  | 27.569 | 6.900           |
| waarvan `re_case` alleen | 1                             | 4.875  | 1.200           |

`re_case` zit niet in het `compact`-profiel; kleine modellen bereiken het via de CLI of door van profiel te wisselen.
