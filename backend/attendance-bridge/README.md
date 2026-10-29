# Attendance connector

A small program that runs **inside the office network**. It reads the eSSL / ZKTeco attendance device and sends new
punches to the HR Access Hub. It only reads the device; it never clears or changes it. The device's address is private
(`192.168.1.58`), so the website itself can't reach it, and that is why this program is needed.

## Set up (on an office computer that stays on, on the same network as the device)
1. Install Node.js (version 20 or newer) from nodejs.org.
2. Copy this folder to the computer, open a terminal in it and run `npm install`.
3. Copy `.env.example` to `.env` and fill it in:
   - `DEVICE_IP` and `DEVICE_PORT`: as in Keka's Biometric Device Manager (`192.168.1.58`, `4370`).
   - `APP_URL`: `https://hr.wohlig.com`.
   - `DEVICE_KEY`: the same secret as `ATTENDANCE_DEVICE_KEY` in the server's `.env`. Get it securely; don't email it.
4. Check the device connection: `npm run test-device`. It prints how many punches the device holds and the latest five.
   The device usually accepts **one connection at a time**. If it says it can't connect, close Keka's Biometric Device Manager and try again.
5. Run it: `npm start`. It reads the device every 5 minutes. The first time, it sends only the last 7 days (or from `SYNC_FROM`).
6. Keep it running: use Windows **Task Scheduler** ("run at startup") or a service tool such as NSSM or `pm2`, with the command `node bridge.mjs` in this folder.

## On the Keka desktop computer (Windows)
The computer that runs Keka's *Biometric Device Manager* is already on the office network next to the device, so it is the natural place for this program too.
1. Install Node.js (LTS) from nodejs.org on that computer.
2. Copy this whole folder onto it, and copy `.env.example` to `.env` and fill it in (see above).
3. Double-click **`run.bat`** with `--test` first: open a Command Prompt in the folder and run `run.bat --test`. It should say how many punches the device holds.
4. Double-click **`run.bat`** to start the connector. Double-click **`start-with-windows.bat`** once, so it starts by itself after a restart.
5. **Keka and this program both talk to the same device.** These devices usually accept one connection at a time. This program connects for a few seconds every 5 minutes and then lets go, so it normally shares the device fine. If Keka's manager shows "Not Connected" or this program says it cannot connect, pause Keka's sync while you run the first import, then start both.
6. Do not stop Keka's sync: it keeps feeding Keka, and this program feeds the HR Access Hub.

## In the app (HR)
Open **Attendance** and find the **Office device** card. Each person has a user ID on the device; link each ID to a person
there. Punches from IDs that aren't linked yet are held and added the moment you link them. A device ID that equals an
employee number (for example `17` for WT/17) is suggested for you.

## Good to know
- The device may not say IN or OUT. The app alternates through each day: first punch IN, next OUT, and so on. A second scan within a minute is ignored.
- Times are the device's own clock. Check that the device's date and time are right.
- Progress is kept in `bridge-state.json`, so a restart never re-sends old punches (and the app ignores repeats anyway).
- To try the app side without the device: `node bridge.mjs --from-file sample.json --once` with a file like `[{"userId":"17","time":"2026-10-27 09:05:00"}]`.
