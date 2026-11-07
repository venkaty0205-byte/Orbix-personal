import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, Bluetooth, Volume2, VolumeX, Sun, SlidersHorizontal } from "lucide-react";
import { SplitPillCard } from "./SplitPillCard";
import { QuickActionGrid } from "./QuickActionGrid";
import { ControlsFooter } from "./ControlsFooter";
import { WifiSubView } from "./WifiSubView";
import { BluetoothSubView } from "./BluetoothSubView";
import { InternetStatus, MicrophoneState, SubViewMode } from "./types";
import "./ControlsView.css";

interface ControlsViewProps {
	wifiEnabled: boolean;
	wifiConnected: boolean;
	onToggleWifi: () => void;
	onWifiContextMenu?: (e: React.MouseEvent) => void;

	bluetoothEnabled: boolean;
	onToggleBluetooth: () => void;
	onBluetoothContextMenu?: (e: React.MouseEvent) => void;

	dockMode: string;
	onToggleDockMode: (e: React.MouseEvent) => void;

	notchMode: string;
	onToggleNotchMode: (e: React.MouseEvent) => void;

	airplaneMode: boolean;
	onToggleAirplane: () => void;

	hotspotActive: boolean;
	onToggleHotspot: () => void;

	dndActive: boolean;
	onToggleDnd: () => void;

	batterySaverActive: boolean;
	onToggleBatterySaver: () => void;

	showSavings?: boolean;
	showDnd?: boolean;
	showAirplane?: boolean;
	showHotspot?: boolean;
	showEthernet?: boolean;
	onOpenSystemTray?: (e: React.MouseEvent) => void;
	onBatterySaverContextMenu?: (e?: React.MouseEvent) => void;

	volume: number;
	isMuted: boolean;
	onVolumeChange: (val: number) => void;
	onToggleMute: () => void;
	onNextAudioDevice?: () => void;

	brightness: number;
	onBrightnessChange: (val: number) => void;

	onOpenSettings: () => void;
	onSubViewChange?: (subView: SubViewMode) => void;
}

