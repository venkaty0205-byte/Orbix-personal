# Orbix Personal

A personal Windows notch and floating dock based on [Orbix by Lukog10](https://github.com/Lukog10/Orbix). This fork is licensed under GPL-3.0; see [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).

## Personal changes

- Volume and brightness edge controls close quickly after the cursor leaves.
- The notch status chip shows the date and month instead of weather.
- The expanded notch stays open until a desktop click outside it, with a smoother fade.
- The Tasks & reminders panel no longer closes or changes mode just because the pointer leaves.
- Scheduled tasks open an alarm popup and loop a custom four-note bell until dismissed. Dismiss keeps the task; snooze lets you choose a delay each time.
- A clipboard panel stores up to 40 recent text items locally, so they remain available after restart. Capture can be paused and history cleared.
- The Apps/search launcher window has been removed.
- Teal is the default accent color.

## Get a Windows build

GitHub Actions builds the Windows installers when code is pushed to `main`, and can also be started manually from **Actions → Windows app build → Run workflow**. Open the completed run and download the **Orbix-Personal-Windows** artifact. It contains the `.exe` and `.msi` installers and is retained for 14 days.

## Build locally

Requirements: Windows 10/11 x64, [Bun](https://bun.sh/docs/installation) 1.4+, Rust stable via [rustup](https://rust-lang.org/tools/install/), and Visual Studio C++ Build Tools.

```powershell
bun install --frozen-lockfile
bun run tauri build
```

Installers are created under `src-tauri/target/release/bundle/`.

## Notes

Orbix uses Windows shell and audio APIs. Its dock may hide the native Windows taskbar while running. Review the source before installing software, and keep a way to restore the taskbar available.


