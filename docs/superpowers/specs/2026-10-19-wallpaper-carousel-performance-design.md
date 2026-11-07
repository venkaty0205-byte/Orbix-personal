# Wallpaper Carousel Performance & Scaling Specification

## 1. Overview
Scale the Orbix wallpaper carousel to handle large collections (thousands of wallpapers/pictures) smoothly without UI glitching, memory bloat, or scroll lag. The solution introduces windowed carousel track virtualization (rendering 15–18 cards around the active item), non-recursive direct folder scanning, an 800x450 Retina thumbnail resolution, a persistent disk cache in `%LOCALAPPDATA%\Orbix\wallpaper_cache`, and a windowed priority request queue.

---

## 2. Architecture & Components

### 2.1 Non-Recursive Single-Folder Discovery (`src-tauri/src/wallpaper.rs`)
- **Directory Traversal**:
  - Update `collect_images_from_dir` to only collect image files directly present in the targeted directory (depth 0, non-recursive).
  - Sub-folders (e.g. `Sub folder 1`, `Sub folder 2`) are excluded from the picture list when their parent folder is open.
  - When the user selects a specific sub-folder via the folder picker, only the pictures directly inside that sub-folder are loaded.
- **Supported Formats**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`.

### 2.2 Carousel Track Virtualization (`src/components/wallpaper/WallpaperView.tsx`)
- **Render Buffer (15–18 Cards)**:
  - Calculate a dynamic window around `activeIndex`:
    - `BUFFER_SIZE = 8` (8 cards to the left, active hero card in center, 8 cards to the right = 17 cards total).
    - `startIndex = Math.max(0, activeIndex - BUFFER_SIZE)`.
    - `endIndex = Math.min(wallpapers.length, activeIndex + BUFFER_SIZE + 1)`.
  - Slice visible wallpapers: `const visibleWallpapers = wallpapers.slice(startIndex, endIndex)`.
- **Spacer Offset Positioning**:
  - Compute card layout step: `CARD_STEP = PREVIEW_WIDTH + CARD_GAP` (90px + 12px = 102px).
  - Add a left spacer element with `width: startIndex * CARD_STEP` before the visible cards.
  - Add a right spacer element with `width: (wallpapers.length - endIndex) * CARD_STEP` after the visible cards.
  - Keeps the container's total scroll width exact and invariant, so `container.scrollTo({ left: activeIndex * CARD_STEP, behavior: "smooth" })` functions without layout jitter or pop-in.
  - Prevents mounting hundreds or thousands of transformed `.wallpaper-slanted-card` elements in the DOM.

### 2.3 Thumbnail Pipeline & Disk Caching (`src-tauri/src/wallpaper.rs`)
- **Target Resolution**:
  - Standardize on **800x450** thumbnails. This delivers 2x supersampling over the 250px hero card (Retina/4K sharpness) while consuming ~75% less RAM and encoding time than previous 1600x900 sizes.
- **Persistent Disk Cache**:
  - Storage path: `%LOCALAPPDATA%\Orbix\wallpaper_cache`.
  - File cache key: deterministic hash derived from `(normalized_path, file_size, modified_timestamp)`.
  - File format: JPEG encoded at 85% quality or PNG (if alpha channel present).
  - On request:
    1. Check in-memory map: return cached data URL if present.
    2. Check disk cache: if cached JPEG file exists on disk, read bytes and encode to base64 (<1ms) without decoding the original raw image.
    3. If cache miss: open source image, downscale to 800x450, save to disk cache file, and return base64 string.
- **Original Quality Preservation**:
  - `set_wallpaper` continues to pass the original source image path directly to Windows Win32 APIs (`SystemParametersInfoW` / Registry), ensuring 100% full-resolution desktop wallpaper quality.

### 2.4 Priority Queue & Batched State Updates (`src/components/wallpaper/WallpaperView.tsx`)
- **Windowed Priority Loading**:
  - Eliminate the unbounded `list.forEach` loop that simultaneously invoked thousands of IPC calls.
  - Focus thumbnail requests on the visible window:
    - **Tier 1 (High Priority)**: `activeIndex` and immediate neighbors `[activeIndex - 2, activeIndex + 2]`.
    - **Tier 2 (Prefetch)**: Remaining cards in the rendered slice `[startIndex, endIndex]`.
  - Cancel/ignore pending requests for items that scroll out of the active window during rapid drag or wheel gestures.
- **Batched State Updates**:
  - Buffer newly loaded thumbnails and apply state updates in batches (every ~50ms or per completed window) rather than triggering individual React re-renders per image.

---

## 3. Error Handling & Edge Cases
- **Empty Folder**: Displays clean empty state prompting to choose another folder.
- **Corrupted / Unsupported Images**: Renders a clean icon placeholder without crashing or halting the queue.
- **Rapid Dragging / Wheel Scrolling**: Clamps `activeIndex` within `[0, wallpapers.length - 1]`. The 17-card window ensures smooth scrolling without visual pop-in.
- **Folder Modification**: Refresh button clears memory cache for that folder and re-indexes.

---

## 4. Verification Plan
1. **Frontend Typecheck & Build**: Run `bun run build` to verify strict TypeScript and Vite compilation.
2. **Unit Tests**: Run `bun test` and `cargo test --locked`.
3. **Large Folder Smoke Test**: Open a folder containing 500+ or 1,000+ wallpapers:
   - Verify only images in the direct folder are listed (no sub-folder images).
   - Verify scrolling/dragging from one end to the other is butter-smooth with 17 rendered cards.
   - Verify disk cache creates files in `%LOCALAPPDATA%\Orbix\wallpaper_cache` and subsequent loads are near-instant.

