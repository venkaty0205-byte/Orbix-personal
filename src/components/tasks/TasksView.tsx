import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bell, Check, Circle, Clock3, Plus, Trash2, X } from "lucide-react";
import "./TasksView.css";
import {
	TASK_REMINDER_DUE_EVENT,
	TASKS_UPDATED_EVENT,
	readTasks,
	type TaskReminder,
} from "./taskStore";

export function TasksView({ onClose }: { onClose?: () => void }) {
	const [tasks, setTasks] = useState<TaskReminder[]>(readTasks);
	const [title, setTitle] = useState("");
	const [dueAt, setDueAt] = useState("");
	const [now, setNow] = useState(Date.now());
	const pending = useMemo(
		() => tasks.filter((task) => !task.done).sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999")),
		[tasks]
	);
	const completed = tasks.filter((task) => task.done).length;

	useEffect(() => {
		const sync = () => setTasks(readTasks());
		window.addEventListener(TASKS_UPDATED_EVENT, sync);
		const clock = window.setInterval(() => setNow(Date.now()), 15_000);
		return () => {
			window.removeEventListener(TASKS_UPDATED_EVENT, sync);
			window.clearInterval(clock);
		};
	}, []);

	useEffect(() => {
		localStorage.setItem("orbix-individual-tasks", JSON.stringify(tasks));
	}, [tasks]);

	const addTask = (event: FormEvent) => {
		event.preventDefault();
		const cleanTitle = title.trim();
		if (!cleanTitle) return;
		setTasks((current) => [
			{ id: crypto.randomUUID(), title: cleanTitle, dueAt, done: false, reminded: false, alerting: false },
			...current
		]);
		setTitle("");
		setDueAt("");
	};

	const formatDue = (value: string) => {
		if (!value) return "No reminder set";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "Invalid date";
		return new Intl.DateTimeFormat(undefined, {
			weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
		}).format(date);
	};

	return (
		<section className="tasks-panel" aria-label="Tasks and reminders">
			<header className="tasks-header">
				<div><span className="tasks-eyebrow">YOUR SPACE</span><h2>Tasks &amp; reminders</h2></div>
				<button className="tasks-icon-button" onClick={onClose} aria-label="Close tasks"><X size={16} /></button>
			</header>
			<form className="tasks-form" onSubmit={addTask}>
				<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What do you need to do?" aria-label="Task name" maxLength={120} />
				<div className="tasks-form-bottom">
					<label className="tasks-due"><Clock3 size={14} /><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label="Reminder date and time" /></label>
					<button className="tasks-add" type="submit" disabled={!title.trim()}><Plus size={15} /> Add task</button>
				</div>
			</form>
			<div className="tasks-list">
				{pending.length === 0 ? <div className="tasks-empty"><Check size={18} /><span>Nothing pending. Add a task above.</span></div> : pending.map((task) => (
					<article className="task-row" key={task.id}>
						<button className="task-check" aria-label={`Complete ${task.title}`} onClick={() => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done: true, alerting: false } : item))}><Circle size={18} /></button>
						<div className="task-copy"><strong>{task.title}</strong><span className={task.dueAt && new Date(task.dueAt).getTime() <= now ? "task-due overdue" : "task-due"}>{task.dueAt ? <Bell size={12} /> : <Clock3 size={12} />}{formatDue(task.dueAt)}</span></div>
						<button className="task-delete" aria-label={`Delete ${task.title}`} onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))}><Trash2 size={14} /></button>
					</article>
				))}
			</div>
			<footer className="tasks-footer"><span>{pending.length} open</span><span>{completed} completed</span>{completed > 0 && <button onClick={() => setTasks((current) => current.filter((task) => !task.done))}>Clear done</button>}</footer>
		</section>
	);
}

// Keep reminders alive while the panel is closed. Each task rings once at a
// time; it rings again after snooze, or on the next app launch if it was active.
if (typeof window !== "undefined") {
	const triggeredThisSession = new Set<string>();
	window.setInterval(() => {
		const tasks = readTasks();
		const dueNow: TaskReminder[] = [];
		let changed = false;
		for (const task of tasks) {
			const dueTime = task.dueAt ? new Date(task.dueAt).getTime() : Number.NaN;
			const isDue = !task.done && !task.reminded && Number.isFinite(dueTime) && dueTime <= Date.now();
			if (!isDue) {
				if (!task.alerting) triggeredThisSession.delete(task.id);
				continue;
			}
			if (triggeredThisSession.has(task.id)) continue;
			triggeredThisSession.add(task.id);
			if (!task.alerting) {
				task.alerting = true;
				changed = true;
			}
			dueNow.push(task);
		}
		if (changed) {
			localStorage.setItem("orbix-individual-tasks", JSON.stringify(tasks));
			window.dispatchEvent(new Event(TASKS_UPDATED_EVENT));
		}
		for (const task of dueNow) {
			window.dispatchEvent(new CustomEvent<TaskReminder>(TASK_REMINDER_DUE_EVENT, { detail: task }));
		}
	}, 1000);
}

