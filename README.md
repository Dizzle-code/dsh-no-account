# DSH No Account

Ein Bundle-Plugin für **DeepSeek Harness Desktop**, das die native DeepSeek-Account-Oberfläche und den Modell-Provider „DeepSeek Account“ abschaltet, damit DSH ohne DeepSeek-Benutzerkonto genutzt werden kann.

> [!WARNING]
> **Wähle vor der Aktivierung ein anderes Standardmodell aus.**
>
> Dieses Plugin schaltet den Modell-Provider `llm-deepseek-account` („DeepSeek Account“) ab. Ist dein Standardmodell ein Modell dieses Providers (in `~/.dsh/profiles/desktop/cordis.patch.yml` steht dann unter `agent-default-model` die Zeile `provider: deepseek-account`), zeigt das Standardmodell nach der Aktivierung auf einen Provider, den es nicht mehr gibt. Neue Sitzungen haben dann kein nutzbares Modell.
>
> So gehst du vor:
> 1. DSH starten und unter **Einstellungen → Modelle** bzw. in der Modellauswahl ein Modell eines anderen Providers wählen (eigener API-Key, OAuth-Abo aus `dsh-plugin-subscriptions`, lokales Modell, …).
> 2. Prüfen, dass die neue Auswahl gespeichert ist.
> 3. Erst dann dieses Plugin installieren.

## Was abgeschaltet wird

Das Plugin enthält keinen Code. Es besteht nur aus einer Patch-Datei (`cordis.patch.yml`), die drei Zeilen der offiziellen Bundles per `disabled: true` abschaltet:

| Zeilen-ID | Paket | Wirkung |
|---|---|---|
| `ui-settings-account` | `@deepseek-ai/dsh-client-ui-settings-account` | Account-Anzeige unten links, Account-Menü, Profil- und Guthabenseite, Anmeldedialog, Credits-Hinweis, Account-Onboarding. Unten links erscheint stattdessen der normale Einstellungen-Button. |
| `ui-account-notifications` | `@deepseek-ai/dsh-client-ui-account-notifications` | Account-Benachrichtigungen im Account-Menü |
| `llm-deepseek-account` | `@deepseek-ai/dsh-llm-deepseek-account` | Modell-Provider „DeepSeek Account“ |

Jeder Eintrag nennt zusätzlich den Paketnamen. Zeigt eine künftige DSH-Version unter derselben ID auf ein anderes Paket, überspringt der Loader den Eintrag mit einer Warnung, statt die falsche Zeile abzuschalten.

## Was bewusst aktiv bleibt

- **Core-Service `deepseek-account` (`deepseekAccount`).** Die Electron-Shell fragt beim Start `account/getState` ab, und `dsh-client-product-analytics` setzt den Service als Abhängigkeit voraus. Ohne ihn startet DSH Desktop nicht. Dieses Plugin registriert, ersetzt oder entfernt keinen Service. Den Fehler `service "deepseekAccount" has been registered at <DeepSeekAccount>` kann es daher nicht auslösen.
- `credentials`, `authorization`, `product-analytics`, alle anderen Modell-Provider, DSH Custom Mode, DSH Plugin Subscriptions, eigene System-Prompts, die Plugin-Verwaltung und die interne Desktop-Authentifizierung.

## Bekannte Einschränkung

Das **native Willkommensfenster** der Electron-Shell gehört nicht zum Plugin-System und lässt sich mit keinem Plugin abschalten. Es erscheint beim Start, wenn weder ein DeepSeek-Login noch ein API-Key eines Providers hinterlegt ist, zum Beispiel wenn du nur OAuth-Abos oder lokale Modelle nutzt. Klicke dann auf „Überspringen“. DSH merkt sich das nicht, deshalb ist der Klick bei jedem Start nötig.

## Kompatibilität

Geprüft mit **DeepSeek Harness 0.2.2-rc.3 und 0.2.2-rc.5** (Windows). `engines.dsh` erlaubt genau diese beiden Versionen.

Bei jeder anderen DSH-Version überspringt DSH das Bundle beim Start mit der Meldung `skipping profile bundle "dsh-no-account"`. DSH startet dann normal, aber die Account-Oberfläche ist wieder sichtbar. In diesem Fall:

1. Die Prüfung für die neue Version laufen lassen (siehe unten).
2. Ist sie grün, `engines.dsh` in `package.json` um die Version erweitern.

DSH bietet auch eine Ausnahme pro Version an (`dsh plugin --profile desktop allow-version dsh-no-account@<version> --dsh-version <exakt> --accept-risk`). Nutze sie nur, wenn die Prüfung für diese Version erfolgreich war.

## Installation

Voraussetzung: Der Befehl `dsh` ist eingerichtet (DSH Desktop → Menü „Manage dsh Command“).

```powershell
dsh plugin --profile desktop add C:\Pfad\zu\dsh-no-account
```

`dsh plugin` gibt die Argumente an pnpm im Profilordner weiter. DSH trägt das Paket danach selbst in `dsh.profile.bundles` ein. Anschließend DSH neu starten.

## Deinstallation

```powershell
dsh plugin --profile desktop remove dsh-no-account
```

DSH nimmt das Bundle wieder aus `dsh.profile.bundles` heraus und setzt die Konfiguration beim nächsten Start ohne die Patch-Datei zusammen. Alle Account-Funktionen sind dann wieder da.

## Kompatibilität prüfen

Voraussetzung: Node.js 22.18 oder neuer (führt TypeScript direkt aus).

```powershell
npm run check
```

Das Skript startet sich in der DSH-eigenen Laufzeit neu (`DeepSeek Harness.exe` mit `ELECTRON_RUN_AS_NODE=1`) und nutzt den Patch-Parser und Patch-Algorithmus von DSH selbst. Es prüft, dass:

- die Patch-Datei genau die drei Zeilen oben betrifft und nur `disabled` setzt;
- diese Zeilen existieren, den erwarteten Paketnamen tragen und abgeschaltet werden, ohne Loader-Warnungen;
- `deepseek-account`, `credentials`, `authorization` und `product-analytics` aktiv bleiben;
- sich keine andere Zeile ändert;
- die laufende DSH-Version zu `engines.dsh` passt;
- ein echter `dsh --dump-config`-Lauf mit einem Wegwerf-Profil in einem temporären `DSH_HOME` das Bundle annimmt. Dein `~/.dsh` wird dabei nicht verändert.

Weitere Builds prüfst du mit `--target`. Das Ziel ist eine `app.asar`-Datei oder ein entpackter Ordner. Sie wird nur als Daten gelesen, ihr Code wird nicht ausgeführt:

```powershell
npm run check -- --target C:\Pfad\zu\resources\app.asar
```

Ein anderes DSH-Programm wählst du mit `--dsh "C:\…\DeepSeek Harness.exe"` oder über die Umgebungsvariable `DSH_EXE`.

## Lizenz

MIT
