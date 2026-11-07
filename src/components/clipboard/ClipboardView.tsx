import { useEffect, useMemo, useState } from "react";
import { Clipboard, Copy, Search, Trash2, X } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
	clearClipboardHistory,
	CLIPBOARD_CAPTURE_KEY,
	CLIPBOARD_HISTORY_EVENT,
	readClipboardHistory,
	removeClipboardEntry,
	type ClipboardEntry
} from "./clipboardStore";
import "./ClipboardView.css";

export function ClipboardView({ onClose }: { onClose: () => void }) {
	const [entries, setEntries] = useState<ClipboardEntry[]>(readClipboardHistory);
	const [search, setSearch] = useState("");
	const [captureEnabled, setCaptureEnabled] = useState(
		() => localStorage.getItem(CLIPBOARD_CAPTURE_KEY) !== "false"
	);
	const [copiedId, setCopiedId] = useState("");
	const filteredEntries = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return query ? entries.filter((entry) => entry.text.toLocaleLowerCase().includes(query)) : entries;
	}, [entries, search]);

	useEffect(() => {
		const refresh = () => setEntries(readClipboardHistory());
		window.addEventListener(CLIPBOARD_HISTORY_EVENT, refresh);
		return () => window.removeEventListener(CLIPBOARD_HISTORY_EVENT, refresh);
	}, []);

	const copyEntry = async (entry: ClipboardEntry) => {
		try {
			await writeText(entry.text);
			setCopiedId(entry.id);
			window.setTimeout(() => setCopiedId((current) => current === entry.id ? "" : current), 1200);
		} catch {
			setCopiedId("");
		}
	};

	const toggleCapture = () => {
		const next = !captureEnabled;
		setCaptureEnabled(next);
		localStorage.setItem(CLIPBOARD_CAPTURE_KEY, String(next));
	};

	return (
		<section className="clipboard-panel" aria-label="Clipboard history">
			<header className="clipboard-header">
				<div className="clipboard-title-group">
					<div className="clipboard-title-icon"><Clipboard size={17} /></div>
					<div><span className="clipboard-eyebrow">ON THIS DEVICE</span><h2>Clipboard</h2></div>
				</div>
				<div className="clipboard-header-actions">
					<button className="clipboard-clear" onClick={clearClipboardHistory} disabled={entries.length === 0}>Clear history</button>
					<button className="tasks-icon-button" onClick={onClose} aria-label="Close clipboard"><X size={16} /></button>
				</div>
			</header>
			<div className="clipboard-toolbar">
				<label className="clipboard-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search copied text" aria-label="Search clipboard history" /></label>
				<label className="clipboard-capture-toggle"><input type="checkbox" checked={captureEnabled} onChange={toggleCapture} /><span>Save copied text</span></label>
			</div>
			<div className="clipboard-list" role="list">
				{filteredEntries.length === 0 ? (
					<div className="clipboard-empty"><Clipboard size={20} /><span>{entries.length ? "No matching clipboard items." : "Copied text will appear here and stay after restart."}</span></div>
				) : filteredEntries.map((entry) => (
					<article className="clipboard-entry" key={entry.id} role="listitem">
						<button className="clipboard-entry-text" onClick={() => void copyEntry(entry)} title="Click to copy this item">
							<span>{entry.text}</span>
							<small>{new Date(entry.createdAt).toLocaleString()}</small>
						</button>
						<div className="clipboard-entry-actions">
							<span className="clipboard-copied" aria-live="polite">{copiedId === entry.id ? "Copied" : ""}</span>
							<button onClick={() => void copyEntry(entry)} aria-label="Copy clipboard item"><Copy size={14} /></button>
							<button onClick={() => removeClipboardEntry(entry.id)} aria-label="Remove clipboard item"><Trash2 size={14} /></button>
						</div>
					</article>
				))}
			</div>
			<footer className="clipboard-footer">Text history is stored locally. Maximum 30 items.</footer>
		</section>
	);
}

