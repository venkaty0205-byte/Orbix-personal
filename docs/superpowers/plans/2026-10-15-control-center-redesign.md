# Implementation Plan: Control Center Redesign, In-Notch Sub-Views & Bottom Status Layer

## Proposed Changes

### Phase 1: Tauri Backend APIs (`src-tauri`)
- Add `get_internet_status` command in `src-tauri/src/commands.rs` returning `{ connection_type: "ethernet" | "wifi" | "offline", label: String, is_connected: bool }`.
- Add `get_available_wifi_networks` and `connect_wifi_network` in `src-tauri/src/services.rs` and `commands.rs`.
- Add `get_microphone_state` and `toggle_microphone_mute` using Windows CoreAudio `IAudioEndpointVolume` on `eCapture` default device.
- Add workstation quick commands: `trigger_screen_snip` and `lock_workstation`.
- Register all new commands in `src-tauri/src/lib.rs` / `main.rs`.
- Verify with `cargo check --locked`.

### Phase 2: Frontend Components (`src/components/controls/`)
- Create `src/components/controls/types.ts`:
  - `InternetStatusInfo`, `WifiNetworkEntry`, `MicrophoneState`, `SubViewMode`.
- Create `src/components/controls/ControlsView.tsx`:
  - Coordinates state: `activeSubView: "main" | "wifi" | "bluetooth"`.
  - Animates between main controls and sub-views.
- Create `src/components/controls/ControlsFooter.tsx`:
  - Renders internet status pin (Ethernet / Wi-Fi / Offline), Mic mute toggle with live feedback, Restart button, and Settings button.
- Create `src/components/controls/SplitPillCard.tsx`:
  - Split button for Wi-Fi and Bluetooth: left side toggles On/Off, right side `>` chevron opens in-notch sub-view.
- Create `src/components/controls/WifiSubView.tsx`:
  - In-notch scanner with `<` back button, network list, signal bars, lock icons, and connect input.
- Create `src/components/controls/BluetoothSubView.tsx`:
  - In-notch device list with `<` back button and connect/disconnect buttons.
- Create `src/components/controls/ControlsView.css`:
  - Windows 11 style rounded glass cards, acrylic footer, divider lines, and smooth transitions.
- Integrate into `src/App.tsx`:
  - Replace inline `command-center-content-minimal` with `<ControlsView ... />`.
  - Adjust dynamic height: 285px for main, 385px for sub-views.
  - Reset sub-view on notch collapse or mode change.

### Phase 3: Verification & Build
- Verify TypeScript with `bun run build`.
- Verify Rust with `cargo check --locked`.
- Git commit changes.

---

## Task List
- [ ] Task 1: Implement Tauri backend commands (Internet status, Wi-Fi scanner, Mic mute, Workstation actions) in `src-tauri`
- [ ] Task 2: Verify `cargo check --locked`
- [ ] Task 3: Create frontend control components (`src/components/controls/*`)
- [ ] Task 4: Integrate `ControlsView` into `src/App.tsx` and update dynamic notch sizing
- [ ] Task 5: Run `bun run build` and interactive verification
- [ ] Task 6: Commit and push changes

