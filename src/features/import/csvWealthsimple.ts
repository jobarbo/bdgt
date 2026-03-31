import Papa from "papaparse";
import type {SourceType, Transaction} from "../../domain/types";

export interface ImportResult {
	inserted: number;
	duplicates: number;
	errors: string[];
	transactions: Transaction[];
}

const candidate = (row: Record<string, string>, keys: string[]): string => {
	for (const key of keys) {
		const found = Object.keys(row).find((k) => k.trim().toLowerCase() === key.toLowerCase());
		if (found && row[found]) {
			return row[found];
		}
	}
	return "";
};

const parseAmount = (raw: string): number | null => {
	const normalized = raw
		.trim()
		.replace(/\s/g, "")
		.replace(/\$/g, "")
		.replace("(", "-")
		.replace(")", "")
		.replace(/,(?=\d{1,2}$)/, ".");

	const cleaned = normalized.replace(/,/g, "");
	const sign = /\b(DB|DEBIT)\b/i.test(raw) ? -1 : /\b(CR|CREDIT)\b/i.test(raw) ? 1 : 0;
	const value = Number.parseFloat(cleaned);
	if (Number.isNaN(value)) return null;
	if (sign === 0) return value;
	return Math.abs(value) * sign;
};

const normalizeDate = (raw: string): string | null => {
	const value = raw.trim();
	if (!value) return null;

	const direct = new Date(value);
	if (!Number.isNaN(direct.getTime())) {
		return direct.toISOString().slice(0, 10);
	}

	const m = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
	if (!m) return null;

	const day = Number.parseInt(m[1], 10);
	const month = Number.parseInt(m[2], 10);
	let year = Number.parseInt(m[3], 10);
	if (year < 100) year += 2000;

	const safe = new Date(Date.UTC(year, month - 1, day));
	if (safe.getUTCFullYear() !== year || safe.getUTCMonth() !== month - 1 || safe.getUTCDate() !== day) {
		return null;
	}

	return safe.toISOString().slice(0, 10);
};

const buildDescription = (row: Record<string, string>): string => {
	const explicit = candidate(row, ["description", "merchant", "details", "libelle", "marchand", "name"]).trim();

	if (explicit) {
		return explicit;
	}

	const activitySubType = candidate(row, ["activity_sub_type", "activity subtype"]).trim();
	const activityType = candidate(row, ["activity_type", "activity type"]).trim();
	const symbol = candidate(row, ["symbol"]).trim();
	const accountType = candidate(row, ["account_type", "account type"]).trim();
	const accountId = candidate(row, ["account_id", "account id"]).trim();

	const details = [activitySubType || activityType || "ACTIVITY", symbol, accountType, accountId].filter(Boolean).join(" | ");

	return details || "Transaction Wealthsimple";
};

export const createFingerprint = (date: string, description: string, amount: number, source: SourceType): string => `${date}|${description.trim().toLowerCase()}|${amount.toFixed(2)}|${source}`;

export const parseWealthsimpleCsv = async (file: File): Promise<ImportResult> => {
	const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) => {
		Papa.parse<Record<string, string>>(file, {
			header: true,
			skipEmptyLines: true,
			delimiter: "",
			complete: resolve,
			error: reject,
		});
	});

	const transactions: Transaction[] = [];
	const errors: string[] = parsed.errors.map((err) => `CSV: ${err.message}`);

	parsed.data.forEach((row, idx) => {
		const date = candidate(row, ["date", "transaction date", "date de transaction", "posted date", "transaction_date", "settlement_date"]);
		const description = buildDescription(row);
		const categoryRaw = candidate(row, ["category", "categorie", "cat"]);
		const amountRaw = candidate(row, ["amount", "net amount", "value", "montant", "net_cash_amount", "quantity"]);

		if (!date || !amountRaw) {
			errors.push(`Ligne ${idx + 2}: colonnes manquantes.`);
			return;
		}

		const amount = parseAmount(amountRaw);
		if (amount === null) {
			errors.push(`Ligne ${idx + 2}: montant invalide (${amountRaw}).`);
			return;
		}

		const normalizedDate = normalizeDate(date);
		if (!normalizedDate) {
			errors.push(`Ligne ${idx + 2}: date invalide (${date}).`);
			return;
		}

		const source: SourceType = "wealthsimple";
		const category = categoryRaw.trim() || "Non classe";

		transactions.push({
			fingerprint: createFingerprint(normalizedDate, description, amount, source),
			date: normalizedDate,
			description: description.trim(),
			amount,
			source,
			category,
			createdAt: new Date().toISOString(),
		});
	});

	return {
		inserted: 0,
		duplicates: 0,
		errors,
		transactions,
	};
};
