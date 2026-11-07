import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, RotateCw, Lock, Check } from "lucide-react";
import { SignalBarsIcon } from "./Icons";
import { WifiNetworkEntry } from "./types";

interface WifiSubViewProps {
	wifiEnabled: boolean;
	onToggleWifi: () => void;
	onBack: () => void;
	currentSsid?: string;
}

export const WifiSubView: React.FC<WifiSubViewProps> = ({
	wifiEnabled,
	onToggleWifi,
	onBack,
	currentSsid,
}) => {
	const [networks, setNetworks] = useState<WifiNetworkEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedSsid, setSelectedSsid] = useState<string | null>(null);
	const [password, setPassword] = useState("");
	const [connecting, setConnecting] = useState(false);
	const [connectError, setConnectError] = useState<string | null>(null);

	const scanNetworks = useCallback(async () => {
		if (!wifiEnabled) return;
		setLoading(true);
		try {
			const list = await invoke<WifiNetworkEntry[]>("get_available_wifi_networks");
			setNetworks(list);
		} catch (err) {
			console.error("Failed to scan wifi:", err);
		} finally {
			setLoading(false);
		}
	}, [wifiEnabled]);

	useEffect(() => {
		scanNetworks();
	}, [scanNetworks]);

	const handleConnect = async (ssid: string) => {
		setConnecting(true);
		setConnectError(null);
		try {
			const success = await invoke<boolean>("connect_wifi_network", {
				ssid,
				password: password || undefined,
			});
			if (success) {
				setSelectedSsid(null);
				setPassword("");
				// Refresh status
				setTimeout(() => scanNetworks(), 1500);
			} else {
				setConnectError("Could not connect to network");
			}
		} catch (err: any) {
			setConnectError(err?.message || "Failed to connect");
		} finally {
			setConnecting(false);
		}
	};

	return (
		<div className="cc-subview-container">
			{/* Sub-view Header */}
			<div className="cc-subview-header">
				<button
					type="button"
					className="cc-subview-back-btn"
					onClick={(e) => {
						e.stopPropagation();
						onBack();
					}}
					title="Back"
				>
					<ChevronLeft size={16} />
				</button>
				<span className="cc-subview-title">Wi-Fi</span>
				<div className="cc-subview-header-actions">
					<button
						type="button"
						className={`cc-subview-icon-btn ${loading ? "spinning" : ""}`}
						onClick={(e) => {
							e.stopPropagation();
							scanNetworks();
						}}
						title="Refresh Networks"
					>
						<RotateCw size={14} />
					</button>
					<button
						type="button"
						className={`cc-subview-toggle-pill ${wifiEnabled ? "active" : ""}`}
						onClick={(e) => {
							e.stopPropagation();
							onToggleWifi();
						}}
						title={wifiEnabled ? "Turn Wi-Fi Off" : "Turn Wi-Fi On"}
					>
						{wifiEnabled ? "On" : "Off"}
					</button>
				</div>
			</div>

			{/* Sub-view Content */}
			<div className="cc-subview-body">
				{!wifiEnabled ? (
					<div className="cc-subview-empty">
						<p>Wi-Fi is turned off</p>
						<button
							type="button"
							className="cc-subview-primary-btn"
							onClick={(e) => {
								e.stopPropagation();
								onToggleWifi();
							}}
						>
							Turn On
						</button>
					</div>
				) : loading && networks.length === 0 ? (
					<div className="cc-subview-loading">
						<RotateCw size={18} className="spinning" />
						<span>Scanning nearby networks...</span>
					</div>
				) : networks.length === 0 ? (
					<div className="cc-subview-empty">
						<p>No Wi-Fi networks found</p>
						<button
							type="button"
							className="cc-subview-ghost-btn"
							onClick={(e) => {
								e.stopPropagation();
								scanNetworks();
							}}
						>
							Scan Again
						</button>
					</div>
				) : (
					<div className="cc-networks-list">
						{networks.map((net) => {
							const isConnected = net.is_connected || (currentSsid && net.ssid.toLowerCase() === currentSsid.toLowerCase());
							const isSelected = selectedSsid === net.ssid;

							return (
								<div
									key={net.ssid}
									className={`cc-network-row ${isConnected ? "connected" : ""} ${isSelected ? "selected" : ""}`}
								>
									<div
										className="cc-network-main"
										onClick={(e) => {
											e.stopPropagation();
											if (!isConnected) {
												setSelectedSsid(isSelected ? null : net.ssid);
												setPassword("");
												setConnectError(null);
											}
										}}
									>
										<div className="cc-network-icon">
											<SignalBarsIcon percent={net.signal_percent} />
										</div>
										<div className="cc-network-info">
											<div className="cc-network-name-row">
												<span className="cc-network-ssid">{net.ssid}</span>
												{net.is_secure && <Lock size={11} className="cc-network-lock" />}
											</div>
											<span className="cc-network-meta">
												{isConnected ? "Connected" : `${net.signal_percent}% signal`}
											</span>
										</div>

										{isConnected ? (
											<div className="cc-network-badge">
												<Check size={12} />
												<span>Connected</span>
											</div>
										) : (
											<button
												type="button"
												className="cc-network-connect-btn"
												onClick={(e) => {
													e.stopPropagation();
													if (!net.is_secure) {
														handleConnect(net.ssid);
													} else {
														setSelectedSsid(isSelected ? null : net.ssid);
													}
												}}
											>
												Connect
											</button>
										)}
									</div>

									{/* Inline Password Entry if selected */}
									{isSelected && !isConnected && (
										<div className="cc-network-auth-box" onClick={(e) => e.stopPropagation()}>
											{net.is_secure ? (
												<input
													type="password"
													placeholder="Enter network security key"
													value={password}
													onChange={(e) => setPassword(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") handleConnect(net.ssid);
													}}
													autoFocus
													className="cc-network-pwd-input"
												/>
											) : (
												<p className="cc-network-open-note">This network is open and unsecured.</p>
											)}
											{connectError && <span className="cc-network-error">{connectError}</span>}
											<div className="cc-network-auth-actions">
												<button
													type="button"
													className="cc-network-cancel-btn"
													onClick={() => setSelectedSsid(null)}
												>
													Cancel
												</button>
												<button
													type="button"
													className="cc-network-join-btn"
													disabled={connecting || (net.is_secure && !password)}
													onClick={() => handleConnect(net.ssid)}
												>
													{connecting ? "Connecting..." : "Join"}
												</button>
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
};

