# Control Center Redesign, In-Notch Sub-Views, and Bottom Status Layer Design

## Overview
This specification details the comprehensive redesign of Zvuk Shell's Control Center (`bloomMode === "command-center"`). Inspired by Windows 11 Quick Settings and modern macOS/iOS Control Centers, this upgrade introduces:
1. **Dedicated Bottom Utility / Status Footer Bar**: Positioned below the volume and brightness sliders, housing a live Internet status indicator (Ethernet / Wi-Fi / Offline), a microphone mute toggle, Restart Zvuk Shell action, and Zvuk Settings shortcut.
2. **In-Notch Drill-Down Sub-Views**: Split interaction for Wi-Fi and Bluetooth cards where clicking the icon toggles On/Off, while clicking the `>` chevron smoothly navigates inside the notch to live scanner lists (available Wi-Fi SSIDs and Bluetooth devices) with a `<` back button.
3. **Modernized Quick Actions Grid**: Rounded card tiles supporting Night Light, Airplane Mode, Mobile Hotspot, Focus / DND, Energy Saver, Screen Snip, and Lock Workstation.
4. **Backend Infrastructure**: Tauri Rust commands supporting Windows network status querying, Wi-Fi network scanning and connection, CoreAudio microphone mute control, and workstation actions.

---

## Architecture & Visual Hierarchy

### 1. Visual Layout Hierarchy
```
┌──────────────────────────────────────────────────────────────┐
│  [ Wi-Fi  | > ]   [ Bluetooth | > ]   [ Dock ]   [ Notch ]   │ <- Split Cards & Mode Pills
├──────────────────────────────────────────────────────────────┤
│  [ Night Light ]  [ Airplane ]  [ Hotspot ]  [ DND ]         │ <- Quick Action Toggles Grid
│  [ Battery Saver ][ Snip ]      [ Lock ]     [ Tray ]        │
├──────────────────────────────────────────────────────────────┤
│  🔊 Volume Slider ───────────────●────────  [ Mixer > ]  75% │ <- Dual Sliders
│  ☀️ Brightness Slider ──────────●─────────               60% │
├──────────────────────────────────────────────────────────────┤
│  [ 🔌 Ethernet / 📶 SSID / 🌐 Offline ]  [ 🎙️ Mic Mute ]    │ <- New Bottom Status Footer
│                                           [ 🔄 ]  [ ⚙️ ]     │
└──────────────────────────────────────────────────────────────┘
```

### 2. Notch Dimensions & Transition Behavior
* **Main Controls View (`"main"`)**:
  - Width: `365px`
  - Height: `285px` (smoothly expanded from resting 36px/44px on hover or click).
* **In-Notch Sub-Views (`"wifi"` / `"bluetooth"`)**:
  - Width: `365px`
  - Height: `385px`
  - Animation: Horizontal slide transition (`Framer Motion`) with directional entry (`x: 35 -> 0`) and exit (`x: -35 -> 0`).
* **Unhover / Collapse Safety**:
  - When the cursor leaves the notch or when switching to another mode (e.g. Calendar, Music, Shelf), the sub-view automatically resets to `"main"`.

---

## Detailed Component Specifications

### 1. Bottom Utility & Status Footer Bar
* **Position**: Anchored at the bottom of the Command Center panel, separated by an ultra-thin border (`1px solid rgba(255, 255, 255, 0.08)`) with acrylic glass background (`rgba(255, 255, 255, 0.03)`).
* **Internet Status Pin & Badge**:
  - **Ethernet**: Monitor with plugged cable icon (`lucide:Monitor` or custom Windows-style SVG). Status text: "Ethernet" with emerald green status dot (`#10b981`). Click opens in-notch network settings; right-click opens Windows Network Connections.
  - **Wi-Fi**: Wi-Fi signal icon with current SSID name. Amber/green connected indicator. Click opens the in-notch Wi-Fi sub-view.
  - **Offline / No Internet**: Globe with strike-through slash (`lucide:Globe` with slash). Coral red status dot (`#ef4444`) with text "No internet".
* **Microphone Mute Toggle**:
  - Visual States:
    - **Active (Listening)**: Neutral glass button with white `Mic` icon. Tooltip: "Mute Microphone".
    - **Muted**: Ruby/red tinted accent (`rgba(239, 68, 68, 0.25)`), red border, and `MicOff` icon. Tooltip: "Unmute Microphone".
  - Behavior: Calls Tauri `toggle_microphone_mute`. Reflects live state changes from external mute hotkeys or apps.
