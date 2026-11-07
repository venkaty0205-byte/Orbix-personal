export type TaskReminder = {
	id: string;
	title: string;
	dueAt: string;
	done: boolean;
	reminded: boolean;
	alerting: boolean;
};

export const TASK_STORAGE_KEY = "orbix-individual-tasks";
export const TASKS_UPDATED_EVENT = "orbix-tasks-updated";
export const TASK_REMINDER_DUE_EVENT = "orbix-task-reminder-due";

export function readTasks(): TaskReminder[] {
	try {
		const data: unknown = JSON.parse(localStorage.getItem(TASK_STORAGE_KEY) || "[]");
		if (!Array.isArray(data)) return [];
		return data
			.filter(
				(item): item is Record<string, unknown> =>
					!!item && typeof item === "object" &&
					typeof item.id === "string" && typeof item.title === "string"
			)
			.map((item) => ({
				id: item.id as string,
				title: item.title as string,
				dueAt: typeof item.dueAt === "string" ? item.dueAt : "",
				done: item.done === true,
				reminded: item.reminded === true,
				alerting: item.alerting === true
			}));
	} catch {
		return [];
	}
}

export function writeTasks(tasks: TaskReminder[]) {
	localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
}

export function notifyTasksUpdated() {
	window.dispatchEvent(new Event(TASKS_UPDATED_EVENT));
}

export function toLocalDateTimeInput(date: Date) {
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}

