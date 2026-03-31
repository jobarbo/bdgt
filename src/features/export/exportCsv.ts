import Papa from "papaparse";
import type {Transaction} from "../../domain/types";

export const exportTransactionsCsv = (transactions: Transaction[], filename: string): void => {
	const csv = Papa.unparse(
		transactions.map((tx) => ({
			date: tx.date,
			description: tx.description,
			amount: tx.amount,
			source: tx.source,
			category: tx.category,
			notes: tx.notes ?? "",
		})),
	);

	const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
};
