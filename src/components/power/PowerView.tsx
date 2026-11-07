import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Lock, Moon, RotateCcw, Power, Users } from "lucide-react";
import "./PowerView.css";

const HOLD_DURATION_MS = 1200;
const RADIUS = 20.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface PowerAction {
	id: "lock" | "sleep" | "restart" | "shutdown" | "switch_user";
	label: string;
	command: string;
	icon: typeof Lock;
	color: string;
	description: string;
	triggeredText: string;
}

const POWER_ACTIONS: PowerAction[] = [
	{
		id: "lock",
		label: "Lock",
		command: "power_lock",
		icon: Lock,
		color: "#0a84ff",
		description: "Hold to lock workstation",
		triggeredText: "Locking..."
	},
	{
		id: "sleep",
		label: "Sleep",
		command: "power_sleep",
		icon: Moon,
		color: "#bf5af2",
		description: "Hold to sleep",
		triggeredText: "Entering sleep..."
	},
	{
		id: "restart",
		label: "Restart",
		command: "power_restart",
		icon: RotateCcw,
		color: "#ff9f0a",
		description: "Hold to restart PC",
		triggeredText: "Restarting..."
	},
	{
		id: "shutdown",
		label: "Shutdown",
		command: "power_shutdown",
		icon: Power,
		color: "#ff453a",
		description: "Hold to shut down",
		triggeredText: "Shutting down..."
	},
	{
		id: "switch_user",
		label: "Switch",
		command: "power_switch_user",
		icon: Users,
		color: "#30d158",
		description: "Hold to switch user",
		triggeredText: "Switching user..."
	}
];

export function PowerView() {
	const [activeId, setActiveId] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const [triggeredId, setTriggeredId] = useState<string | null>(null);

	const animFrameRef = useRef<number | null>(null);
	const startTimeRef = useRef<number>(0);
	const isTriggeredRef = useRef(false);

	const cancelHold = useCallback(() => {
		if (isTriggeredRef.current) return;
		if (animFrameRef.current !== null) {
			cancelAnimationFrame(animFrameRef.current);
			animFrameRef.current = null;
		}
		setActiveId(null);
		setProgress(0);
	}, []);

	const executeAction = useCallback(async (action: PowerAction) => {
		isTriggeredRef.current = true;
		setTriggeredId(action.id);
		setProgress(1);

		try {
			await invoke(action.command);
		} catch (err) {
			console.error(`Failed to execute ${action.command}:`, err);
		}

		setTimeout(() => {
			isTriggeredRef.current = false;
			setTriggeredId(null);
			setActiveId(null);
			setProgress(0);
		}, 900);
	}, []);

	const startHold = useCallback(
		(action: PowerAction) => {
			if (isTriggeredRef.current) return;
			cancelHold();

			setActiveId(action.id);
			setProgress(0);
			startTimeRef.current = performance.now();

			const step = (now: number) => {
				const elapsed = now - startTimeRef.current;
				const currentProgress = Math.min(elapsed / HOLD_DURATION_MS, 1);
				setProgress(currentProgress);

				if (currentProgress >= 1) {
					animFrameRef.current = null;
					executeAction(action);
				} else {
					animFrameRef.current = requestAnimationFrame(step);
				}
			};

			animFrameRef.current = requestAnimationFrame(step);
		},
		[cancelHold, executeAction]
	);

	useEffect(() => {
		return () => {
			if (animFrameRef.current !== null) {
				cancelAnimationFrame(animFrameRef.current);
			}
		};
	}, []);

	const activeAction = POWER_ACTIONS.find((a) => a.id === activeId);
	const triggeredAction = POWER_ACTIONS.find((a) => a.id === triggeredId);

	const feedbackText = triggeredAction
		? triggeredAction.triggeredText
		: activeAction
			? activeAction.description
			: null;
	const feedbackClass = triggeredAction ? "is-triggered" : activeAction ? "is-holding" : "";

	return (
		<motion.div
			className="power-panel-content"
			onClick={(e) => e.stopPropagation()}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
			transition={{ type: "spring", stiffness: 400, damping: 30 }}
		>
			{feedbackText && (
				<div className="power-feedback-badge">
					<span className={`power-status-hint ${feedbackClass}`}>{feedbackText}</span>
				</div>
			)}

			<div className="power-actions-row">
				{POWER_ACTIONS.map((action) => {
					const Icon = action.icon;
					const isCurrentActive = activeId === action.id;
					const isCurrentTriggered = triggeredId === action.id;
					const currentProgress = isCurrentTriggered ? 1 : isCurrentActive ? progress : 0;
					const strokeDashoffset = CIRCUMFERENCE * (1 - currentProgress);

					return (
						<button
							key={action.id}
							className={`power-action-item ${isCurrentActive ? "holding" : ""} ${
								isCurrentTriggered ? "triggered" : ""
							}`}
							title={action.description}
							onPointerDown={(e) => {
								e.preventDefault();
								e.stopPropagation();
								startHold(action);
							}}
							onPointerUp={(e) => {
								e.stopPropagation();
								cancelHold();
							}}
							onPointerLeave={(e) => {
								e.stopPropagation();
								cancelHold();
							}}
							onPointerCancel={(e) => {
								e.stopPropagation();
								cancelHold();
							}}
							onContextMenu={(e) => e.preventDefault()}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									if (!isCurrentActive) startHold(action);
								}
							}}
							onKeyUp={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									cancelHold();
								}
							}}
						>
							<div className="power-btn-ring-wrapper">
								<svg className="power-ring-svg" viewBox="0 0 46 46">
									<circle
										className="power-ring-track"
										cx="23"
										cy="23"
										r={RADIUS}
									/>
									<circle
										className="power-ring-progress"
										cx="23"
										cy="23"
										r={RADIUS}
										stroke={action.color}
										strokeDasharray={CIRCUMFERENCE}
										strokeDashoffset={strokeDashoffset}
									/>
								</svg>

								<div className="power-btn-circle">
									<Icon size={16} strokeWidth={2.2} />
								</div>
							</div>

							<span className="power-action-label">{action.label}</span>
						</button>
					);
				})}
			</div>
		</motion.div>
	);
}

