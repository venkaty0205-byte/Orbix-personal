import { Palette, Droplet, Contrast, Droplets, Sun, Square, Maximize2 } from "lucide-react";
import { SettingRow } from "./SettingRow";

interface AppearanceTabProps {
	themeMode: string;
	handleThemeModeChange: (mode: string) => void;
	themeColor: string;
	handleThemeColorChange: (color: string) => void;
	themeOpacity: number;
	handleOpacityChange: (val: number) => void;
	notchOpacity: number;
	handleNotchOpacityChange: (val: number) => void;
	dockOpacity: number;
	handleDockOpacityChange: (val: number) => void;
	themeSaturation: number;
	handleSaturationChange: (val: number) => void;
	themeBrightness: number;
	handleBrightnessChange: (val: number) => void;
	cornersEnabled: boolean;
	toggleCorners: () => void;
	scale: number;
	handleScaleChange: (val: number) => void;
	notchScale: number;
	handleNotchScaleChange: (val: number) => void;
	dockScale: number;
	handleDockScaleChange: (val: number) => void;
}

export function AppearanceTab({
	themeMode,
	handleThemeModeChange,
	themeColor,
	handleThemeColorChange,
	notchOpacity,
	handleNotchOpacityChange,
	dockOpacity,
	handleDockOpacityChange,
	themeSaturation,
	handleSaturationChange,
	themeBrightness,
	handleBrightnessChange,
	cornersEnabled,
	toggleCorners,
	notchScale,
	handleNotchScaleChange,
	dockScale,
	handleDockScaleChange
}: AppearanceTabProps) {
	const showCustomColor = themeMode === "custom";
	const showAdvancedSliders = themeMode === "custom" || themeMode === "adaptive";

	return (
		<>
			<div className="setting-group-label">Theme</div>
			<div className="setting-group">
				<SettingRow icon={Palette} label="Theme Mode" desc="Configure visual styling">
					<select
						className="settings-select"
						value={themeMode}
						onChange={(e) => handleThemeModeChange(e.target.value)}
					>
						<option value="dark">Dark (Translucent)</option>
						<option value="light">Light (Translucent)</option>
						<option value="custom">Custom Color</option>
						<option value="adaptive">Adaptive Accent</option>
					</select>
				</SettingRow>

				{showCustomColor && (
					<SettingRow
						icon={Droplet}
						label="Custom Theme Color"
						desc="Choose layout background color"
					>
						<div className="color-picker-row">
							<input
								type="color"
								value={themeColor}
								onChange={(e) => handleThemeColorChange(e.target.value)}
								className="color-picker-input"
							/>
							<span className="color-picker-label">{themeColor.toUpperCase()}</span>
						</div>
					</SettingRow>
				)}

				<SettingRow
					icon={Contrast}
					label="Notch Background Opacity"
					desc={`Adjust notch transparency (${Math.round(notchOpacity * 100)}%)`}
				>
					<input
						type="range"
						min="0.1"
						max="1.0"
						step="0.05"
						value={notchOpacity}
						onChange={(e) => handleNotchOpacityChange(parseFloat(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>

				<SettingRow
					icon={Contrast}
					label="Dock Background Opacity"
					desc={`Adjust dock transparency (${Math.round(dockOpacity * 100)}%)`}
					divider={showAdvancedSliders}
				>
					<input
						type="range"
						min="0.1"
						max="1.0"
						step="0.05"
						value={dockOpacity}
						onChange={(e) => handleDockOpacityChange(parseFloat(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>

				{showAdvancedSliders && (
					<>
						<SettingRow
							icon={Droplets}
							label="Color Saturation"
							desc={`Adjust theme color vibrancy (${Math.round(themeSaturation * 100)}%)`}
						>
							<input
								type="range"
								min="0.0"
								max="1.0"
								step="0.02"
								value={themeSaturation}
								onChange={(e) => handleSaturationChange(parseFloat(e.target.value))}
								className="settings-slider"
							/>
						</SettingRow>

						<SettingRow
							icon={Sun}
							label="Background Brightness"
							desc={`Adjust background lightness (${Math.round(themeBrightness * 100)}%)`}
							divider={false}
						>
							<input
								type="range"
								min="0.0"
								max="1.0"
								step="0.02"
								value={themeBrightness}
								onChange={(e) => handleBrightnessChange(parseFloat(e.target.value))}
								className="settings-slider"
							/>
						</SettingRow>
					</>
				)}
			</div>

			<div className="setting-group-label">Display</div>
			<div className="setting-group">
				<SettingRow icon={Square} label="Screen Corners" desc="Rounded top edges">
					<label className="toggle-switch">
						<input type="checkbox" checked={cornersEnabled} onChange={toggleCorners} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Maximize2}
					label="Notch UI & Font Scale"
					desc={`Adjust notch size (${Math.round(notchScale * 100)}%)`}
				>
					<div className="scale-button-container">
						<button
							onClick={() => handleNotchScaleChange(Math.max(0.8, parseFloat((notchScale - 0.1).toFixed(1))))}
							disabled={notchScale <= 0.8}
							className="scale-adjust-btn"
							title="Decrease Notch Scale"
						>
							—
						</button>
						<span className="scale-display-value">{Math.round(notchScale * 100)}%</span>
						<button
							onClick={() => handleNotchScaleChange(Math.min(1.3, parseFloat((notchScale + 0.1).toFixed(1))))}
							disabled={notchScale >= 1.3}
							className="scale-adjust-btn"
							title="Increase Notch Scale"
						>
							+
						</button>
					</div>
				</SettingRow>

				<SettingRow
					icon={Maximize2}
					label="Dock UI & Font Scale"
					desc={`Adjust dock size (${Math.round(dockScale * 100)}%)`}
					divider={false}
				>
					<div className="scale-button-container">
						<button
							onClick={() => handleDockScaleChange(Math.max(0.8, parseFloat((dockScale - 0.1).toFixed(1))))}
							disabled={dockScale <= 0.8}
							className="scale-adjust-btn"
							title="Decrease Dock Scale"
						>
							—
						</button>
						<span className="scale-display-value">{Math.round(dockScale * 100)}%</span>
						<button
							onClick={() => handleDockScaleChange(Math.min(1.3, parseFloat((dockScale + 0.1).toFixed(1))))}
							disabled={dockScale >= 1.3}
							className="scale-adjust-btn"
							title="Increase Dock Scale"
						>
							+
						</button>
					</div>
				</SettingRow>
			</div>
		</>
	);
}