export const ControlsView: React.FC<ControlsViewProps> = React.memo(({
	wifiEnabled,
	wifiConnected,
	onToggleWifi,
	onWifiContextMenu,
	bluetoothEnabled,
	onToggleBluetooth,
	onBluetoothContextMenu,
	dockMode,
	onToggleDockMode,
	notchMode,
	onToggleNotchMode,
	airplaneMode,
	onToggleAirplane,
	hotspotActive,
	onToggleHotspot,
	dndActive,
	onToggleDnd,
	batterySaverActive,
	onToggleBatterySaver,
	showSavings = true,
	showDnd = true,
	showAirplane = true,
	showHotspot = true,
	showEthernet = true,
	onOpenSystemTray,
	onBatterySaverContextMenu,
	volume,
	isMuted,
	onVolumeChange,
	onToggleMute,
	onNextAudioDevice,
	brightness,
	onBrightnessChange,
	onOpenSettings,
	onSubViewChange,
}) => {
	const [subView, setSubView] = useState<SubViewMode>("main");
	const [internetStatus, setInternetStatus] = useState<InternetStatus | null>(null);
	const [microphoneState, setMicrophoneState] = useState<MicrophoneState | null>(null);

	// Local slider states for instant 0ms latency dragging
	const [localVol, setLocalVol] = useState(volume);
	const [localBri, setLocalBri] = useState(brightness);
	const isDraggingVol = useRef(false);
	const isDraggingBri = useRef(false);

	useEffect(() => {
		if (!isDraggingVol.current) setLocalVol(volume);
	}, [volume]);

	useEffect(() => {
		if (!isDraggingBri.current) setLocalBri(brightness);
	}, [brightness]);

	const updateSubView = (mode: SubViewMode) => {
		setSubView(mode);
		onSubViewChange?.(mode);
	};

	// Fetch live Internet & Microphone state with gentle interval
	const fetchTelemetry = useCallback(async () => {
		try {
			const net = await invoke<InternetStatus>("get_internet_status");
			setInternetStatus(net);
		} catch (err) {
			console.error("Failed to fetch internet status:", err);
		}

		try {
			const mic = await invoke<MicrophoneState>("get_microphone_state");
			setMicrophoneState(mic);
		} catch (err) {
			console.error("Failed to fetch mic state:", err);
		}
	}, []);

	useEffect(() => {
		fetchTelemetry();
		const interval = setInterval(fetchTelemetry, 6000);
		return () => clearInterval(interval);
	}, [fetchTelemetry]);

	const handleToggleMic = async () => {
		try {
			const newMuted = await invoke<boolean>("toggle_microphone_mute");
			setMicrophoneState((prev) => (prev ? { ...prev, is_muted: newMuted } : null));
		} catch (err) {
			console.error("Failed to toggle mic mute:", err);
		}
	};

	const handleRestartShell = () => {
		invoke("restart_bloom").catch(console.error);
	};

	const handleOpenNetworkSettings = () => {
		invoke("open_network_settings").catch(console.error);
	};

	const handleTriggerSnip = () => {
		invoke("trigger_screen_snip").catch(console.error);
	};

	const handleLockWorkstation = () => {
		invoke("lock_workstation").catch(console.error);
	};

	const handleOpenNotificationCenter = () => {
		invoke("open_notification_center").catch(console.error);
	};

	const handleOpenNightLightSettings = () => {
		invoke("open_night_light_settings").catch(console.error);
	};

	const displayVolume = isMuted ? 0 : localVol;

	return (
		<div className="cc-root-container" onClick={(e) => e.stopPropagation()}>
			<AnimatePresence mode="wait">
				{subView === "main" ? (
					<motion.div
						key="cc-main"
						className="cc-view-page"
						initial={{ opacity: 0, x: -20 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: -20 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						{/* Top Split Cards & Mode Pills */}
						<div className="cc-top-cards-grid">
							{/* Wi-Fi Split Card */}
							<SplitPillCard
								icon={<Wifi size={15} />}
								title="Wi-Fi"
								status={!wifiEnabled ? "Off" : wifiConnected ? (internetStatus?.label || "Connected") : "Not connected"}
								isActive={wifiEnabled}
								onToggle={onToggleWifi}
								onOpenSubView={() => updateSubView("wifi")}
								onContextMenu={onWifiContextMenu}
								subViewTitle="Scan nearby Wi-Fi networks"
							/>

							{/* Bluetooth Split Card */}
							<SplitPillCard
								icon={<Bluetooth size={15} />}
								title="Bluetooth"
								status={bluetoothEnabled ? "On" : "Off"}
								isActive={bluetoothEnabled}
								onToggle={onToggleBluetooth}
								onOpenSubView={() => updateSubView("bluetooth")}
								onContextMenu={onBluetoothContextMenu}
								subViewTitle="View Bluetooth devices"
							/>

							{/* Dock Mode Tile */}
							<button
								type="button"
								className={`cc-simple-tile ${dockMode === "fixed" ? "active" : ""}`}
								onClick={(e) => onToggleDockMode(e)}
								title="Cycle Dock Mode: Fixed / Smart / Peek"
							>
								<div className="cc-simple-tile-text">
									<span className="cc-tile-title">Dock</span>
									<span className="cc-tile-status">{dockMode === "fixed" ? "Fixed" : dockMode === "smart" ? "Smart" : "Peek"}</span>
								</div>
							</button>

							{/* Notch Mode Tile */}
							<button
								type="button"
								className={`cc-simple-tile ${notchMode === "fixed" ? "active" : ""}`}
								onClick={(e) => onToggleNotchMode(e)}
								title="Cycle Notch Mode: Fixed / Smart / Peek"
							>
								<div className="cc-simple-tile-text">
									<span className="cc-tile-title">Notch</span>
									<span className="cc-tile-status">{notchMode === "fixed" ? "Fixed" : notchMode === "smart" ? "Smart" : "Peek"}</span>
								</div>
							</button>
						</div>

						{/* Quick Action Grid */}
						<QuickActionGrid
							airplaneMode={airplaneMode}
							onToggleAirplane={onToggleAirplane}
							onAirplaneContextMenu={() => invoke("open_airplane_mode_settings")}
							showAirplane={showAirplane}
							hotspotActive={hotspotActive}
							onToggleHotspot={onToggleHotspot}
							onHotspotContextMenu={() => invoke("open_mobile_hotspot_settings")}
							showHotspot={showHotspot}
							dndActive={dndActive}
							onToggleDnd={onToggleDnd}
							onDndContextMenu={() => invoke("open_notification_center")}
							showDnd={showDnd}
							batterySaverActive={batterySaverActive}
							onToggleBatterySaver={onToggleBatterySaver}
							onBatterySaverContextMenu={onBatterySaverContextMenu}
							showSavings={showSavings}
							onTriggerScreenSnip={handleTriggerSnip}
							onLockWorkstation={handleLockWorkstation}
							onOpenNotificationCenter={handleOpenNotificationCenter}
							onOpenNightLightSettings={handleOpenNightLightSettings}
							onOpenSystemTray={onOpenSystemTray}
						/>

						{/* Sliders Area */}
						<div className="cc-sliders-container">
							{/* Volume Slider */}
							<div className="cc-slider-row">
								<button
									type="button"
									className="cc-slider-icon-btn"
									onClick={(e) => {
										e.stopPropagation();
										onToggleMute();
									}}
									title={isMuted ? "Unmute" : "Mute"}
								>
									{isMuted || displayVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
								</button>
								<div className="cc-slider-track-wrap">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={displayVolume}
										onChange={(e) => {
											const val = parseFloat(e.target.value);
											setLocalVol(val);
											onVolumeChange(val);
										}}
										onPointerDown={(e) => {
											e.stopPropagation();
											isDraggingVol.current = true;
										}}
										onPointerUp={() => {
											isDraggingVol.current = false;
										}}
										onClick={(e) => e.stopPropagation()}
										className="cc-slider-input"
									/>
									<div className="cc-slider-fill" style={{ width: `${displayVolume * 100}%` }} />
								</div>
								<span className="cc-slider-pct">{Math.round(displayVolume * 100)}%</span>
								{onNextAudioDevice && (
									<button
										type="button"
										className="cc-slider-action-btn"
										onClick={(e) => {
											e.stopPropagation();
											onNextAudioDevice();
										}}
										title="Switch Audio Output Device"
									>
										<SlidersHorizontal size={13} />
									</button>
								)}
							</div>

							{/* Brightness Slider */}
							<div className="cc-slider-row">
								<div className="cc-slider-icon-btn">
									<Sun size={15} />
								</div>
								<div className="cc-slider-track-wrap">
									<input
										type="range"
										min="0"
										max="100"
										step="1"
										value={localBri}
										onChange={(e) => {
											const val = parseInt(e.target.value, 10);
											setLocalBri(val);
											onBrightnessChange(val);
										}}
										onPointerDown={(e) => {
											e.stopPropagation();
											isDraggingBri.current = true;
										}}
										onPointerUp={() => {
											isDraggingBri.current = false;
										}}
										onClick={(e) => e.stopPropagation()}
										className="cc-slider-input"
									/>
									<div className="cc-slider-fill" style={{ width: `${localBri}%` }} />
								</div>
								<span className="cc-slider-pct">{Math.round(localBri)}%</span>
							</div>
						</div>

						{/* New Bottom Status & Utility Tray */}
						<ControlsFooter
								showEthernet={showEthernet}
							internetStatus={internetStatus}
							microphoneState={microphoneState}
							onToggleMic={handleToggleMic}
							onOpenWifiSubView={() => updateSubView("wifi")}
							onRestartShell={handleRestartShell}
							onOpenSettings={onOpenSettings}
							onOpenNetworkSettings={handleOpenNetworkSettings}
						/>
					</motion.div>
				) : subView === "wifi" ? (
					<motion.div
						key="cc-wifi"
						className="cc-view-page"
						initial={{ opacity: 0, x: 30 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 30 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						<WifiSubView
							wifiEnabled={wifiEnabled}
							onToggleWifi={onToggleWifi}
							onBack={() => updateSubView("main")}
							currentSsid={internetStatus?.connection_type === "wifi" ? internetStatus.label : undefined}
						/>
					</motion.div>
				) : (
					<motion.div
						key="cc-bt"
						className="cc-view-page"
						initial={{ opacity: 0, x: 30 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 30 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						<BluetoothSubView
							bluetoothEnabled={bluetoothEnabled}
							onToggleBluetooth={onToggleBluetooth}
							onBack={() => updateSubView("main")}
							onOpenSettings={() => invoke("open_bluetooth_settings")}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
});





