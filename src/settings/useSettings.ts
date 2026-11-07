import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import type { UpdateCheckResult } from "../updater";
import { useSettingsSync } from "../hooks/useSettingsSync";
import { reloadIfMirrorWasStale } from "../hooks/settingsMirror";
import { hexToHsl } from "../theme";
import {
	addCustomFolder,
	removeCustomFolder,
	toggleEnabledFolder,
	DEFAULT_ENABLED_FOLDERS
} from "../dockExtras";
import type { WidgetConfig } from "./types";

const saveDebounceTimers = new Map<string, any>();

function saveSetting(key: string, value: string) {
	if (saveDebounceTimers.has(key)) {
		clearTimeout(saveDebounceTimers.get(key));
		saveDebounceTimers.delete(key);
	}
	localStorage.setItem(key, value);
	invoke("save_setting", { key, value }).catch(console.error);
}

function saveSettingDebounced(key: string, value: string, delay = 120) {
	localStorage.setItem(key, value);
	if (saveDebounceTimers.has(key)) {
		clearTimeout(saveDebounceTimers.get(key));
	}
	saveDebounceTimers.set(
		key,
		setTimeout(() => {
			saveDebounceTimers.delete(key);
			invoke("save_setting", { key, value }).catch(console.error);
		}, delay)
	);
}

function readBool(val: string | null): boolean {
	return val === "true";
}