* **Shell Controls (Right Anchor)**:
  - **Restart Zvuk Shell Button**: Circular icon button with `RotateCw` icon. Tooltip: "Restart Zvuk Shell". Calls `restart_bloom`.
  - **Zvuk Settings Button**: Gear icon (`Settings`) anchored to the far right, matching Windows 11 Quick Settings layout. Calls `open_settings_window`.

### 2. Split-Action Cards & Quick Controls Grid
* **Split Card Design (Wi-Fi & Bluetooth)**:
  - Container: Rounded rectangle (`border-radius: 10px`) with acrylic background (`rgba(255, 255, 255, 0.06)`).
  - Left Partition (65% width): Main icon + status label. Left-click toggles device radio power On/Off.
  - Vertical Divider: `1px solid rgba(255, 255, 255, 0.12)`.
  - Right Partition (35% width): Centered `>` chevron icon. Clicking switches `activeSubView` to `"wifi"` or `"bluetooth"`.
* **Quick Action Toggles Grid**:
  - **Night Light**: Toggles blue light warmth filter.
  - **Airplane Mode**: Toggles radio airplane mode.
  - **Mobile Hotspot**: Toggles internet sharing hotspot.
  - **Focus / DND**: Toggles Do Not Disturb.
  - **Energy Saver**: Toggles Windows battery saver.
  - **Screen Snip**: Triggers Windows Snip tool (`explorer.exe ms-screenclip:`).
  - **Lock Workstation**: Triggers Windows `LockWorkStation()`.

### 3. In-Notch Sub-Views (Wi-Fi & Bluetooth)
* **Header Structure**:
  - Left: Clean `<` back button (icon only, no text label). Clicking navigates back to `"main"`.
  - Center: Title ("Wi-Fi" or "Bluetooth").
  - Right: Refresh spinning icon + Master On/Off switch toggle.
* **Wi-Fi Networks List**:
  - Displays detected SSIDs sorted by signal strength.
  - Each item displays:
    - Signal strength icon (1 to 4 bars).
    - SSID text (with truncation for long names).
    - Lock icon for password-protected networks.
    - "Connected" badge or "Connect" action button.
    - Inline password expansion prompt when connecting to secured networks.
* **Bluetooth Devices List**:
  - Displays paired and available devices with connection status and connect/disconnect buttons.

---

## Backend Commands & Windows APIs (`src-tauri`)

### 1. Network Status & Scanner Commands
* **`get_internet_status`**:
  - Returns `InternetStatusInfo { connection_type: "ethernet" | "wifi" | "offline", label: String, is_connected: bool }`.
  - Queries Windows Network List Manager (`INetworkListManager`) and IP Helper (`GetAdaptersAddresses`) to distinguish Ethernet adapter connectivity vs. WLAN vs. offline.
* **`get_available_wifi_networks`**:
  - Returns `Vec<WifiNetworkEntry> { ssid: String, signal: u8, is_secure: bool, is_connected: bool }`.
  - Scans via Windows Native WLAN API (`WlanGetAvailableNetworkList`) with fallback parser for `netsh wlan show networks mode=bssid`.
* **`connect_wifi_network(ssid: String, password: Option<String>)`**:
  - Connects to the specified SSID using Windows WLAN profile creation/connection.

### 2. Audio Endpoint Microphone Mute
* **`get_microphone_state`**:
  - Returns `MicrophoneState { is_muted: bool, device_name: String }`.
  - Queries Windows CoreAudio `IMMDeviceEnumerator` -> `eCapture` / `eCommunications` default endpoint -> `IAudioEndpointVolume::GetMute`.
* **`toggle_microphone_mute`**:
  - Toggles `IAudioEndpointVolume::SetMute`.

### 3. Workstation & Quick Utility Commands
* **`toggle_night_light`**: Toggles Windows Blue light filter state.
* **`trigger_screen_snip`**: Launches `ms-screenclip:`.
* **`lock_workstation`**: Calls Windows `user32::LockWorkStation()`.

---

## Verification & Validation Gates
1. **TypeScript Build & Lint**: Run `bun run build` to verify zero type errors, proper interface definitions, and bundle integrity.
2. **Rust Backend Check**: Run `cargo check --locked` and `cargo test --locked` in `src-tauri` to ensure all Windows COM and API wrappers compile cleanly without warnings.
3. **Interactive UI Verification**:
   - Verify hover expansion to 285px in Command Center mode.
   - Verify split interaction: left click toggles Wi-Fi/Bluetooth; right chevron `>` slides to sub-view.
   - Verify `<` back button returns seamlessly to main controls.
   - Verify Internet Status pin accurately detects Ethernet vs. Wi-Fi vs. Offline.
   - Verify Mic Mute button reflects mute state and toggles Windows mic input.
   - Verify Settings and Restart buttons function as expected.

