/**
 * High-performance launcher-grade fuzzy search algorithm.
 * Handles exact, prefix, word boundary, acronym (e.g. "vsc" -> "Visual Studio Code"),
 * contiguous substring, subsequence with boundary/compactness bonuses, and typo tolerance.
 */

export interface FuzzyResult {
	matches: boolean;
	score: number;
	matchedIndices: number[];
}

/**
 * Identify word boundary character indices in target.
 * Recognizes spaces, punctuation delimiters, and camelCase transitions.
 */
export function getWordBoundaries(text: string): number[] {
	const boundaries: number[] = [0];
	const len = text.length;
	const isDelim = (c: string) => /[\s\-_.\\/()[\]{}!?:;,+]/.test(c);

	for (let i = 1; i < len; i++) {
		const prev = text[i - 1];
		const curr = text[i];

		if (isDelim(prev) && !isDelim(curr)) {
			boundaries.push(i);
		} else if (
			// camelCase or PascalCase transition: e.g. "PowerShell" -> 'P', 'S'
			prev >= "a" &&
			prev <= "z" &&
			curr >= "A" &&
			curr <= "Z"
		) {
			boundaries.push(i);
		} else if (
			// Number transition: e.g. "Python3" -> 'P', '3'
			((prev < "0" || prev > "9") && curr >= "0" && curr <= "9") ||
			(prev >= "0" && prev <= "9" && ((curr >= "a" && curr <= "z") || (curr >= "A" && curr <= "Z")))
		) {
			boundaries.push(i);
		}
	}
	return boundaries;
}

/**
 * Computes Damerau-Levenshtein distance (allows insertion, deletion, substitution, and transposition).
 */
function damerauLevenshtein(a: string, b: string): number {
	const la = a.length;
	const lb = b.length;
	if (Math.abs(la - lb) > 2) return 999;

	const d: number[][] = [];
	for (let i = 0; i <= la; i++) {
		d[i] = [i];
	}
	for (let j = 0; j <= lb; j++) {
		d[0][j] = j;
	}

	for (let i = 1; i <= la; i++) {
		for (let j = 1; j <= lb; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(
				d[i - 1][j] + 1, // deletion
				d[i][j - 1] + 1, // insertion
				d[i - 1][j - 1] + cost // substitution
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
			}
		}
	}
	return d[la][lb];
}

/**
 * Match a single term against target string.
 */
