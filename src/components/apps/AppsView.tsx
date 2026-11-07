import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
	Search,
	X,
	Folder,
	FileText,
	Terminal,
	Calculator,
	Sparkles,
	Laptop,
	Gamepad2,
	Check,
	Clock,
	Calendar as CalendarIcon,
	Star
} from "lucide-react";
import "./AppsView.css";
import { fuzzyMatch } from "./fuzzySearch";

interface AppInfo {
	name: string;
	path: string;
	icon?: string | null;
	is_running?: boolean;
	executable?: string;
}

interface SearchFileItem {
	name: string;
	path: string;
	is_dir: boolean;
	ext?: string | null;
}

type FilterOption = "all" | "apps" | "files" | "snippets";

interface UnifiedItem {
	id: string;
	category: "recent" | "app" | "file" | "folder" | "snippet" | "calc";
	tag: string;
	title: string;
	subtitle?: string;
	path?: string;
	iconType: string;
	iconUrl?: string | null;
	action: () => Promise<void> | void;
	copyValue?: string;
	isPinned?: boolean;
	score?: number;
	matchedIndices?: number[];
}

interface StoredLaunch {
	id: string;
	name: string;
	path: string;
	icon?: string | null;
	type: "app" | "game" | "file" | "snippet" | "web";
	count: number;
	lastUsed: number;
	isPinned?: boolean;
}

interface AppsViewProps {
	onFocusChange?: (focused: boolean) => void;
	onClose?: () => void;
	onSwitchMode?: (mode: string) => void;
}

function isGameApp(name: string, path: string): boolean {
	const text = (name + " " + path).toLowerCase();
	return (
		text.includes("game") ||
		text.includes("steam") ||
		text.includes("epic games") ||
		text.includes("riot") ||
		text.includes("brawlhalla") ||
		text.includes("gta") ||
		text.includes("grand theft auto") ||
		text.includes("garry's mod") ||
		text.includes("minecraft") ||
		text.includes("roblox") ||
		text.includes("valorant") ||
		text.includes("fortnite") ||
		text.includes("ubisoft") ||
		text.includes("origin") ||
		text.includes("battle.net") ||
		text.includes("blizzard") ||
		text.includes("gog galaxy") ||
		text.includes("eternum")
	);
}

