

export function EthernetIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			{/* Monitor screen */}
			<rect x="2" y="3" width="20" height="13" rx="2" />
			{/* Monitor stand */}
			<path d="M12 16v3" />
			<path d="M8 21h8" />
			{/* Network cable plug indicator on bottom-right */}
			<path d="M18 12h2v4h-2" strokeWidth="1.8" />
			<circle cx="19" cy="14" r="0.8" fill="currentColor" />
		</svg>
	);
}

export function GlobeOffIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<line x1="2" y1="12" x2="22" y2="12" />
			<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
			<line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2.5" />
		</svg>
	);
}

export function SignalBarsIcon({ percent, size = 14 }: { percent: number; size?: number }) {
	const bars = percent > 75 ? 4 : percent > 50 ? 3 : percent > 25 ? 2 : 1;
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
			<rect x="1" y="11" width="2.5" height="4" rx="0.8" opacity={bars >= 1 ? 1 : 0.25} />
			<rect x="5" y="8" width="2.5" height="7" rx="0.8" opacity={bars >= 2 ? 1 : 0.25} />
			<rect x="9" y="5" width="2.5" height="10" rx="0.8" opacity={bars >= 3 ? 1 : 0.25} />
			<rect x="13" y="2" width="2.5" height="13" rx="0.8" opacity={bars >= 4 ? 1 : 0.25} />
		</svg>
	);
}


