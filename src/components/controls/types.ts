export type SubViewMode = "main" | "wifi" | "bluetooth";

export interface InternetStatus {
	connection_type: "ethernet" | "wifi" | "offline";
	label: string;
	is_connected: boolean;
	ethernet_connected: boolean;
	wifi_connected: boolean;
	wifi_enabled: boolean;
}

export interface WifiNetworkEntry {
	ssid: string;
	signal_percent: number;
	is_secure: boolean;
	is_connected: boolean;
}

export interface MicrophoneState {
	is_muted: boolean;
	device_name: string;
}

