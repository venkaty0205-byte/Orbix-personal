import { useState } from "react";
import { Bell, Clock3 } from "lucide-react";
import type { TaskReminder } from "./taskStore";

interface TaskAlarmPopupProps {
	task: TaskReminder;
	onDismiss: () => void;
	onSnooze: (minutes: number) => void;
}

export function TaskAlarmPopup({ task, onDismiss, onSnooze }: TaskAlarmPopupProps) {
	const [minutes, setMinutes] = useState(5);
	return (
		<div className="task-alarm-backdrop" role="presentation">
			<section className="task-alarm-card" role="alertdialog" aria-modal="true" aria-label="Task reminder">
				<div className="task-alarm-icon"><Bell size={19} /></div>
				<span className="task-alarm-eyebrow">REMINDER</span>
				<h2>{task.title}</h2>
				<p>It’s time for this task.</p>
				<div className="task-alarm-actions">
					<label className="task-snooze-select">
						<Clock3 size={14} />
						<span>Snooze</span>
						<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
							{[5, 10, 15, 20, 30, 60].map((value) => (
								<option key={value} value={value}>{value} min</option>
							))}
						</select>
					</label>
					<button className="task-alarm-snooze" onClick={() => onSnooze(minutes)}>Snooze</button>
					<button className="task-alarm-dismiss" onClick={onDismiss}>Dismiss</button>
				</div>
			</section>
		</div>
	);
}

