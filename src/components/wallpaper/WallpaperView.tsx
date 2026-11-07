import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { Image, FolderOpen, RotateCw, Check, Sparkles, X } from "lucide-react";
import "./WallpaperView.css";

interface WallpaperItem {
	path: string;
	name: string;
}

interface WallpaperViewProps {
	onClose?: () => void;
}

const PREVIEW_WIDTH = 90;
const CARD_GAP = 12;
const CARD_STEP = PREVIEW_WIDTH + CARD_GAP; // 102px
const WINDOW_SIZE = 17;
const HALF_WINDOW = 8;
const CONCURRENCY = 3;

// In-memory module cache so wallpapers render immediately with no flicker on reopen
const wallpaperThumbnailMemoryCache: Record<string, string | null> = {};

export function WallpaperView({ onClose }: WallpaperViewProps) {
	const [wallpapers, setWallpapers] = useState<WallpaperItem[]>([]);
	const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
		() => ({ ...wallpaperThumbnailMemoryCache })
	);
	const [currentWallpaper, setCurrentWallpaper] = useState<string>("");
	const [activeFolder, setActiveFolder] = useState<string>(() => {
		return localStorage.getItem("bloom-wallpaper-folder") || "";
	});
	const [activeIndex, setActiveIndex] = useState<number>(0);
	const [isApplying, setIsApplying] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const lastWheelTimeRef = useRef<number>(0);
	const loadGenRef = useRef<number>(0);
	const thumbnailsRef = useRef(thumbnails);
	thumbnailsRef.current = thumbnails;

	const loadWallpapers = useCallback(async (folderPath?: string) => {
		setIsLoading(true);
		try {
			const current = await invoke<string>("get_current_wallpaper");
			setCurrentWallpaper(current || "");

			const list = await invoke<WallpaperItem[]>("get_wallpapers", {
				folder: folderPath || undefined
			});
			setWallpapers(list);

			// Find current wallpaper in list to set initial activeIndex
			let initialIdx = 0;
			if (current && list.length > 0) {
				const currentIdx = list.findIndex(
					(item) =>
						current.toLowerCase() === item.path.toLowerCase() ||
						current.toLowerCase().endsWith(item.name.toLowerCase())
				);
				if (currentIdx !== -1) {
					initialIdx = currentIdx;
				}
			}
			setActiveIndex(initialIdx);
		} catch (err) {
			console.error("Failed to load wallpapers:", err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		loadWallpapers(activeFolder);
	}, [activeFolder, loadWallpapers]);

	// Virtualization Window: 17 cards total (activeIndex ± 8)
	let startIndex = 0;
	let endIndex = wallpapers.length;

	if (wallpapers.length > WINDOW_SIZE) {
		startIndex = Math.max(0, activeIndex - HALF_WINDOW);
		endIndex = Math.min(wallpapers.length, startIndex + WINDOW_SIZE);
		if (endIndex - startIndex < WINDOW_SIZE) {
			startIndex = Math.max(0, endIndex - WINDOW_SIZE);
		}
	}

	const leftSpacerWidth = Math.max(0, startIndex * CARD_STEP - CARD_GAP);
	const rightSpacerWidth = Math.max(0, (wallpapers.length - endIndex) * CARD_STEP - CARD_GAP);

	// Priority Windowed Thumbnail Loading
	useEffect(() => {
		if (wallpapers.length === 0) return;

		const currentGen = ++loadGenRef.current;

		// 1. Immediately sync any in-memory cached items for the visible window
		const immediateSync: Record<string, string | null> = {};
		let needsSync = false;
		for (let i = startIndex; i < endIndex; i++) {
			const path = wallpapers[i]?.path;
			if (
				path &&
				wallpaperThumbnailMemoryCache[path] !== undefined &&
				thumbnailsRef.current[path] === undefined
			) {
				immediateSync[path] = wallpaperThumbnailMemoryCache[path];
				needsSync = true;
			}
		}
		if (needsSync) {
			setThumbnails((prev) => ({ ...prev, ...immediateSync }));
		}

		// 2. Order needed items by distance to activeIndex (center/hero first)
		const indicesToLoad: number[] = [];
		for (let i = startIndex; i < endIndex; i++) {
			indicesToLoad.push(i);
		}
		indicesToLoad.sort((a, b) => Math.abs(a - activeIndex) - Math.abs(b - activeIndex));

		const neededPaths = indicesToLoad
			.map((idx) => wallpapers[idx]?.path)
			.filter(
				(path): path is string => !!path && wallpaperThumbnailMemoryCache[path] === undefined
			);

		if (neededPaths.length === 0) return;

		let index = 0;
		const batchToUpdate: Record<string, string | null> = {};
		let timer: ReturnType<typeof setTimeout> | null = null;

		const flushBatch = () => {
			if (loadGenRef.current !== currentGen) return;
			if (Object.keys(batchToUpdate).length > 0) {
				const chunk = { ...batchToUpdate };
				for (const k of Object.keys(batchToUpdate)) {
					delete batchToUpdate[k];
				}
				setThumbnails((prev) => ({ ...prev, ...chunk }));
			}
		};

		const worker = async () => {
			while (index < neededPaths.length) {
				if (loadGenRef.current !== currentGen) return;
				const path = neededPaths[index++];
				if (!path || wallpaperThumbnailMemoryCache[path] !== undefined) continue;

				try {
					const thumb = await invoke<string | null>("wallpaper_thumbnail", { path });
					wallpaperThumbnailMemoryCache[path] = thumb;
					batchToUpdate[path] = thumb;
				} catch {
					wallpaperThumbnailMemoryCache[path] = null;
					batchToUpdate[path] = null;
				}

				if (index === 1) {
					flushBatch();
				} else if (!timer) {
					timer = setTimeout(() => {
						timer = null;
						flushBatch();
					}, 50);
				}
			}
			flushBatch();
		};

		const workerCount = Math.min(CONCURRENCY, neededPaths.length);
		for (let w = 0; w < workerCount; w++) {
			void worker();
		}

		return () => {
			if (timer) clearTimeout(timer);
		};
	}, [wallpapers, activeIndex, startIndex, endIndex]);

	// Keep the active hero card dead-center in the window using mathematical scroll positioning
	useEffect(() => {
		if (wallpapers.length === 0) return;
		const container = scrollRef.current;
		if (container) {
			const targetScroll = activeIndex * CARD_STEP;
			container.scrollTo({
				left: targetScroll,
				behavior: "smooth"
			});
		}
	}, [activeIndex, wallpapers.length]);

	// Keyboard navigation (ArrowLeft, ArrowRight, Enter, Escape)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose?.();
				return;
			}
			if (wallpapers.length === 0) return;
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				setActiveIndex((prev) => (prev > 0 ? prev - 1 : wallpapers.length - 1));
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				setActiveIndex((prev) => (prev < wallpapers.length - 1 ? prev + 1 : 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				const item = wallpapers[activeIndex];
				if (item) void handleSetWallpaper(item);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [wallpapers, activeIndex, onClose]);

	const handlePickFolder = async () => {
		try {
			const selected = await open({
				directory: true,
				multiple: false,
				title: "Select Wallpapers Folder"
			});
			if (selected && typeof selected === "string") {
				setActiveFolder(selected);
				localStorage.setItem("bloom-wallpaper-folder", selected);
				invoke("save_setting", { key: "bloom-wallpaper-folder", value: selected }).catch(
					() => {}
				);
				loadWallpapers(selected);
			}
		} catch (err) {
			console.error("Failed to open folder picker:", err);
		}
	};

	const handleSetWallpaper = async (item: WallpaperItem) => {
		setIsApplying(item.path);
		try {
			await invoke("set_wallpaper", { path: item.path });
			setCurrentWallpaper(item.path);
		} catch (err) {
			console.error("Failed to set wallpaper:", err);
		} finally {
			setTimeout(() => setIsApplying(null), 700);
		}
	};

	// Mouse wheel steps through wallpapers one by one, centering each in the middle
	const handleWheel = (e: React.WheelEvent) => {
		e.stopPropagation();
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(delta) < 15) return;
		const now = Date.now();
		if (now - lastWheelTimeRef.current < 160) return;
		lastWheelTimeRef.current = now;

		if (delta > 0) {
			setActiveIndex((prev) => (prev < wallpapers.length - 1 ? prev + 1 : prev));
		} else {
			setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
		}
	};

	const folderDisplayName = activeFolder
		? activeFolder.split(/[\\/]/).filter(Boolean).pop() || "Folder"
		: "My Folder";

	return (
		<motion.div
			className="wallpaper-panel-content"
			onClick={(e) => e.stopPropagation()}
			onWheel={handleWheel}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
			transition={{ type: "spring", stiffness: 400, damping: 30 }}
		>
			{/* Top Header matching reference image: Mint pill, folder name, picture count */}
			<div className="wallpaper-header">
				<div className="wallpaper-header-left">
					<button
						className="wallpaper-folder-pill"
						onClick={handlePickFolder}
						title={`Choose folder: ${activeFolder || "Default Windows Wallpapers"}`}
					>
						<FolderOpen size={12} strokeWidth={2.4} />
						<span>Pictures</span>
					</button>

					<span className="wallpaper-folder-name" title={activeFolder || "My Folder"}>
						{folderDisplayName}
					</span>

					<span className="wallpaper-count-text">
						{wallpapers.length} {wallpapers.length === 1 ? "picture" : "pictures"}
					</span>
				</div>

				<div className="wallpaper-header-right">
					<button
						className="wallpaper-refresh-btn"
						onClick={() => loadWallpapers(activeFolder)}
						title="Refresh folder"
					>
						<RotateCw size={13} strokeWidth={2.2} className={isLoading ? "animate-spin" : ""} />
					</button>

					{onClose && (
						<button
							className="wallpaper-close-btn"
							onClick={onClose}
							title="Close Wallpaper Carousel (Esc)"
						>
							<X size={13} strokeWidth={2.4} />
						</button>
					)}
				</div>
			</div>

			{/* Main Large Carousel Track */}
			{wallpapers.length === 0 ? (
				<div className="wallpaper-empty-state">
					<Image size={32} strokeWidth={1.5} />
					<span>No image files found in folder</span>
					<button className="wallpaper-empty-btn" onClick={handlePickFolder}>
						Choose Another Folder
					</button>
				</div>
			) : (
				<div className="wallpaper-carousel-track" ref={scrollRef}>
					{startIndex > 0 && (
						<div
							className="wallpaper-spacer-left"
							style={{ width: leftSpacerWidth, flexShrink: 0 }}
							aria-hidden="true"
						/>
					)}

					{wallpapers.slice(startIndex, endIndex).map((item, sliceIdx) => {
						const idx = startIndex + sliceIdx;
						const isHero = idx === activeIndex;
						const isCurrent =
							currentWallpaper &&
							(currentWallpaper.toLowerCase() === item.path.toLowerCase() ||
								currentWallpaper.toLowerCase().endsWith(item.name.toLowerCase()));
						const isItemApplying = isApplying === item.path;
						const thumb = thumbnails[item.path] ?? wallpaperThumbnailMemoryCache[item.path];

						return (
							<div
								key={item.path}
								className={`wallpaper-slanted-card ${isHero ? "is-hero" : "is-preview"} ${
									isCurrent ? "is-current" : ""
								} ${isItemApplying ? "is-applying" : ""}`}
								onClick={() => {
									if (isHero) {
										void handleSetWallpaper(item);
									} else {
										setActiveIndex(idx);
									}
								}}
								title={
									isHero
										? `Click to apply: ${item.name}`
										: `Click or scroll to view: ${item.name}`
								}
							>
								{/* Slanted Image Viewport */}
								<div className="wallpaper-slanted-thumb">
									{thumb ? (
										<img src={thumb} alt={item.name} draggable={false} />
									) : (
										<div className="wallpaper-placeholder">
											<Image size={24} strokeWidth={1.5} />
										</div>
									)}

									{/* Current Desktop Wallpaper Active Checkmark */}
									{isCurrent && (
										<div className="wallpaper-active-badge" title="Active desktop wallpaper">
											<Check size={12} strokeWidth={3} />
										</div>
									)}

									{/* Status Badge when applying */}
									{isItemApplying && (
										<div className="wallpaper-applying-badge">
											<Sparkles size={12} strokeWidth={2.5} />
											<span>Applied</span>
										</div>
									)}
								</div>
							</div>
						);
					})}

					{endIndex < wallpapers.length && (
						<div
							className="wallpaper-spacer-right"
							style={{ width: rightSpacerWidth, flexShrink: 0 }}
							aria-hidden="true"
						/>
					)}
				</div>
			)}
		</motion.div>
	);
}


