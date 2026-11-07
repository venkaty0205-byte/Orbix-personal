import React from "react";
import { ChevronLeft, Bluetooth, ExternalLink } from "lucide-react";

interface BluetoothSubViewProps {
	bluetoothEnabled: boolean;
	onToggleBluetooth: () => void;
	onBack: () => void;
	onOpenSettings: () => void;
}

export const BluetoothSubView: React.FC<BluetoothSubViewProps> = ({
	bluetoothEnabled,
	onToggleBluetooth,
	onBack,
	onOpenSettings,
}) => {
	return (
		<div className="cc-subview-container">
			{/* Header */}
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
				<span className="cc-subview-title">Bluetooth</span>
				<div className="cc-subview-header-actions">
					<button
						type="button"
						className={`cc-subview-toggle-pill ${bluetoothEnabled ? "active" : ""}`}
						onClick={(e) => {
							e.stopPropagation();
							onToggleBluetooth();
						}}
						title={bluetoothEnabled ? "Turn Bluetooth Off" : "Turn Bluetooth On"}
					>
						{bluetoothEnabled ? "On" : "Off"}
					</button>
				</div>
			</div>

			{/* Body */}
			<div className="cc-subview-body">
				<div className="cc-subview-bt-card">
					<div className="cc-subview-bt-icon-row">
						<div className={`cc-subview-bt-icon-box ${bluetoothEnabled ? "active" : ""}`}>
							<Bluetooth size={20} />
						</div>
						<div>
							<h4 className="cc-subview-bt-title">
								{bluetoothEnabled ? "Bluetooth is On" : "Bluetooth is Off"}
							</h4>
							<p className="cc-subview-bt-subtitle">
								{bluetoothEnabled
									? "Your PC is discoverable by nearby devices"
									: "Turn on Bluetooth to connect wireless devices"}
							</p>
						</div>
					</div>

					<button
						type="button"
						className="cc-subview-settings-link"
						onClick={(e) => {
							e.stopPropagation();
							onOpenSettings();
						}}
					>
						<span>Manage Bluetooth in Windows Settings</span>
						<ExternalLink size={13} />
					</button>
				</div>
			</div>
		</div>
	);
};

