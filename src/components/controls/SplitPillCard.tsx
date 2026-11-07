import React from "react";
import { ChevronRight } from "lucide-react";

interface SplitPillCardProps {
	icon: React.ReactNode;
	title: string;
	status: string;
	isActive: boolean;
	onToggle: () => void;
	onOpenSubView: () => void;
	onContextMenu?: (e: React.MouseEvent) => void;
	toggleTitle?: string;
	subViewTitle?: string;
}

export const SplitPillCard: React.FC<SplitPillCardProps> = React.memo(({
	icon,
	title,
	status,
	isActive,
	onToggle,
	onOpenSubView,
	onContextMenu,
	toggleTitle,
	subViewTitle,
}) => {
	return (
		<div className={`cc-split-card ${isActive ? "active" : ""}`} onContextMenu={onContextMenu}>
			{/* Left partition: Toggle action & info */}
			<button
				type="button"
				className="cc-split-main-btn"
				onClick={(e) => {
					e.stopPropagation();
					onToggle();
				}}
				title={toggleTitle || `Toggle ${title}`}
			>
				<div className="cc-split-icon-wrapper">{icon}</div>
				<div className="cc-split-text">
					<span className="cc-split-title">{title}</span>
					<span className="cc-split-status">{status}</span>
				</div>
			</button>

			{/* Divider */}
			<div className="cc-split-divider" />

			{/* Right partition: Open in-notch sub-page */}
			<button
				type="button"
				className="cc-split-arrow-btn"
				onClick={(e) => {
					e.stopPropagation();
					onOpenSubView();
				}}
				title={subViewTitle || `Open ${title} Details`}
			>
				<ChevronRight size={14} className="cc-split-chevron" />
			</button>
		</div>
	);
});

