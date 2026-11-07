# Wallpaper Carousel Redesign Specification

## 1. Overview
Redesign the Zvuk notch wallpaper carousel into a slanted hero-focus carousel matching the user-provided reference design. The carousel displays wallpaper thumbnails framed in slanted parallelogram capsules. Hovering or using the Left/Right direction keys expands the targeted wallpaper into a wide hero showcase, while neighboring wallpapers remain narrower slanted preview cards. Clicking the expanded hero card applies the wallpaper to the Windows desktop.

## 2. Architecture & Components

### 2.1 Notch Sizing (`src/App.tsx`)
- **Width**: `getDynamicWidth()` for `bloomMode === "wallpaper"` increases to `520px` when expanded/hovered, comfortably accommodating the expanded hero card (250px) alongside neighboring preview cards.
- **Height**: `getDynamicHeight()` for `bloomMode === "wallpaper"` adjusts to `175px`, providing sufficient vertical space for the header, 108px cards, and 18px rounded bottom corners.
- **Border Radius**: Retains the standard `18px` bottom corner radius matching other Zvuk sections (`border-radius: 0 0 18px 18px`).

### 2.2 Visual Presentation & Slanted Cards (`WallpaperView.css`)
- **Card Wrapper (`.wallpaper-slanted-card`)**:
  - Parallelogram geometry via `transform: skewX(-9deg)`.
  - Rounded corners via `border-radius: 12px`.
  - `overflow: hidden` and `box-sizing: border-box`.
  - Background styling: subtle translucent glass background `rgba(255, 255, 255, 0.06)` with thin border `1px solid rgba(255, 255, 255, 0.08)`.
  - Inactive/Compressed state: `width: 65px; height: 108px; flex-shrink: 0`.
  - Active/Hero state: `width: 250px; height: 108px; flex-shrink: 0`.
  - Active border highlight: `#0a84ff` or `#30d158` (when applying).
- **Interior Image (`.wallpaper-slanted-thumb img`)**:
  - Counter-skew transform: `transform: skewX(9deg) scale(1.22)` to counteract the card's skew and render the image in its natural proportions without distortion.
  - `object-fit: cover; width: 100%; height: 100%`.
- **Badges**:
  - Active/Current desktop wallpaper badge: positioned on the hero card with a checkmark icon.
  - Applying state: animated pulse/glow confirming application.

### 2.3 Interaction Model (`WallpaperView.tsx`)
- **Hover Expansion**:
  - Pointer entering any card sets it as the active/expanded index (`activeIndex`).
- **Keyboard Navigation**:
  - Global or focused keydown listener for `ArrowLeft` and `ArrowRight`:
    - `ArrowLeft`: decrements `activeIndex` (with wrapping or clamping).
    - `ArrowRight`: increments `activeIndex` (with wrapping or clamping).
    - Automatically scrolls the newly active card into view within the horizontal carousel.
  - `Enter` key: applies the currently focused wallpaper (`handleSetWallpaper(wallpapers[activeIndex])`).
  - `Escape` key: optional close / return to status.
- **Mouse Wheel**:
  - Wheel scrolling over the carousel steps to previous or next wallpaper index.
- **Click to Apply**:
  - Clicking the currently expanded hero card (or clicking any card) sets the wallpaper using Tauri IPC `invoke("set_wallpaper", { path })`.

### 2.4 Header & Controls
- **Folder Pill**:
  - Minimal folder pill on the top left showing `folderDisplayName` ("My Folder" or the current folder's directory name).
  - Clicking opens the native directory picker dialog via `@tauri-apps/plugin-dialog`.
- **Count Badge**:
  - Label: `"N pictures"` directly beside the folder pill matching the reference design.
- **Refresh Action**:
  - Compact icon button on top right to reload wallpapers from the directory.

## 3. Error Handling & Edge Cases
- **No Wallpapers in Folder**: Displays clean empty state with an image icon and message prompting the user to select a folder.
- **Missing Thumbnails**: Shows fallback image placeholder while thumbnail generation runs progressively in the background.
- **Scroll Bounds**: Clamps or loops `activeIndex` safely between `0` and `wallpapers.length - 1`.