export function useSettings() {
	const [autostart, setAutostart] = useState(false);
	const [weatherEnabled, setWeatherEnabled] = useState(false);
	const [calendarEnabled, setCalendarEnabled] = useState(true);
	const [powerModeEnabled, setPowerModeEnabled] = useState(true);
	const [wallpaperModeEnabled, setWallpaperModeEnabled] = useState(true);
	const [timerSoundEnabled, setTimerSoundEnabled] = useState(
		() => localStorage.getItem("bloom-timer-sound-enabled") !== "false"
	);
	const [musicModeEnabled, setMusicModeEnabled] = useState(true);
	const [musicCompactNotch, setMusicCompactNotch] = useState(true);
	const [shelfPersist, setShelfPersist] = useState(
		() => localStorage.getItem("bloom-shelf-persist") === "true"
	);
	const [notchControlSavings, setNotchControlSavings] = useState(
		() => localStorage.getItem("bloom-notch-control-savings") !== "false"
	);
	const [notchControlDnd, setNotchControlDnd] = useState(
		() => localStorage.getItem("bloom-notch-control-dnd") !== "false"
	);
	const [notchControlAirplane, setNotchControlAirplane] = useState(
		() => localStorage.getItem("bloom-notch-control-airplane") !== "false"
	);
	const [notchControlHotspot, setNotchControlHotspot] = useState(
		() => localStorage.getItem("bloom-notch-control-hotspot") !== "false"
	);
	const [notchControlEthernet, setNotchControlEthernet] = useState(
		() => localStorage.getItem("bloom-notch-control-ethernet") !== "false"
	);
	const [notchAudioIndicator, setNotchAudioIndicator] = useState(
		() => localStorage.getItem("bloom-notch-audio-indicator") !== "false"
	);
	const [volumeOverlayEnabled, setVolumeOverlayEnabled] = useState(true);
	const [volumeEdgeEnabled, setVolumeEdgeEnabled] = useState(
		() => localStorage.getItem("bloom-volume-edge-enabled") !== "false"
	);
	const [brightnessOverlayEnabled, setBrightnessOverlayEnabled] = useState(
		() => localStorage.getItem("bloom-brightness-overlay-enabled") !== "false"
	);
	const [brightnessEdgeEnabled, setBrightnessEdgeEnabled] = useState(
		() => localStorage.getItem("bloom-brightness-edge-enabled") !== "false"
	);
	const [mediaAmbienceEnabled, setMediaAmbienceEnabled] = useState(true);
	const [mediaCompactGlowEnabled, setMediaCompactGlowEnabled] = useState(true);
	const [mediaLayout, setMediaLayout] = useState<"classic" | "compact">(
		() => (localStorage.getItem("bloom-media-layout") as "classic" | "compact") || "classic"
	);
	const [cornersEnabled, setCornersEnabled] = useState(
		() => localStorage.getItem("bloom-corners-enabled") === "true"
	);
	const [showUpdateIndicator, setShowUpdateIndicator] = useState(
		() => localStorage.getItem("bloom-show-update-indicator") !== "false"
	);
	const [timeFormat24h, setTimeFormat24h] = useState(
		() => localStorage.getItem("bloom-time-format-24h") === "true"
	);
	const [tempUnitFahrenheit, setTempUnitFahrenheit] = useState(false);
	const [cityName, setCityName] = useState("");
	const [citySearchResults, setCitySearchResults] = useState<
		Array<{ name: string; country: string; latitude: number; longitude: number }>
	>([]);
	const [showCityDropdown, setShowCityDropdown] = useState(false);
	const [statusWidgets, setStatusWidgets] = useState<WidgetConfig>({
		left: ["weather"],
		right: ["battery"]
	});
	const [dockEnabled, setDockEnabled] = useState(true);
	const [dockPreviewEnabled, setDockPreviewEnabled] = useState(true);
	const [dockIconOnly, setDockIconOnly] = useState(
		() => localStorage.getItem("bloom-dock-icon-only") === "true"
	);
	const [dockSeparatorEnabled, setDockSeparatorEnabled] = useState(
		() => localStorage.getItem("bloom-dock-separator-enabled") !== "false"
	);
	const [startIcon, setStartIcon] = useState(
		() => localStorage.getItem("bloom-start-icon") || "default"
	);
	const [dockAdaptive, setDockAdaptive] = useState(
		() => localStorage.getItem("bloom-dock-adaptive") === "true"
	);
	const [dockWinNumberEnabled, setDockWinNumberEnabled] = useState(
		() => localStorage.getItem("bloom-dock-win-number-enabled") !== "false"
	);
	const [dockExtrasPosition, setDockExtrasPosition] = useState(
		() => localStorage.getItem("bloom-dock-extras-position") || "off"
	);
	const [dockExtrasDrives, setDockExtrasDrives] = useState(
		() => localStorage.getItem("bloom-dock-extras-drives") !== "false"
	);
	const [dockExtrasRecycleBin, setDockExtrasRecycleBin] = useState(
		() => localStorage.getItem("bloom-dock-extras-recycle-bin") !== "false"
	);
	const [dockExtrasFolders, setDockExtrasFolders] = useState(
		() => localStorage.getItem("bloom-dock-extras-folders") ?? DEFAULT_ENABLED_FOLDERS
	);
	const [dockExtrasCustomFolders, setDockExtrasCustomFolders] = useState(
		() => localStorage.getItem("bloom-dock-extras-custom-folders") || "[]"
	);
	const [dockMode, setDockMode] = useState(() => {
		// "smart" is the fresh-install default — keep in step with App.tsx,
		// Dock.tsx, and the backend fallback in commands.rs.
		const raw = localStorage.getItem("bloom-dock-mode") || "smart";
		return raw === "auto-hide" ? "smart" : raw;
	});
	const [notchMode, setNotchMode] = useState("fixed");
	const [notchEdgeDelay, setNotchEdgeDelay] = useState(() => {
		const val = localStorage.getItem("bloom-notch-edge-delay");
		return val !== null ? parseInt(val) : 600;
	});
	const [lowBatteryThreshold, setLowBatteryThreshold] = useState(20);
	const [updateStatus, setUpdateStatus] = useState<
		"idle" | "checking" | "available" | "uptodate" | "error" | "downloading" | "installing"
	>("idle");
	const [updateVersion, setUpdateVersion] = useState("");
	const [appVersion, setAppVersion] = useState("");
	const [autoUpdate, setAutoUpdate] = useState(
		() => localStorage.getItem("bloom-auto-update") === "true"
	);
	const [scale, setScale] = useState(() =>
		parseFloat(localStorage.getItem("bloom-scale") || "1.0")
	);
	const [notchScale, setNotchScale] = useState(() => {
		const val = localStorage.getItem("bloom-notch-scale");
		if (val !== null) return parseFloat(val);
		return parseFloat(localStorage.getItem("bloom-scale") || "1.0");
	});
	const [dockScale, setDockScale] = useState(() => {
		const val = localStorage.getItem("bloom-dock-scale");
		if (val !== null) return parseFloat(val);
		return parseFloat(localStorage.getItem("bloom-scale") || "1.0");
	});
	const [themeMode, setThemeMode] = useState(
		() => localStorage.getItem("bloom-theme-mode") || "dark"
	);
	const [themeColor, setThemeColor] = useState(
		() => localStorage.getItem("bloom-theme-color") || "#35D0C8"
	);
	const [themeOpacity, setThemeOpacity] = useState(() => {
		const val = localStorage.getItem("bloom-theme-opacity");
		return val !== null ? parseFloat(val) : 0.8;
	});
	const [notchOpacity, setNotchOpacity] = useState(() => {
		const val = localStorage.getItem("bloom-notch-opacity");
		if (val !== null) return parseFloat(val);
		const globalVal = localStorage.getItem("bloom-theme-opacity");
		return globalVal !== null ? parseFloat(globalVal) : 0.8;
	});
	const [dockOpacity, setDockOpacity] = useState(() => {
		const val = localStorage.getItem("bloom-dock-opacity");
		if (val !== null) return parseFloat(val);
		const globalVal = localStorage.getItem("bloom-theme-opacity");
		return globalVal !== null ? parseFloat(globalVal) : 0.8;
	});
	const [themeSaturation, setThemeSaturation] = useState(() => {
		const val = localStorage.getItem("bloom-theme-saturation");
		return val !== null ? parseFloat(val) : 0.5;
	});
	const [themeBrightness, setThemeBrightness] = useState(() => {
		const val = localStorage.getItem("bloom-theme-brightness");
		return val !== null ? parseFloat(val) : 0.15;
	});
	const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "success" | "error">(
		"idle"
	);
	const [importStatus, setImportStatus] = useState<"idle" | "importing" | "success" | "error">(
		"idle"
	);

	// ── Load all settings from backend + localStorage ──
	const loadAllSettings = useCallback(async () => {
		try {
			const settings: Record<string, string> = await invoke("load_settings");
			if (await reloadIfMirrorWasStale(settings)) return;
			const getVal = (key: string) => {
				const val = settings[key];
				if (val !== undefined && val !== null) return String(val);
				return localStorage.getItem(key);
			};

			const apply = <T>(
				val: string | null,
				setter: (v: T) => void,
				transform: (v: string) => T
			) => {
				if (val !== null) setter(transform(val));
			};

			apply(getVal("bloom-weather-enabled"), setWeatherEnabled, readBool);
			apply(getVal("bloom-calendar-enabled"), setCalendarEnabled, readBool);
			apply(getVal("bloom-power-mode-enabled"), setPowerModeEnabled, readBool);
			apply(getVal("bloom-wallpaper-mode-enabled"), setWallpaperModeEnabled, readBool);
			apply(getVal("bloom-timer-sound-enabled"), setTimerSoundEnabled, readBool);
			apply(getVal("bloom-music-mode-enabled"), setMusicModeEnabled, readBool);
			apply(getVal("bloom-music-compact-notch"), setMusicCompactNotch, readBool);
			apply(getVal("bloom-shelf-persist"), setShelfPersist, readBool);
			apply(getVal("bloom-volume-overlay-enabled"), setVolumeOverlayEnabled, readBool);
			apply(getVal("bloom-brightness-overlay-enabled"), setBrightnessOverlayEnabled, readBool);
			apply(getVal("bloom-media-ambience-enabled"), setMediaAmbienceEnabled, readBool);
			apply(getVal("bloom-media-compact-glow-enabled"), setMediaCompactGlowEnabled, readBool);
			apply(getVal("bloom-corners-enabled"), setCornersEnabled, readBool);
			apply(getVal("bloom-time-format-24h"), setTimeFormat24h, readBool);
			apply(getVal("bloom-show-update-indicator"), setShowUpdateIndicator, readBool);
			apply(getVal("bloom-auto-update"), setAutoUpdate, readBool);
			apply(getVal("bloom-volume-edge-enabled"), setVolumeEdgeEnabled, readBool);
			apply(getVal("bloom-brightness-edge-enabled"), setBrightnessEdgeEnabled, readBool);
			apply(getVal("bloom-dock-enabled"), setDockEnabled, readBool);
			apply(getVal("bloom-dock-preview-enabled"), setDockPreviewEnabled, readBool);
			apply(getVal("bloom-dock-icon-only"), setDockIconOnly, readBool);
			apply(getVal("bloom-dock-separator-enabled"), setDockSeparatorEnabled, readBool);
			apply(getVal("bloom-start-icon"), setStartIcon, (v) => v);
			apply(getVal("bloom-dock-adaptive"), setDockAdaptive, readBool);
			apply(getVal("bloom-dock-win-number-enabled"), setDockWinNumberEnabled, readBool);
			apply(getVal("bloom-dock-extras-position"), setDockExtrasPosition, (v) => v);
			apply(getVal("bloom-dock-extras-drives"), setDockExtrasDrives, readBool);
			apply(getVal("bloom-dock-extras-recycle-bin"), setDockExtrasRecycleBin, readBool);
			apply(getVal("bloom-dock-extras-folders"), setDockExtrasFolders, (v) => v);
			apply(getVal("bloom-dock-extras-custom-folders"), setDockExtrasCustomFolders, (v) => v);

			apply(getVal("bloom-temp-unit"), setTempUnitFahrenheit, (v) => v === "fahrenheit");
			apply(getVal("bloom-scale"), setScale, parseFloat);
			apply(getVal("bloom-notch-scale") ?? getVal("bloom-scale"), setNotchScale, parseFloat);
			apply(getVal("bloom-dock-scale") ?? getVal("bloom-scale"), setDockScale, parseFloat);
			apply(getVal("bloom-low-battery-threshold"), setLowBatteryThreshold, parseInt);

			apply(getVal("bloom-notch-mode"), setNotchMode, (v) => (v === "auto-hide" ? "smart" : v));
			apply(getVal("bloom-notch-edge-delay"), setNotchEdgeDelay, parseInt);
			apply(getVal("bloom-notch-control-savings"), setNotchControlSavings, (v) => v !== "false");
			apply(getVal("bloom-notch-control-dnd"), setNotchControlDnd, (v) => v !== "false");
			apply(getVal("bloom-notch-control-airplane"), setNotchControlAirplane, (v) => v !== "false");
			apply(getVal("bloom-notch-control-hotspot"), setNotchControlHotspot, (v) => v !== "false");
			apply(getVal("bloom-notch-control-ethernet"), setNotchControlEthernet, (v) => v !== "false");
			apply(getVal("bloom-notch-audio-indicator"), setNotchAudioIndicator, (v) => v !== "false");
			apply(getVal("bloom-dock-mode"), setDockMode, (v) => (v === "auto-hide" ? "smart" : v));

			const savedCity = getVal("bloom-weather-city");
			if (savedCity) setCityName(savedCity);

			apply(getVal("bloom-theme-mode"), setThemeMode, (v) => v);
			apply(getVal("bloom-theme-color"), setThemeColor, (v) => v);
			apply(getVal("bloom-theme-opacity"), setThemeOpacity, parseFloat);
			apply(getVal("bloom-notch-opacity") ?? getVal("bloom-theme-opacity"), setNotchOpacity, parseFloat);
			apply(getVal("bloom-dock-opacity") ?? getVal("bloom-theme-opacity"), setDockOpacity, parseFloat);
			apply(getVal("bloom-theme-saturation"), setThemeSaturation, parseFloat);
			apply(getVal("bloom-theme-brightness"), setThemeBrightness, parseFloat);

			const widgetsVal = getVal("bloom-status-widgets");
			if (widgetsVal) {
				try {
					const parsed = JSON.parse(widgetsVal);
					if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
						setStatusWidgets(parsed);
					}
				} catch {}
			}
		} catch (e) {
			console.error("Failed to load settings:", e);
		}
	}, []);

	// ── Initialize on mount ──
	useEffect(() => {
		loadAllSettings();

		isEnabled()
			.then(setAutostart)
			.catch(() => {});

		getVersion()
			.then((ver) => setAppVersion(ver || "0.1.0"))
			.catch(() => setAppVersion("0.1.0"));

		checkForUpdates(false);
	}, []);

	// ── Sync settings from other windows ──
	useSettingsSync({
		"bloom-dock-mode": setDockMode,
		"bloom-notch-mode": setNotchMode,
		"bloom-notch-edge-delay": setNotchEdgeDelay,
		"bloom-notch-control-savings": (v) => setNotchControlSavings(v !== "false"),
		"bloom-notch-control-dnd": (v) => setNotchControlDnd(v !== "false"),
		"bloom-notch-control-airplane": (v) => setNotchControlAirplane(v !== "false"),
		"bloom-notch-control-hotspot": (v) => setNotchControlHotspot(v !== "false"),
		"bloom-notch-control-ethernet": (v) => setNotchControlEthernet(v !== "false"),
		"bloom-notch-audio-indicator": (v) => setNotchAudioIndicator(v !== "false"),
		"bloom-dock-enabled": setDockEnabled,
		"bloom-dock-icon-only": setDockIconOnly,
		"bloom-dock-separator-enabled": setDockSeparatorEnabled,
		"bloom-start-icon": setStartIcon,
		"bloom-dock-preview-enabled": setDockPreviewEnabled,
		"bloom-dock-adaptive": setDockAdaptive,
		"bloom-dock-win-number-enabled": setDockWinNumberEnabled,
		"bloom-dock-extras-position": setDockExtrasPosition,
		"bloom-dock-extras-drives": setDockExtrasDrives,
		"bloom-dock-extras-recycle-bin": setDockExtrasRecycleBin,
		"bloom-dock-extras-folders": setDockExtrasFolders,
		"bloom-dock-extras-custom-folders": setDockExtrasCustomFolders,
		"bloom-weather-enabled": setWeatherEnabled,
		"bloom-calendar-enabled": setCalendarEnabled,
		"bloom-timer-sound-enabled": setTimerSoundEnabled,
		"bloom-music-mode-enabled": setMusicModeEnabled,
		"bloom-music-compact-notch": setMusicCompactNotch,
		"bloom-media-ambience-enabled": setMediaAmbienceEnabled,
		"bloom-media-compact-glow-enabled": setMediaCompactGlowEnabled,
		"bloom-media-layout": setMediaLayout,
		"bloom-corners-enabled": setCornersEnabled,
		"bloom-show-update-indicator": setShowUpdateIndicator,
		"bloom-time-format-24h": setTimeFormat24h,
		"bloom-low-battery-threshold": setLowBatteryThreshold,
		"bloom-scale": setScale,
		"bloom-notch-scale": setNotchScale,
		"bloom-dock-scale": setDockScale,
		"bloom-temp-unit": (v) => setTempUnitFahrenheit(v === "fahrenheit"),
		"bloom-auto-update": setAutoUpdate,
		"bloom-volume-overlay-enabled": setVolumeOverlayEnabled,
		"bloom-volume-edge-enabled": setVolumeEdgeEnabled,
		"bloom-brightness-overlay-enabled": setBrightnessOverlayEnabled,
		"bloom-brightness-edge-enabled": setBrightnessEdgeEnabled,
		"bloom-theme-mode": setThemeMode,
		"bloom-theme-color": setThemeColor,
		"bloom-theme-opacity": setThemeOpacity,
		"bloom-notch-opacity": setNotchOpacity,
		"bloom-dock-opacity": setDockOpacity,
		"bloom-theme-saturation": setThemeSaturation,
		"bloom-theme-brightness": setThemeBrightness,
		"bloom-weather-city": (v) => setCityName(v || "")
	});

	// ── Listen for system accent changes (adaptive theme) ──
	useEffect(() => {
		const unlisten = listen<string>("system-accent-changed", (event) => {
			const mode = localStorage.getItem("bloom-theme-mode") || "dark";
			if (mode === "adaptive") {
				try {
					const hsl = hexToHsl(event.payload);
					setThemeSaturation(hsl.s / 100);
					setThemeBrightness(hsl.l / 100);
				} catch (e) {
					console.error("Failed to parse system accent color change HSL:", e);
				}
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// ── City search debounce ──
	useEffect(() => {
		if (cityName.trim().length < 2) {
			setCitySearchResults([]);
			setShowCityDropdown(false);
			return;
		}

		const timeout = setTimeout(async () => {
			try {
				const res = await fetch(
					`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=en&format=json`
				);
				const data = await res.json();
				if (data.results && data.results.length > 0) {
					setCitySearchResults(
						data.results.map((r: any) => ({
							name: r.name,
							country: r.country || "",
							latitude: r.latitude,
							longitude: r.longitude
						}))
					);
					setShowCityDropdown(true);
				} else {
					setCitySearchResults([]);
				}
			} catch {
				setCitySearchResults([]);
			}
		}, 300);

		return () => clearTimeout(timeout);
	}, [cityName]);

	// ── Update checker ──
	const checkForUpdates = async (manual = true) => {
		setUpdateStatus("checking");
		try {
			const result = await invoke<UpdateCheckResult>("check_for_updates", { force: manual });
			if (result.available) {
				setUpdateStatus("available");
				setUpdateVersion(result.version ?? "");
			} else {
				setUpdateStatus("uptodate");
			}
		} catch (e) {
			console.error("Updater error:", e);
			setUpdateStatus("error");
		}
	};

	const installUpdate = async () => {
		try {
			setUpdateStatus("downloading");
			await invoke("install_update");
			setUpdateStatus("idle");
		} catch (e) {
			console.error(e);
			setUpdateStatus("error");
		}
	};

	// Reflect install progress triggered from any window (including auto-update).
	useEffect(() => {
		const unlisten = listen<{ status: string; progress?: number }>(
			"auto-update-status",
			(event) => {
				switch (event.payload.status) {
					case "downloading":
						setUpdateStatus("downloading");
						break;
					case "installing":
						setUpdateStatus("installing");
						break;
					case "done":
						setUpdateStatus((prev) =>
							prev === "downloading" || prev === "installing" ? "idle" : prev
						);
						break;
				}
			}
		);
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// ── Autostart ──
	const toggleAutostart = async () => {
		try {
			const currentlyEnabled = await isEnabled();
			if (currentlyEnabled) {
				await disable();
				setAutostart(false);
			} else {
				await enable();
				setAutostart(true);
			}
		} catch (err) {}
	};

	// ── Simple boolean toggles ──
	const toggleWeather = () => {
		const next = !weatherEnabled;
		setWeatherEnabled(next);
		saveSetting("bloom-weather-enabled", String(next));
	};

	const toggleCalendar = () => {
		const next = !calendarEnabled;
		setCalendarEnabled(next);
		saveSetting("bloom-calendar-enabled", String(next));
	};

	const togglePowerMode = () => {
		const next = !powerModeEnabled;
		setPowerModeEnabled(next);
		saveSetting("bloom-power-mode-enabled", String(next));
	};

	const toggleWallpaperMode = () => {
		const next = !wallpaperModeEnabled;
		setWallpaperModeEnabled(next);
		saveSetting("bloom-wallpaper-mode-enabled", String(next));
	};

	const toggleTimerSound = () => {
		const next = !timerSoundEnabled;
		setTimerSoundEnabled(next);
		saveSetting("bloom-timer-sound-enabled", String(next));
	};

	const toggleMusicMode = () => {
		const next = !musicModeEnabled;
		setMusicModeEnabled(next);
		saveSetting("bloom-music-mode-enabled", String(next));
	};

	const toggleMusicCompactNotch = () => {
		const next = !musicCompactNotch;
		setMusicCompactNotch(next);
		saveSetting("bloom-music-compact-notch", String(next));
	};

	const toggleShelfPersist = () => {
		const next = !shelfPersist;
		setShelfPersist(next);
		saveSetting("bloom-shelf-persist", String(next));
	};

	const toggleNotchControlSavings = () => {
		const next = !notchControlSavings;
		setNotchControlSavings(next);
		saveSetting("bloom-notch-control-savings", String(next));
	};

	const toggleNotchControlDnd = () => {
		const next = !notchControlDnd;
		setNotchControlDnd(next);
		saveSetting("bloom-notch-control-dnd", String(next));
	};

	const toggleNotchControlAirplane = () => {
		const next = !notchControlAirplane;
		setNotchControlAirplane(next);
		saveSetting("bloom-notch-control-airplane", String(next));
	};

	const toggleNotchControlHotspot = () => {
		const next = !notchControlHotspot;
		setNotchControlHotspot(next);
		saveSetting("bloom-notch-control-hotspot", String(next));
	};

	const toggleNotchControlEthernet = () => {
		const next = !notchControlEthernet;
		setNotchControlEthernet(next);
		saveSetting("bloom-notch-control-ethernet", String(next));
	};

	const toggleNotchAudioIndicator = () => {
		const next = !notchAudioIndicator;
		setNotchAudioIndicator(next);
		saveSetting("bloom-notch-audio-indicator", String(next));
	};

	const toggleMediaLayout = (layout: "classic" | "compact") => {
		setMediaLayout(layout);
		saveSetting("bloom-media-layout", layout);
	};

	const toggleVolumeOverlay = () => {
		const next = !volumeOverlayEnabled;
		setVolumeOverlayEnabled(next);
		saveSetting("bloom-volume-overlay-enabled", String(next));
	};

	const toggleVolumeEdge = () => {
		const next = !volumeEdgeEnabled;
		setVolumeEdgeEnabled(next);
		saveSetting("bloom-volume-edge-enabled", String(next));
	};

	const toggleBrightnessOverlay = () => {
		const next = !brightnessOverlayEnabled;
		setBrightnessOverlayEnabled(next);
		saveSetting("bloom-brightness-overlay-enabled", String(next));
	};

	const toggleBrightnessEdge = () => {
		const next = !brightnessEdgeEnabled;
		setBrightnessEdgeEnabled(next);
		saveSetting("bloom-brightness-edge-enabled", String(next));
	};

	const toggleAmbience = () => {
		const next = !mediaAmbienceEnabled;
		setMediaAmbienceEnabled(next);
		saveSetting("bloom-media-ambience-enabled", String(next));
	};

	const toggleCompactGlow = () => {
		const next = !mediaCompactGlowEnabled;
		setMediaCompactGlowEnabled(next);
		saveSetting("bloom-media-compact-glow-enabled", String(next));
	};

	const toggleCorners = () => {
		const next = !cornersEnabled;
		setCornersEnabled(next);
		saveSetting("bloom-corners-enabled", String(next));
	};

	const toggleUpdateIndicator = () => {
		const next = !showUpdateIndicator;
		setShowUpdateIndicator(next);
		saveSetting("bloom-show-update-indicator", String(next));
	};

	const toggleTimeFormat24h = () => {
		const next = !timeFormat24h;
		setTimeFormat24h(next);
		saveSetting("bloom-time-format-24h", String(next));
	};

	const toggleTempUnit = () => {
		const next = !tempUnitFahrenheit;
		setTempUnitFahrenheit(next);
		saveSetting("bloom-temp-unit", next ? "fahrenheit" : "celsius");
	};

	const toggleDock = () => {
		const next = !dockEnabled;
		setDockEnabled(next);
		saveSetting("bloom-dock-enabled", String(next));
	};

	const toggleDockPreview = () => {
		const next = !dockPreviewEnabled;
		setDockPreviewEnabled(next);
		saveSetting("bloom-dock-preview-enabled", String(next));
	};

	const toggleDockIconOnly = () => {
		const next = !dockIconOnly;
		setDockIconOnly(next);
		saveSetting("bloom-dock-icon-only", String(next));
	};

	const toggleDockSeparator = () => {
		const next = !dockSeparatorEnabled;
		setDockSeparatorEnabled(next);
		saveSetting("bloom-dock-separator-enabled", String(next));
	};

	const handleStartIconChange = (icon: string) => {
		setStartIcon(icon);
		saveSetting("bloom-start-icon", icon);
	};

	const toggleDockAdaptive = () => {
		const next = !dockAdaptive;
		setDockAdaptive(next);
		saveSetting("bloom-dock-adaptive", String(next));
	};

	const toggleDockWinNumber = () => {
		const next = !dockWinNumberEnabled;
		setDockWinNumberEnabled(next);
		saveSetting("bloom-dock-win-number-enabled", String(next));
	};

	const handleDockExtrasPositionChange = (position: string) => {
		setDockExtrasPosition(position);
		saveSetting("bloom-dock-extras-position", position);
	};

	const toggleDockExtrasDrives = () => {
		const next = !dockExtrasDrives;
		setDockExtrasDrives(next);
		saveSetting("bloom-dock-extras-drives", String(next));
	};

	const toggleDockExtrasRecycleBin = () => {
		const next = !dockExtrasRecycleBin;
		setDockExtrasRecycleBin(next);
		saveSetting("bloom-dock-extras-recycle-bin", String(next));
	};

	const toggleDockExtraFolder = (id: string) => {
		const next = toggleEnabledFolder(dockExtrasFolders, id);
		setDockExtrasFolders(next);
		saveSetting("bloom-dock-extras-folders", next);
	};

	const handleAddDockExtraFolder = async () => {
		try {
			const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
			const selected = await openDialog({
				title: "Add a folder to the dock",
				directory: true,
				multiple: false
			});
			if (typeof selected === "string") {
				const next = addCustomFolder(dockExtrasCustomFolders, selected);
				setDockExtrasCustomFolders(next);
				saveSetting("bloom-dock-extras-custom-folders", next);
			}
		} catch (e) {
			console.error("Folder picker failed:", e);
		}
	};

	const handleRemoveDockExtraFolder = (path: string) => {
		const next = removeCustomFolder(dockExtrasCustomFolders, path);
		setDockExtrasCustomFolders(next);
		saveSetting("bloom-dock-extras-custom-folders", next);
	};

	const toggleAutoUpdate = () => {
		const next = !autoUpdate;
		setAutoUpdate(next);
		saveSetting("bloom-auto-update", String(next));
	};

	// ── Value setters ──
	const setDockModeValue = (newMode: string) => {
		setDockMode(newMode);
		saveSetting("bloom-dock-mode", newMode);
	};

	const setNotchModeValue = (newMode: string) => {
		setNotchMode(newMode);
		saveSetting("bloom-notch-mode", newMode);
	};

	const handleNotchEdgeDelayChange = (val: number) => {
		setNotchEdgeDelay(val);
		saveSettingDebounced("bloom-notch-edge-delay", val.toString());
	};

	const handleThresholdChange = (val: number) => {
		setLowBatteryThreshold(val);
		saveSettingDebounced("bloom-low-battery-threshold", val.toString());
	};

	const handleScaleChange = (val: number) => {
		setScale(val);
		saveSettingDebounced("bloom-scale", val.toString(), 200);
	};

	const handleNotchScaleChange = (val: number) => {
		setNotchScale(val);
		saveSettingDebounced("bloom-notch-scale", val.toString(), 200);
	};

	const handleDockScaleChange = (val: number) => {
		setDockScale(val);
		saveSettingDebounced("bloom-dock-scale", val.toString(), 200);
	};

	const handleWidgetsChange = (config: WidgetConfig) => {
		setStatusWidgets(config);
		saveSetting("bloom-status-widgets", JSON.stringify(config));
	};

	// ── Theme handlers ──
	const handleThemeModeChange = async (mode: string) => {
		setThemeMode(mode);
		saveSetting("bloom-theme-mode", mode);

		if (mode === "adaptive") {
			try {
				const accentHex = await invoke<string>("get_system_accent_color");
				const hsl = hexToHsl(accentHex);
				setThemeSaturation(hsl.s / 100);
				saveSetting("bloom-theme-saturation", String(hsl.s / 100));
				setThemeBrightness(hsl.l / 100);
				saveSetting("bloom-theme-brightness", String(hsl.l / 100));
			} catch (e) {
				console.error("Failed to parse adaptive accent HSL:", e);
			}
		}
	};

	const handleThemeColorChange = (color: string) => {
		setThemeColor(color);
		saveSettingDebounced("bloom-theme-color", color);

		try {
			const hsl = hexToHsl(color);
			setThemeSaturation(hsl.s / 100);
			saveSettingDebounced("bloom-theme-saturation", String(hsl.s / 100));
			setThemeBrightness(hsl.l / 100);
			saveSettingDebounced("bloom-theme-brightness", String(hsl.l / 100));
		} catch (e) {
			console.error("Failed to parse custom color HSL:", e);
		}
	};

	const handleOpacityChange = (value: number) => {
		setThemeOpacity(value);
		saveSettingDebounced("bloom-theme-opacity", String(value));
	};

	const handleNotchOpacityChange = (value: number) => {
		setNotchOpacity(value);
		saveSettingDebounced("bloom-notch-opacity", String(value));
	};

	const handleDockOpacityChange = (value: number) => {
		setDockOpacity(value);
		saveSettingDebounced("bloom-dock-opacity", String(value));
	};

	const handleSaturationChange = (value: number) => {
		setThemeSaturation(value);
		saveSettingDebounced("bloom-theme-saturation", String(value));
	};

	const handleBrightnessChange = (value: number) => {
		setThemeBrightness(value);
		saveSettingDebounced("bloom-theme-brightness", String(value));
	};

	// ── City search ──
	const selectCity = async (city: {
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}) => {
		setCityName(city.name);
		setShowCityDropdown(false);
		setCitySearchResults([]);
		localStorage.setItem("bloom-weather-city", city.name);
		localStorage.setItem("bloom-weather-lat", city.latitude.toString());
		localStorage.setItem("bloom-weather-lon", city.longitude.toString());
		await invoke("save_setting", {
			key: "bloom-weather-lat",
			value: city.latitude.toString()
		}).catch(() => {});
		await invoke("save_setting", {
			key: "bloom-weather-lon",
			value: city.longitude.toString()
		}).catch(() => {});
		await invoke("save_setting", { key: "bloom-weather-city", value: city.name }).catch(() => {});
		emit("weather-refresh", { lat: city.latitude, lon: city.longitude });
	};

	const handleCityClear = async () => {
		setCityName("");
		setShowCityDropdown(false);
		setCitySearchResults([]);
		localStorage.removeItem("bloom-weather-city");
		localStorage.removeItem("bloom-weather-lat");
		localStorage.removeItem("bloom-weather-lon");
		await invoke("save_setting", { key: "bloom-weather-lat", value: null }).catch(() => {});
		await invoke("save_setting", { key: "bloom-weather-lon", value: null }).catch(() => {});
		await invoke("save_setting", { key: "bloom-weather-city", value: null }).catch(() => {});
		emit("weather-refresh", true);
	};

	// ── Reset to defaults ──
	const resetToDefaults = async () => {
		try {
			const { ask } = await import("@tauri-apps/plugin-dialog");
			const confirmed = await ask(
				"All settings return to their defaults and Orbix restarts. Pinned apps and custom icons are kept.",
				{
					title: "Reset Orbix to Defaults",
					kind: "warning",
					okLabel: "Reset and Restart",
					cancelLabel: "Cancel"
				}
			);
			if (!confirmed) return;

			await invoke("reset_settings");

			// settings.json is cleared, but every window also caches bloom keys
			// in localStorage; drop them so the restart can't resurrect values.
			// The first-run/version sentinels are lifecycle markers, not
			// preferences — keeping them avoids replaying the splash, which
			// would also re-trigger the first-run autostart enable.
			const keep = new Set(["bloom-first-run", "bloom-app-version"]);
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith("bloom-") && !keep.has(key)) localStorage.removeItem(key);
			}

			await invoke("restart_bloom").catch(console.error);
		} catch (e) {
			console.error("Reset failed:", e);
		}
	};

	// ── Export / Import ──
	const handleExportSettings = async () => {
		setExportStatus("exporting");
		try {
			const { save: saveDialog } = await import("@tauri-apps/plugin-dialog");
			const settingsJson = await invoke<string>("export_settings");
			const filePath = await saveDialog({
				title: "Export Orbix Settings",
				defaultPath: "orbix-settings.json",
				filters: [{ name: "JSON", extensions: ["json"] }]
			});
			if (filePath) {
				await invoke("write_settings_to_path", { path: filePath, content: settingsJson });
				setExportStatus("success");
				setTimeout(() => setExportStatus("idle"), 2000);
			} else {
				setExportStatus("idle");
			}
		} catch (e) {
			console.error("Export failed:", e);
			setExportStatus("error");
			setTimeout(() => setExportStatus("idle"), 3000);
		}
	};

	const handleImportSettings = async () => {
		setImportStatus("importing");
		try {
			const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
			const filePath = await openDialog({
				title: "Import Orbix Settings",
				filters: [{ name: "JSON", extensions: ["json"] }],
				multiple: false
			});
			if (filePath) {
				const content = await invoke<string>("read_settings_from_path", {
					path: filePath as string
				});
				await invoke("import_settings", { settings: content });
				await loadAllSettings();
				setImportStatus("success");
				setTimeout(() => setImportStatus("idle"), 2000);
			} else {
				setImportStatus("idle");
			}
		} catch (e) {
			console.error("Import failed:", e);
			setImportStatus("error");
			setTimeout(() => setImportStatus("idle"), 3000);
		}
	};

	return {
		// System
		autostart,
		toggleAutostart,
		autoUpdate,
		toggleAutoUpdate,
		lowBatteryThreshold,
		handleThresholdChange,
		timeFormat24h,
		toggleTimeFormat24h,
		showUpdateIndicator,
		toggleUpdateIndicator,
		scale,
		handleScaleChange,
		notchScale,
		handleNotchScaleChange,
		dockScale,
		handleDockScaleChange,
		cornersEnabled,
		toggleCorners,

		// Theme
		themeMode,
		handleThemeModeChange,
		themeColor,
		handleThemeColorChange,
		themeOpacity,
		handleOpacityChange,
		notchOpacity,
		handleNotchOpacityChange,
		dockOpacity,
		handleDockOpacityChange,
		themeSaturation,
		handleSaturationChange,
		themeBrightness,
		handleBrightnessChange,

		// Notch
		notchMode,
		setNotchModeValue,
		notchEdgeDelay,
		handleNotchEdgeDelayChange,
		calendarEnabled,
		toggleCalendar,
		powerModeEnabled,
		togglePowerMode,
		wallpaperModeEnabled,
		toggleWallpaperMode,
		notchControlSavings,
		toggleNotchControlSavings,
		notchControlDnd,
		toggleNotchControlDnd,
		notchControlAirplane,
		toggleNotchControlAirplane,
		notchControlHotspot,
		toggleNotchControlHotspot,
		notchControlEthernet,
		toggleNotchControlEthernet,
		notchAudioIndicator,
		toggleNotchAudioIndicator,
		timerSoundEnabled,
		toggleTimerSound,
		musicModeEnabled,
		toggleMusicMode,
		musicCompactNotch,
		toggleMusicCompactNotch,
		shelfPersist,
		toggleShelfPersist,
		mediaLayout,
		toggleMediaLayout,
		mediaAmbienceEnabled,
		toggleAmbience,
		mediaCompactGlowEnabled,
		toggleCompactGlow,

		// Weather
		weatherEnabled,
		toggleWeather,
		tempUnitFahrenheit,
		toggleTempUnit,
		cityName,
		setCityName,
		citySearchResults,
		showCityDropdown,
		setShowCityDropdown,
		selectCity,
		handleCityClear,

		// Widgets
		statusWidgets,
		handleWidgetsChange,

		// Dock
		dockEnabled,
		toggleDock,
		dockMode,
		setDockModeValue,
		dockPreviewEnabled,
		toggleDockPreview,
		dockIconOnly,
		toggleDockIconOnly,
		dockSeparatorEnabled,
		toggleDockSeparator,
		startIcon,
		handleStartIconChange,
		dockAdaptive,
		toggleDockAdaptive,
		dockWinNumberEnabled,
		toggleDockWinNumber,
		dockExtrasPosition,
		handleDockExtrasPositionChange,
		dockExtrasDrives,
		toggleDockExtrasDrives,
		dockExtrasRecycleBin,
		toggleDockExtrasRecycleBin,
		dockExtrasFolders,
		toggleDockExtraFolder,
		dockExtrasCustomFolders,
		handleAddDockExtraFolder,
		handleRemoveDockExtraFolder,

		// Overlays
		volumeOverlayEnabled,
		toggleVolumeOverlay,
		volumeEdgeEnabled,
		toggleVolumeEdge,
		brightnessOverlayEnabled,
		toggleBrightnessOverlay,
		brightnessEdgeEnabled,
		toggleBrightnessEdge,

		// Updates
		updateStatus,
		updateVersion,
		appVersion,
		checkForUpdates,
		installUpdate,

		// Import / Export
		exportStatus,
		importStatus,
		handleExportSettings,
		handleImportSettings,

		// Utilities
		restartBloom: () => invoke("restart_bloom"),
		resetToDefaults,
		quitBloom: () => invoke("quit_bloom")
	};
}