export function AppsView({ onFocusChange, onClose }: AppsViewProps = {}) {
	const [query, setQuery] = useState("");
	const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [installedApps, setInstalledApps] = useState<AppInfo[]>(() => {
		try {
			const saved = localStorage.getItem("bloom-cached-apps");
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed) && parsed.length > 0) return parsed;
			}
		} catch {}
		return [];
	});
	const [fileResults, setFileResults] = useState<SearchFileItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [toastMsg, setToastMsg] = useState<string | null>(null);

	// App icons cache loaded dynamically
	const [appIcons, setAppIcons] = useState<Record<string, string>>({});
	const pendingIconsRef = useRef<Set<string>>(new Set());

	// Recent and pinned state from localStorage
	const [recentLaunches, setRecentLaunches] = useState<StoredLaunch[]>(() => {
		try {
			const saved = localStorage.getItem("bloom-recent-launches");
			return saved ? JSON.parse(saved) : [];
		} catch {
			return [];
		}
	});

	const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
		try {
			const saved = localStorage.getItem("bloom-pinned-items");
			return saved ? JSON.parse(saved) : [];
		} catch {
			return [];
		}
	});

	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const toastTimerRef = useRef<any>(null);

	const showToast = useCallback((msg: string) => {
		if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
		setToastMsg(msg);
		toastTimerRef.current = setTimeout(() => {
			setToastMsg(null);
		}, 1800);
	}, []);

	// Load installed apps with retry if empty
	useEffect(() => {
		let isMounted = true;
		let retryCount = 0;
		const loadApps = async () => {
			try {
				const apps = await invoke<AppInfo[]>("get_installed_apps");
				if (isMounted) {
					if (apps && apps.length > 0) {
						setInstalledApps(apps);
						try {
							localStorage.setItem("bloom-cached-apps", JSON.stringify(apps));
						} catch {}
					} else if (retryCount < 5) {
						retryCount++;
						setTimeout(loadApps, 1000);
					}
				}
			} catch (err) {
				console.error("Failed to load apps:", err);
				if (isMounted && retryCount < 5) {
					retryCount++;
					setTimeout(loadApps, 1500);
				}
			}
		};
		void loadApps();
		return () => {
			isMounted = false;
		};
	}, []);

	// Search files and folders with debounce
	useEffect(() => {
		if (activeFilter === "apps" || activeFilter === "snippets") {
			setFileResults([]);
			return;
		}

		let isMounted = true;
		const timer = setTimeout(async () => {
			setIsLoading(true);
			try {
				const files = await invoke<SearchFileItem[]>("search_user_files", {
					query: query.trim()
				});
				if (isMounted) setFileResults(files);
			} catch (err) {
				console.error("Failed to search files:", err);
			} finally {
				if (isMounted) setIsLoading(false);
			}
		}, 200);

		return () => {
			isMounted = false;
			clearTimeout(timer);
		};
	}, [query, activeFilter]);

	// Auto-focus search input
	useEffect(() => {
		const timer = setTimeout(() => {
			inputRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, []);

	// Track launch
	const recordLaunch = useCallback((name: string, path: string, type: "app" | "game" | "file" | "snippet" | "web", icon?: string | null) => {
		setRecentLaunches((prev) => {
			const existingIndex = prev.findIndex((p) => p.path === path || p.name === name);
			let next: StoredLaunch[];
			if (existingIndex >= 0) {
				const existing = prev[existingIndex];
				const updated: StoredLaunch = {
					...existing,
					icon: icon ?? existing.icon,
					count: existing.count + 1,
					lastUsed: Date.now()
				};
				next = [updated, ...prev.filter((_, idx) => idx !== existingIndex)];
			} else {
				const fresh: StoredLaunch = {
					id: `launch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					name,
					path,
					icon,
					type,
					count: 1,
					lastUsed: Date.now()
				};
				next = [fresh, ...prev];
			}
			const trimmed = next.slice(0, 25);
			try {
				localStorage.setItem("bloom-recent-launches", JSON.stringify(trimmed));
			} catch {}
			return trimmed;
		});
	}, []);

	// Toggle pin item
	const togglePin = useCallback((item: UnifiedItem) => {
		setPinnedIds((prev) => {
			const isPinned = prev.includes(item.id);
			const next = isPinned ? prev.filter((id) => id !== item.id) : [...prev, item.id];
			try {
				localStorage.setItem("bloom-pinned-items", JSON.stringify(next));
			} catch {}
			showToast(isPinned ? `Unpinned ${item.title}` : `Pinned ${item.title}`);
			return next;
		});
	}, [showToast]);

	// Math evaluation safely
	const mathResult = useMemo(() => {
		const trimmed = query.trim();
		if (!trimmed || !/[0-9]/.test(trimmed) || !/[+\-*/^%]/.test(trimmed)) return null;
		if (!/^[0-9+\-*/().\s^%]+$/.test(trimmed)) return null;
		try {
			const expr = trimmed.replace(/\^/g, "**");
			// eslint-disable-next-line no-new-func
			const res = Function(`"use strict"; return (${expr})`)();
			if (typeof res === "number" && Number.isFinite(res)) {
				return Number.isInteger(res)
					? res.toString()
					: res.toLocaleString(undefined, { maximumFractionDigits: 6 });
			}
		} catch {
			return null;
		}
		return null;
	}, [query]);

	// Built-in snippets & system tools
	const builtInSnippets = useMemo(() => {
		const now = new Date();
		const dateStr = now.toISOString().slice(0, 10);
		const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		const unixStr = Math.floor(now.getTime() / 1000).toString();

		return [
			{
				id: "snippet-date",
				title: "Today's Date",
				tag: "Snippet",
				copyValue: dateStr,
				iconType: "calendar"
			},
			{
				id: "snippet-time",
				title: "Current Time",
				tag: "Snippet",
				copyValue: timeStr,
				iconType: "clock"
			},
			{
				id: "snippet-uuid",
				title: "Generate UUID",
				tag: "Snippet",
				copyValue: crypto.randomUUID ? crypto.randomUUID() : "uuid-" + Date.now(),
				iconType: "sparkles"
			},
			{
				id: "snippet-unix",
				title: "Unix Timestamp",
				tag: "Snippet",
				copyValue: unixStr,
				iconType: "clock"
			},
			{
				id: "cmd-taskmgr",
				title: "Task Manager",
				tag: "Tool",
				iconType: "terminal",
				launchPath: "taskmgr.exe"
			},
			{
				id: "cmd-powershell",
				title: "PowerShell Terminal",
				tag: "Tool",
				iconType: "terminal",
				launchPath: "powershell.exe"
			},
			{
				id: "cmd-cmd",
				title: "Command Prompt",
				tag: "Tool",
				iconType: "terminal",
				launchPath: "cmd.exe"
			}
		];
	}, []);

	// Categorized lists with full fuzzy search ranking
	const categories = useMemo(() => {
		const q = query.trim();

		// 1. RECENT ITEMS
		let recentItems: UnifiedItem[] = [];
		if (activeFilter === "all" || activeFilter === "apps") {
			if (recentLaunches.length > 0) {
				const scoredRecent = q
					? recentLaunches
							.map((rl) => {
								const res = fuzzyMatch(q, rl.name, rl.path);
								return { rl, res };
							})
							.filter(({ res }) => res.matches)
							.sort((a, b) => b.res.score - a.res.score)
							.slice(0, 5)
					: recentLaunches.slice(0, 5).map((rl) => ({
							rl,
							res: { matches: true, score: 0, matchedIndices: [] }
					  }));

				recentItems = scoredRecent.map(({ rl, res }) => {
					const isPinned = pinnedIds.includes(rl.id);
					const isGame = rl.type === "game" || isGameApp(rl.name, rl.path);
					return {
						id: rl.id,
						category: "recent" as const,
						tag: isGame ? "Game" : rl.type === "file" ? "File" : "Application",
						title: rl.name,
						path: rl.path,
						iconType: isGame ? "game" : rl.type === "file" ? "file" : "app",
						iconUrl: rl.icon,
						isPinned,
						score: res.score,
						matchedIndices: res.matchedIndices,
						action: async () => {
							recordLaunch(rl.name, rl.path, isGame ? "game" : "app", rl.icon);
							try {
								await invoke("open_app", { appName: rl.path });
								onClose?.();
							} catch (e) {
								console.error("Failed to launch app:", e);
							}
						}
					};
				});
			} else if (!q && installedApps.length > 0) {
				// Pre-populate RECENT with top 5 apps
				recentItems = installedApps.slice(0, 5).map((app, idx) => {
					const isGame = isGameApp(app.name, app.path);
					const id = `recent-fallback-${app.name}-${idx}`;
					return {
						id,
						category: "recent" as const,
						tag: isGame ? "Game" : "Application",
						title: app.name,
						path: app.path,
						iconType: isGame ? "game" : "app",
						iconUrl: app.icon,
						isPinned: pinnedIds.includes(id),
						score: 0,
						matchedIndices: [],
						action: async () => {
							recordLaunch(app.name, app.path, isGame ? "game" : "app", app.icon);
							try {
								await invoke("open_app", { appName: app.path });
								onClose?.();
							} catch (e) {
								console.error("Failed to launch app:", e);
							}
						}
					};
				});
			}
		}

		// 2. APPLICATIONS (APPS & GAMES)
		let appItems: UnifiedItem[] = [];
		if (activeFilter === "all" || activeFilter === "apps") {
			const recentPaths = new Set(recentItems.map((r) => r.path).filter(Boolean));
			const scoredApps = q
				? installedApps
						.filter((app) => !recentPaths.has(app.path))
						.map((app) => {
							const res = fuzzyMatch(q, app.name, app.executable || app.path);
							return { app, res };
						})
						.filter(({ res }) => res.matches)
						.sort((a, b) => b.res.score - a.res.score)
						.slice(0, 30)
				: installedApps
						.slice(recentItems.length > 0 ? 5 : 0, 25)
						.map((app) => ({
							app,
							res: { matches: true, score: 0, matchedIndices: [] }
						}));

			appItems = scoredApps.map(({ app, res }, idx) => {
				const isGame = isGameApp(app.name, app.path);
				const id = `app-${app.name}-${idx}`;
				return {
					id,
					category: "app" as const,
					tag: isGame ? "Game" : "Application",
					title: app.name,
					path: app.path,
					iconType: isGame ? "game" : "app",
					iconUrl: app.icon,
					isPinned: pinnedIds.includes(id),
					score: res.score,
					matchedIndices: res.matchedIndices,
					action: async () => {
						recordLaunch(app.name, app.path, isGame ? "game" : "app", app.icon);
						try {
							await invoke("open_app", { appName: app.path });
							onClose?.();
						} catch (e) {
							console.error("Failed to launch app:", e);
						}
					}
				};
			});
		}

		// 3. FOLDERS & 4. FILES (Arranged: First Folders, Second Files!)
		let folderItems: UnifiedItem[] = [];
		let fileItems: UnifiedItem[] = [];
		if (activeFilter === "all" || activeFilter === "files") {
			const scoredFiles = q
				? fileResults
						.map((file) => {
							const res = fuzzyMatch(q, file.name, file.path);
							return { file, res };
						})
						.filter(({ res }) => res.matches)
						.sort((a, b) => b.res.score - a.res.score)
				: fileResults.map((file) => ({
						file,
						res: { matches: true, score: 0, matchedIndices: [] }
				  }));

			scoredFiles.forEach(({ file, res }, idx) => {
				const id = `file-${file.path}-${idx}`;
				if (file.is_dir) {
					folderItems.push({
						id,
						category: "folder" as const,
						tag: "Folder",
						title: file.name,
						subtitle: file.path,
						path: file.path,
						iconType: "folder",
						isPinned: pinnedIds.includes(id),
						score: res.score,
						matchedIndices: res.matchedIndices,
						action: async () => {
							recordLaunch(file.name, file.path, "file");
							try {
								await invoke("open_app", { appName: file.path });
								onClose?.();
							} catch (e) {
								console.error("Failed to open folder:", e);
							}
						}
					});
				} else {
					fileItems.push({
						id,
						category: "file" as const,
						tag: file.ext ? file.ext.toUpperCase() : "File",
						title: file.name,
						subtitle: file.path,
						path: file.path,
						iconType: "file",
						isPinned: pinnedIds.includes(id),
						score: res.score,
						matchedIndices: res.matchedIndices,
						action: async () => {
							recordLaunch(file.name, file.path, "file");
							try {
								await invoke("open_app", { appName: file.path });
								onClose?.();
							} catch (e) {
								console.error("Failed to open file:", e);
							}
						}
					});
				}
			});
		}

		// 5. SNIPPETS & TOOLS
		let snippetItems: UnifiedItem[] = [];
		if (activeFilter === "all" || activeFilter === "snippets") {
			if (mathResult !== null) {
				snippetItems.push({
					id: "calc-result",
					category: "calc",
					tag: "Calculator",
					title: `= ${mathResult}`,
					subtitle: `Expression: ${query.trim()}`,
					iconType: "calc",
					copyValue: mathResult,
					score: 9999, // Calculator results always float to top of snippets
					action: async () => {
						await writeText(mathResult);
						showToast(`Copied result: ${mathResult}`);
						onClose?.();
					}
				});
			}

			const scoredSnippets = q
				? builtInSnippets
						.map((s) => {
							const titleRes = fuzzyMatch(q, s.title);
							const tagRes = fuzzyMatch(q, s.tag, s.launchPath);
							const bestRes = titleRes.score >= tagRes.score ? titleRes : tagRes;
							return { s, res: bestRes };
						})
						.filter(({ res }) => res.matches)
						.sort((a, b) => b.res.score - a.res.score)
						.map(({ s, res }) => ({ ...s, matchedIndices: res.matchedIndices, score: res.score }))
				: builtInSnippets.map((s) => ({ ...s, matchedIndices: [], score: 0 }));

			scoredSnippets.forEach((s) => {
				snippetItems.push({
					id: s.id,
					category: "snippet",
					tag: s.tag,
					title: s.title,
					iconType: s.iconType,
					copyValue: s.copyValue,
					isPinned: pinnedIds.includes(s.id),
					score: s.score,
					matchedIndices: s.matchedIndices,
					action: async () => {
						if (s.copyValue) {
							await writeText(s.copyValue);
							showToast(`Copied ${s.title}: ${s.copyValue}`);
							onClose?.();
						} else if (s.launchPath) {
							try {
								await invoke("open_app", { appName: s.launchPath });
								onClose?.();
							} catch (e) {
								console.error("Failed to launch tool:", e);
							}
						}
					}
				});
			});
		}

		return {
			recent: recentItems,
			applications: appItems,
			folders: folderItems,
			files: fileItems,
			snippets: snippetItems
		};
	}, [
		query,
		activeFilter,
		recentLaunches,
		installedApps,
		fileResults,
		mathResult,
		builtInSnippets,
		pinnedIds,
		recordLaunch,
		showToast,
		onClose
	]);

	// Flatten all sections into an ordered list for keyboard navigation
	const flattenedItems = useMemo(() => {
		const items: UnifiedItem[] = [];
		if (categories.recent.length > 0) items.push(...categories.recent);
		if (categories.applications.length > 0) items.push(...categories.applications);
		if (categories.folders.length > 0) items.push(...categories.folders);
		if (categories.files.length > 0) items.push(...categories.files);
		if (categories.snippets.length > 0) items.push(...categories.snippets);
		return items;
	}, [categories]);

	// Lazy fetch icons for visible apps that lack an icon
	useEffect(() => {
		const needsIcon = flattenedItems
			.filter((it) => (it.category === "app" || it.category === "recent") && !it.iconUrl && it.path)
			.slice(0, 20);

		needsIcon.forEach((item) => {
			const path = item.path!;
			if (pendingIconsRef.current.has(path) || appIcons[path]) return;
			pendingIconsRef.current.add(path);
			invoke<string | null>("get_app_icon", { path, name: item.title })
				.then((icon) => {
					pendingIconsRef.current.delete(path);
					if (icon) {
						setAppIcons((prev) => ({ ...prev, [path]: icon }));
					}
				})
				.catch(() => {
					pendingIconsRef.current.delete(path);
				});
		});
	}, [flattenedItems, appIcons]);

	// Keep selection within bounds on query/filter changes
	useEffect(() => {
		setSelectedIndex(0);
	}, [query, activeFilter]);

	// Auto scroll active item into view
	useEffect(() => {
		if (!listRef.current) return;
		const activeEl = listRef.current.querySelector<HTMLElement>(".apps-item.is-selected");
		if (activeEl) {
			activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	}, [selectedIndex]);

	// Global Escape key handler
	useEffect(() => {
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				inputRef.current?.blur();
				onClose?.();
			}
		};
		window.addEventListener("keydown", handleGlobalKeyDown);
		return () => window.removeEventListener("keydown", handleGlobalKeyDown);
	}, [onClose]);

	// Keyboard controls
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			if (query) {
				setQuery("");
			} else {
				inputRef.current?.blur();
				onClose?.();
			}
			return;
		}

		if (flattenedItems.length === 0) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((prev) => (prev + 1) % flattenedItems.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((prev) => (prev - 1 + flattenedItems.length) % flattenedItems.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const activeItem = flattenedItems[selectedIndex];
			if (activeItem) {
				void activeItem.action();
			}
		}
	};

	const renderItemIcon = (item: UnifiedItem) => {
		if (item.category === "calc") {
			return (
				<div className="apps-item-icon-box calc">
					<Calculator size={15} />
				</div>
			);
		}

		const iconSrc = item.iconUrl || (item.path ? appIcons[item.path] : null);
		if (iconSrc) {
			return (
				<div className="apps-item-icon-box app-img">
					<img src={iconSrc} alt="" />
				</div>
			);
		}

		switch (item.iconType) {
			case "game":
				return (
					<div className="apps-item-icon-box game">
						<Gamepad2 size={15} />
					</div>
				);
			case "folder":
				return (
					<div className="apps-item-icon-box folder">
						<Folder size={15} />
					</div>
				);
			case "file":
				return (
					<div className="apps-item-icon-box file">
						<FileText size={15} />
					</div>
				);
			case "terminal":
				return (
					<div className="apps-item-icon-box terminal">
						<Terminal size={15} />
					</div>
				);
			case "clock":
				return (
					<div className="apps-item-icon-box clock">
						<Clock size={15} />
					</div>
				);
			case "calendar":
				return (
					<div className="apps-item-icon-box calendar">
						<CalendarIcon size={15} />
					</div>
				);
			case "sparkles":
				return (
					<div className="apps-item-icon-box sparkles">
						<Sparkles size={15} />
					</div>
				);
			default:
				return (
					<div className="apps-item-icon-box app">
						<Laptop size={15} />
					</div>
				);
		}
	};

function HighlightedTitle({ title, matchedIndices }: { title: string; matchedIndices?: number[] }) {
	if (!matchedIndices || matchedIndices.length === 0) {
		return <span className="apps-item-title">{title}</span>;
	}
	const matchSet = new Set(matchedIndices);
	return (
		<span className="apps-item-title">
			{title.split("").map((ch, idx) =>
				matchSet.has(idx) ? (
					<span key={idx} className="apps-match-highlight">
						{ch}
					</span>
				) : (
					ch
				)
			)}
		</span>
	);
}

	// Helper to render an item row without onMouseEnter state churn
	const renderItemRow = (item: UnifiedItem) => {
		const isSelected = flattenedItems[selectedIndex]?.id === item.id;
		const isPinned = pinnedIds.includes(item.id);

		return (
			<div
				key={item.id}
				className={`apps-item ${isSelected ? "is-selected" : ""}`}
				onClick={() => {
					const idx = flattenedItems.findIndex((it) => it.id === item.id);
					if (idx >= 0) setSelectedIndex(idx);
					void item.action();
				}}
			>
				{renderItemIcon(item)}
				<div className="apps-item-info">
					<HighlightedTitle title={item.title} matchedIndices={item.matchedIndices} />
					{item.subtitle && <span className="apps-item-subtitle">{item.subtitle}</span>}
				</div>

				{isSelected ? (
					<div className="apps-item-selected-actions">
						<span className="apps-open-badge">↵ Open</span>
						<button
							className={`apps-star-btn ${isPinned ? "pinned" : ""}`}
							title={isPinned ? "Unpin item" : "Pin item to Recent"}
							onClick={(e) => {
								e.stopPropagation();
								togglePin(item);
							}}
						>
							<Star size={13} fill={isPinned ? "#ffd60a" : "none"} strokeWidth={1.8} />
						</button>
					</div>
				) : (
					<span className="apps-item-tag">{item.tag}</span>
				)}
			</div>
		);
	};

	return (
		<motion.div
			className="apps-panel-content"
			onClick={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
			initial={{ opacity: 0, scale: 0.98 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
			transition={{ type: "spring", stiffness: 450, damping: 32 }}
		>
			{/* Toast notification */}
			<AnimatePresence>
				{toastMsg && (
					<motion.div
						className="apps-toast"
						initial={{ opacity: 0, y: -6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
					>
						<Check size={12} strokeWidth={2.5} />
						<span>{toastMsg}</span>
					</motion.div>
				)}
			</AnimatePresence>

			{/* Search Header */}
			<div className="apps-search-header">
				<div className="apps-search-input-wrapper">
					<Search size={14} className="apps-search-icon" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						onFocus={() => onFocusChange?.(true)}
						onBlur={() => onFocusChange?.(false)}
						placeholder="Search apps, files and snippets..."
						className="apps-search-input"
						spellCheck={false}
					/>
					{query ? (
						<div className="apps-search-right-group">
							<button
								className="apps-search-clear-btn"
								onClick={() => {
									setQuery("");
									inputRef.current?.focus();
								}}
								title="Clear search"
							>
								<X size={12} />
							</button>
							<span className="apps-search-shortcut-badge">↵ Open</span>
						</div>
					) : (
						<span className="apps-search-shortcut-badge">Win+A</span>
					)}
				</div>

				{/* Clean Filter Options: All | Apps | Files | Snippets */}
				<div className="apps-category-pills">
					{(["all", "apps", "files", "snippets"] as FilterOption[]).map((tab) => (
						<button
							key={tab}
							className={`apps-filter-pill ${activeFilter === tab ? "active" : ""}`}
							onClick={() => setActiveFilter(tab)}
						>
							{tab.charAt(0).toUpperCase() + tab.slice(1)}
						</button>
					))}
				</div>
			</div>

			{/* Categorized Results List */}
			<div className="apps-results-list" ref={listRef}>
				{flattenedItems.length > 0 ? (
					<>
						{/* RECENT CATEGORY */}
						{categories.recent.length > 0 && (
							<div className="apps-section">
								<div className="apps-section-header">RECENT</div>
								<div className="apps-section-items">
									{categories.recent.map(renderItemRow)}
								</div>
							</div>
						)}

						{/* APPLICATIONS CATEGORY */}
						{categories.applications.length > 0 && (
							<div className="apps-section">
								<div className="apps-section-header">APPLICATIONS</div>
								<div className="apps-section-items">
									{categories.applications.map(renderItemRow)}
								</div>
							</div>
						)}

						{/* 1ST: FOLDERS CATEGORY (First Folders) */}
						{categories.folders.length > 0 && (
							<div className="apps-section">
								<div className="apps-section-header">FOLDERS</div>
								<div className="apps-section-items">
									{categories.folders.map(renderItemRow)}
								</div>
							</div>
						)}

						{/* 2ND: FILES CATEGORY (Second Files) */}
						{categories.files.length > 0 && (
							<div className="apps-section">
								<div className="apps-section-header">FILES</div>
								<div className="apps-section-items">
									{categories.files.map(renderItemRow)}
								</div>
							</div>
						)}

						{/* SNIPPETS & TOOLS CATEGORY */}
						{categories.snippets.length > 0 && (
							<div className="apps-section">
								<div className="apps-section-header">SNIPPETS & TOOLS</div>
								<div className="apps-section-items">
									{categories.snippets.map(renderItemRow)}
								</div>
							</div>
						)}
					</>
				) : (
					<div className="apps-empty-state">
						<Search size={22} className="empty-search-icon" />
						<span className="empty-title">
							{isLoading ? "Searching..." : "No matching apps or files"}
						</span>
						<span className="empty-hint">Try searching for an app name, document, or math</span>
					</div>
				)}
			</div>
		</motion.div>
	);
}

