# Lyft Driver Tools

Four small tools to help you decide rides faster and learn from your history.
**None of them automate accepting rides.** Acceptance always stays in your hands.

## 1. `calculator.html` — Per-ride profitability

Single HTML file. Open it on your phone or laptop, type in pay, time, pickup
distance, and trip distance, and it tells you `GO`, `MAYBE`, or `SKIP` with
$/hour, $/mile, and net pay (after fuel) on screen.

Settings (MPG, gas price, target $/hr, min $/mi) save on the device.

**To use on your phone:** open the file in Chrome/Safari and "Add to Home
Screen" — it works offline as a one-tap shortcut.

## 2. `dashboard.html` — Trip-history dashboard

Single HTML file. Drop the CSV you downloaded from
**Lyft Driver → Earnings → Driving History** and it shows:

- KPIs: $/hr, $/mile, $/trip, total earned, hours online
- Earnings by hour-of-day and day-of-week
- $/hr curve across the day
- Top 10 best (day, hour) slots ranked by $/hr

All processing is local in your browser. The CSV never leaves your machine.

If your Lyft export has different column names, the tool will ask you to map
them once.

## 3. `notifier-android/` — Smart audible alert

A minimal Android app that uses **AccessibilityService** to read the ride card
when Lyft pops it on screen, then plays a custom sound (or stays silent) based
on rules you write — for example, "loud chime if pay/min > $0.50" or "ignore
anything below $5".

**You still tap accept yourself.** The app never simulates touches and never
talks to Lyft's servers.

### Real talk before you build it

- Lyft's terms forbid third-party apps that interact with the driver app.
  An audible alert based on on-screen text is a gray area: it's read-only and
  user-initiated, but Lyft can still flag it. Use at your own risk.
- The AccessibilityService permission is powerful. **Only enable it for this
  app** and review the source before installing.
- The OCR is fragile — every Lyft UI update can break it. You will need to
  tweak the regexes when the layout changes.

### Build & install

You need [Android Studio](https://developer.android.com/studio) and a phone
with **Developer Options + USB debugging** turned on.

```bash
cd notifier-android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

After install:

1. Open the app, tap "Open Accessibility settings".
2. Find "Lyft Watcher" in the list and turn it on.
3. Edit `rules.json` (in the app's files dir) or use the in-app editor to
   set your thresholds.
4. Open Lyft, go online, and the app will play sounds when ride cards match.

### How the rules work

`rules.json` is a list of `{ match, sound }` rules evaluated top-to-bottom.
First match wins.

```json
[
  { "minPay": 8.00, "maxPickupMin": 5,  "sound": "loud_chime" },
  { "minPay": 5.00, "sound": "soft_ping" },
  { "sound": "silent" }
]
```

The service exposes the parsed numbers from the on-screen card to the rules
engine: `pay`, `pickupMin`, `tripMin`, `pickupMi`, `tripMi`. Any field the
service couldn't parse is `null`, and rules that depend on a `null` field
are skipped.

## 4. `notifier-ios/` — Same idea, for iPhone

iOS port using **ReplayKit Broadcast Upload Extension** + **Vision framework**
for OCR. Reads the Lyft Driver ride card from the screen and fires a
time-sensitive notification with **PEGA / TALVEZ / RECUSA** plus the reason.

Requires a Mac, Xcode 15+, and an iPhone running iOS 16+. **Free Apple ID is
fine** — no $99/year developer account needed (with the catch that the app
needs re-signing every 7 days, which AltStore can automate).

Same disclaimers as the Android version: it reads your own screen, never
talks to Lyft's servers, and acceptance is always yours.

See `notifier-ios/README.md` for full setup steps.