function matchSingleTerm(pattern: string, target: string): FuzzyResult {
	const p = pattern.toLowerCase();
	const t = target.toLowerCase();
	const pLen = p.length;
	const tLen = t.length;

	if (pLen === 0) {
		return { matches: true, score: 0, matchedIndices: [] };
	}
	if (tLen === 0) {
		return { matches: false, score: 0, matchedIndices: [] };
	}

	// 1. Exact Match
	if (t === p) {
		const matchedIndices = Array.from({ length: tLen }, (_, i) => i);
		return { matches: true, score: 1000, matchedIndices };
	}

	// 2. Exact Prefix Match
	if (t.startsWith(p)) {
		const matchedIndices = Array.from({ length: pLen }, (_, i) => i);
		const score = 750 - Math.min(100, (tLen - pLen) * 2);
		return { matches: true, score, matchedIndices };
	}

	const wordBoundaries = getWordBoundaries(target);
	const wbSet = new Set(wordBoundaries);

	// 3. Word Boundary Starts (e.g. "Visual Studio Code" with pattern "code")
	let bestWbScore = -1;
	let bestWbIndices: number[] = [];
	for (const b of wordBoundaries) {
		if (t.slice(b).startsWith(p)) {
			const score = 600 - Math.min(80, b * 4) - Math.min(80, (tLen - pLen) * 2);
			if (score > bestWbScore) {
				bestWbScore = score;
				bestWbIndices = Array.from({ length: pLen }, (_, i) => b + i);
			}
		}
	}
	if (bestWbScore > 0) {
		return { matches: true, score: bestWbScore, matchedIndices: bestWbIndices };
	}

	// 4. Acronym Matching (e.g. "vsc" -> "Visual Studio Code", "ps" -> "PowerShell")
	if (pLen <= wordBoundaries.length && pLen >= 2) {
		let pIdx = 0;
		const acronymIndices: number[] = [];
		for (const b of wordBoundaries) {
			if (t[b] === p[pIdx]) {
				acronymIndices.push(b);
				pIdx++;
				if (pIdx === pLen) break;
			}
		}
		if (pIdx === pLen) {
			const score = 520 - Math.min(100, (tLen - pLen) * 2);
			return { matches: true, score, matchedIndices: acronymIndices };
		}
	}

	// 5. Contiguous Substring Match (e.g. "term" in "Windows Terminal")
	const subIdx = t.indexOf(p);
	if (subIdx !== -1) {
		const isAtBoundary = wbSet.has(subIdx);
		const score = 420 + (isAtBoundary ? 60 : 0) - Math.min(100, subIdx * 5) - Math.min(80, (tLen - pLen) * 2);
		const matchedIndices = Array.from({ length: pLen }, (_, i) => subIdx + i);
		return { matches: true, score, matchedIndices };
	}

	// 6. Subsequence Matching with Compactness and Boundary Bonuses
	let tIdx = 0;
	let pIdx = 0;
	const subseqIndices: number[] = [];
	let consecutiveCount = 0;
	let totalBonus = 0;
	let lastMatchIdx = -1;

	while (tIdx < tLen && pIdx < pLen) {
		if (t[tIdx] === p[pIdx]) {
			subseqIndices.push(tIdx);
			if (wbSet.has(tIdx)) {
				totalBonus += 25; // word start bonus
			}
			if (lastMatchIdx !== -1) {
				const gap = tIdx - lastMatchIdx - 1;
				if (gap === 0) {
					consecutiveCount++;
					totalBonus += 15 * consecutiveCount;
				} else {
					consecutiveCount = 0;
					totalBonus -= Math.min(30, gap * 3); // gap penalty
				}
			}
			lastMatchIdx = tIdx;
			pIdx++;
		}
		tIdx++;
	}

	if (pIdx === pLen) {
		const score = Math.max(80, 260 + totalBonus - Math.min(80, (tLen - pLen) * 2));
		return { matches: true, score, matchedIndices: subseqIndices };
	}

	// 7. Typo Tolerance via Damerau-Levenshtein
	// Only run if pattern length >= 3 to prevent noise on 1 or 2 characters
	if (pLen >= 3) {
		const maxDistance = pLen <= 5 ? 1 : 2;
		// Check against individual words
		const words: { word: string; start: number }[] = [];
		for (let i = 0; i < wordBoundaries.length; i++) {
			const start = wordBoundaries[i];
			const end = i + 1 < wordBoundaries.length ? wordBoundaries[i + 1] : tLen;
			const raw = target.slice(start, end).replace(/[\s\-_.\\/()[\]{}!?:;,+]+$/, "");
			if (raw.length > 0) {
				words.push({ word: raw.toLowerCase(), start });
			}
		}

		let bestDist = 999;
		let bestWordStart = 0;
		let bestWordLen = 0;

		for (const { word, start } of words) {
			const dist = damerauLevenshtein(p, word);
			if (dist <= maxDistance && dist < bestDist) {
				bestDist = dist;
				bestWordStart = start;
				bestWordLen = word.length;
			}
		}

		// Also check against whole target if target is compact
		if (tLen <= pLen + 3) {
			const wholeDist = damerauLevenshtein(p, t);
			if (wholeDist <= maxDistance && wholeDist < bestDist) {
				bestDist = wholeDist;
				bestWordStart = 0;
				bestWordLen = tLen;
			}
		}

		if (bestDist <= maxDistance) {
			const score = Math.max(30, 140 - bestDist * 40 - Math.min(40, (tLen - pLen) * 2));
			const matchedIndices = Array.from({ length: bestWordLen }, (_, i) => bestWordStart + i);
			return { matches: true, score, matchedIndices };
		}
	}

	return { matches: false, score: 0, matchedIndices: [] };
}

/**
 * Match pattern (which may have multiple whitespace-separated tokens) against target,
 * with optional secondary target (e.g. executable name, file path, tag).
 */
export function fuzzyMatch(
	pattern: string,
	target: string,
	secondaryTarget?: string | null
): FuzzyResult {
	const trimmed = pattern.trim();
	if (!trimmed) {
		return { matches: true, score: 0, matchedIndices: [] };
	}

	const tokens = trimmed.split(/\s+/).filter(Boolean);

	if (tokens.length === 1) {
		const primary = matchSingleTerm(tokens[0], target);
		if (primary.matches) {
			return primary;
		}
		if (secondaryTarget) {
			const secondary = matchSingleTerm(tokens[0], secondaryTarget);
			if (secondary.matches) {
				return {
					matches: true,
					score: Math.max(10, secondary.score - 45),
					matchedIndices: []
				};
			}
		}
		return { matches: false, score: 0, matchedIndices: [] };
	}

	// Multi-token match: every token must match either target or secondaryTarget
	let totalScore = 0;
	const combinedIndices = new Set<number>();

	for (const token of tokens) {
		const res = matchSingleTerm(token, target);
		if (res.matches) {
			totalScore += res.score;
			res.matchedIndices.forEach((idx) => combinedIndices.add(idx));
		} else if (secondaryTarget) {
			const secRes = matchSingleTerm(token, secondaryTarget);
			if (secRes.matches) {
				totalScore += Math.max(10, secRes.score - 45);
			} else {
				return { matches: false, score: 0, matchedIndices: [] };
			}
		} else {
			return { matches: false, score: 0, matchedIndices: [] };
		}
	}

	return {
		matches: true,
		score: Math.round(totalScore / tokens.length),
		matchedIndices: Array.from(combinedIndices).sort((a, b) => a - b)
	};
}

