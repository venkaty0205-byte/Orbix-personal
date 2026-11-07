import React from "react";
import { Mic, MicOff, RotateCw, Settings, Wifi } from "lucide-react";
import { EthernetIcon, GlobeOffIcon } from "./Icons";
import { InternetStatus, MicrophoneState } from "./types";

interface ControlsFooterProps {
	showEthernet?: boolean;
	internetStatus: InternetStatus | null;
	microphoneState: MicrophoneState | null;
	onToggleMic: () => void;
	onOpenWifiSubView: () => void;
	onRestartShell: () => void;
	onOpenSettings: () => void;
	onOpenNetworkSettings: () => void;
}

export const ControlsFooter: React.FC<ControlsFooterProps> = React.memo(({
	showEthernet = true,
	internetStatus,
	microphoneState,
	onToggleMic,
	onOpenWifiSubView,
	onRestartShell,
	onOpenSettings,
	onOpenNetworkSettings,
}) => {
	const connType = internetStatus?.connection_type ?? (internetStatus?.is_connected ? "wifi" : "offline");
	const isConnected = internetStatus?.is_connected ?? false;
	const label = internetStatus?.label || (isConnected ? "Connected" : "No internet");
	const isMicMuted = microphoneState?.is_muted ?? false;

	return (
		<div className="cc-footer-tray">
			{/* Left: Internet Status Pin & Badge */}
			<div
				className={`cc-footer-network-pill ${isConnected ? "connected" : "disconnected"}`}
				onClick={(e) => {
					e.stopPropagation();
					if ((connType === "ethernet" && showEthernet)) {
						onOpenNetworkSettings();
					} else {
						onOpenWifiSubView();
					}
				}}
				onContextMenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onOpenNetworkSettings();
				}}
				title={
					(connType === "ethernet" && showEthernet)
						? "Ethernet Connected • Click for Network Connections"
						: isConnected
							? `Wi-Fi: ${label} • Click to View Available Networks`
							: "No Internet Connection • Click to Scan Wi-Fi"
				}
			>
				<div className="cc-footer-network-icon">
					{(connType === "ethernet" && showEthernet) ? (
						<EthernetIcon size={14} className="text-emerald-400" />
					) : isConnected ? (
						<Wifi size={13} className="text-emerald-400" />
					) : (
						<GlobeOffIcon size={13} className="text-red-400" />
					)}
				</div>
				<span className="cc-footer-network-label">{label}</span>
				<div className={`cc-footer-status-dot ${isConnected ? "online" : "offline"}`} />
			</div>

			{/* Center-Left: Microphone Mute Toggle */}
			<button
				type="button"
				className={`cc-footer-mic-btn ${isMicMuted ? "muted" : "active"}`}
				onClick={(e) => {
					e.stopPropagation();
					onToggleMic();
				}}
				title={isMicMuted ? "Microphone Muted • Click to Unmute" : "Microphone Active • Click to Mute"}
			>
				{isMicMuted ? <MicOff size={13} /> : <Mic size={13} />}
				<span className="cc-footer-mic-label">{isMicMuted ? "Muted" : "Mic"}</span>
			</button>

			<div className="cc-footer-spacer" />

			{/* Right Side: Shell Controls */}
			<div className="cc-footer-actions">
				<button
					type="button"
					className="cc-footer-icon-btn"
					onClick={(e) => {
						e.stopPropagation();
						onRestartShell();
					}}
					title="Restart Orbix"
				>
					<RotateCw size={13} />
				</button>

				<button
					type="button"
					className="cc-footer-icon-btn"
					onClick={(e) => {
						e.stopPropagation();
						onOpenSettings();
					}}
					title="Orbix Settings"
				>
					<Settings size={13} />
				</button>
			</div>
		</div>
	);
});


