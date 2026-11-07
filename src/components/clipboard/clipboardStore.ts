export interface ClipboardEntry {
	id: string;
	text: string;
	createdAt: number;
}

export const CLIPBOARD_HISTORY_KEY = "orbix-clipboard-history";
export const CLIPBOARD_HISTORY_EVENT = "orbix-clipboard-history-updated";
export const CLIPBOARD_CAPTURE_KEY = "orbix-clipboard-capture";

const MAX_HISTORY_ITEMS = 30;
const MAX_CLIPBOARD_TEXT_LENGTH = 8_000;

export function readClipboardHistory(): ClipboardEntry[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(CLIPBOARD_HISTORY_KEY) || "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(item): item is ClipboardEntry =>
					!!item && typeof item === "object" && typeof item.id === "string" &&
					typeof item.text === "string" && typeof item.createdAt === "number"
			)
			.slice(0, MAX_HISTORY_ITEMS);
	} catch {
		return [];
	}
}

export function rememberClipboardText(rawText: string) {
	const text = rawText.trim();
	if (!text || text.length > MAX_CLIPBOARD_TEXT_LENGTH) return;
	const previous = readClipboardHistory();
	const existing = previous.find((item) => item.text === text);
	const next: ClipboardEntry[] = [
		{ id: existing?.id ?? crypto.randomUUID(), text, createdAt: Date.now() },
		...previous.filter((item) => item.text !== text)
	].slice(0, MAX_HISTORY_ITEMS);
	localStorage.setItem(CLIPBOARD_HISTORY_KEY, JSON.stringify(next));
	window.dispatchEvent(new Event(CLIPBOARD_HISTORY_EVENT));
}

export function removeClipboardEntry(id: string) {
	const next = readClipboardHistory().filter((item) => item.id !== id);
	localStorage.setItem(CLIPBOARD_HISTORY_KEY, JSON.stringify(next));
	window.dispatchEvent(new Event(CLIPBOARD_HISTORY_EVENT));
}

export function clearClipboardHistory() {
	localStorage.setItem(CLIPBOARD_HISTORY_KEY, "[]");
	window.dispatchEvent(new Event(CLIPBOARD_HISTORY_EVENT));
}

export function isClipboardCaptureEnabled() {
	return localStorage.getItem(CLIPBOARD_CAPTURE_KEY) !== "false";
}

export function setClipboardCaptureEnabled(enabled: boolean) {
	localStorage.setItem(CLIPBOARD_CAPTURE_KEY, String(enabled));
}

