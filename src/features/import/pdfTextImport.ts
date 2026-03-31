import type {Transaction} from "../../domain/types";
import {createFingerprint} from "./csvWealthsimple";

export interface PdfTextImportResult {
	transactions: Transaction[];
	errors: string[];
}

const monthMap: Record<string, number> = {
	jan: 0,
	january: 0,
	fev: 1,
	feb: 1,
	february: 1,
	mar: 2,
	march: 2,
	avr: 3,
	apr: 3,
	april: 3,
	may: 4,
	mai: 4,
	jun: 5,
	june: 5,
	jul: 6,
	july: 6,
	aou: 7,
	aug: 7,
	august: 7,
	sep: 8,
	sept: 8,
	september: 8,
	oct: 9,
	october: 9,
	nov: 10,
	november: 10,
	dec: 11,
	december: 11,
	decembre: 11,
};

const normalizeDate = (raw: string): string | null => {
	const value = raw.trim();
	if (!value) return null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return value;
	}

	const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (slash) {
		const day = Number.parseInt(slash[1], 10);
		const month = Number.parseInt(slash[2], 10);
		const year = Number.parseInt(slash[3], 10);
		const date = new Date(Date.UTC(year, month - 1, day));
		if (!Number.isNaN(date.getTime())) {
			return date.toISOString().slice(0, 10);
		}
	}

	const words = value.match(/^(\d{1,2})\s+([A-Za-z\u00C0-\u017F]+)\s+(\d{4})$/);
	if (words) {
		const day = Number.parseInt(words[1], 10);
		const monthWord = words[2].toLowerCase();
		const year = Number.parseInt(words[3], 10);
		const month = monthMap[monthWord];
		if (month !== undefined) {
			const date = new Date(Date.UTC(year, month, day));
			if (!Number.isNaN(date.getTime())) {
				return date.toISOString().slice(0, 10);
			}
		}
	}

	return null;
};

const parseAmount = (raw: string): number | null => {
	const cleaned = raw
		.trim()
		.replace(/\$/g, "")
		.replace(/,/g, "")
		.replace(/[()]/g, (m) => (m === "(" ? "-" : ""));

	const value = Number.parseFloat(cleaned);
	if (Number.isNaN(value)) return null;
	return value;
};

const amountTailRegex = /([+-]?\$?\d[\d,]*\.?\d{0,2})\s*$/;

const extractLineTransaction = (line: string): {date: string; description: string; amount: number} | null => {
	const compact = line.replace(/\s+/g, " ").trim();
	if (!compact) return null;

	if (/^as of\s+/i.test(compact) || /^transaction_date[,\s]/i.test(compact)) {
		return null;
	}

	const dateStart = compact.match(/^((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:\d{1,2}\s+[A-Za-z\u00C0-\u017F]+\s+\d{4}))\s+(.+)$/);
	if (!dateStart) return null;

	const normalizedDate = normalizeDate(dateStart[1]);
	if (!normalizedDate) return null;

	const rest = dateStart[2].trim();
	const amountMatch = rest.match(amountTailRegex);
	if (!amountMatch) return null;

	const amount = parseAmount(amountMatch[1]);
	if (amount === null) return null;

	const description = rest.slice(0, amountMatch.index).trim() || "Transaction PDF";
	return {
		date: normalizedDate,
		description,
		amount,
	};
};

export const parseWealthsimplePdfText = (rawText: string): PdfTextImportResult => {
	const lines = rawText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const transactions: Transaction[] = [];
	const errors: string[] = [];

	lines.forEach((line, idx) => {
		const parsed = extractLineTransaction(line);
		if (!parsed) {
			return;
		}

		const source = "wealthsimple" as const;
		transactions.push({
			date: parsed.date,
			description: parsed.description,
			amount: parsed.amount,
			source,
			category: "Non classe",
			createdAt: new Date().toISOString(),
			fingerprint: createFingerprint(parsed.date, parsed.description, parsed.amount, source),
		});

		if (!parsed.description) {
			errors.push(`Ligne ${idx + 1}: description vide.`);
		}
	});

	if (transactions.length === 0) {
		errors.push("Aucune ligne transaction reconnue.");
	}

	return {transactions, errors};
};
