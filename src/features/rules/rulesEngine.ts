import type {CategoryRule, MatchType, Transaction} from "../../domain/types";

const normalize = (value: string): string => value.trim().toLowerCase();

const isMatch = (description: string, pattern: string, matchType: MatchType): boolean => {
	if (!pattern) return false;
	if (matchType === "startsWith") {
		return description.startsWith(pattern);
	}
	return description.includes(pattern);
};

export const inferCategoryFromDescription = (description: string, amount: number): string => {
	const d = normalize(description);

	if (d.includes("transfer") || d.includes("e-transfer")) return "Transferts";
	if (d.includes("direct deposit") || d.includes("interest earned")) return "Revenu";
	if (d.includes("gumroad")) return "Numerique";
	if (d.includes("esso") || d.includes("shell") || d.includes("petro")) return "Essence";
	if (d.includes("rtc")) return "Transport";
	if (d.includes("denti")) return "Sante";
	if (d.includes("atelier signature")) return "Soins personnels";
	if (d.includes("antitube")) return "Loisirs";
	if (d.includes("couche-tard") || d.includes("proxi extra") || d.includes("accommodation cartier")) return "Depanneur";
	if (d.includes("brunet") || d.includes("jean coutu") || d.includes("pharmaprix")) return "Pharmacie";
	if (
		d.includes("restaurant") ||
		d.includes("tim hortons") ||
		d.includes("mcdonald") ||
		d.includes("starbucks") ||
		d.includes("subway") ||
		d.includes("sushi") ||
		d.includes("cedre") ||
		d.includes("topla") ||
		d.includes("a&w") ||
		d.includes("bistro") ||
		d.includes("l'oeufrier") ||
		d.includes("cafe morgane") ||
		d.includes("sapristi") ||
		d.includes("bati bassac") ||
		d.includes("la cabane a boucane") ||
		d.includes("pizza salvatore")
	) {
		return "Resto";
	}
	if (d.includes("supermarche") || d.includes("super c") || d.includes("maxi") || d.includes("iga") || d.includes("marche") || d.includes("alimentex")) {
		return "Epicerie";
	}
	if (d.includes("passe temps")) return "Loisirs";
	if (d.includes("amazon") || d.includes("instant comptant") || d.includes("dollarama")) return "Shopping";
	if (amount > 0) return "Revenu";
	return "Non classe";
};

export const applyRulesToTransaction = (transaction: Transaction, rules: CategoryRule[]): Transaction => {
	const description = normalize(transaction.description);
	const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

	for (const rule of sortedRules) {
		const rulePattern = normalize(rule.pattern);
		if (isMatch(description, rulePattern, rule.matchType)) {
			return {
				...transaction,
				category: rule.category,
			};
		}
	}

	return transaction;
};

export const categorizeTransaction = (transaction: Transaction, rules: CategoryRule[], options?: {preserveExistingCategory?: boolean}): Transaction => {
	const hasExplicitCategory = transaction.category.trim().length > 0 && transaction.category !== "Non classe";
	if (options?.preserveExistingCategory && hasExplicitCategory) {
		return transaction;
	}

	const inferredCategory = inferCategoryFromDescription(transaction.description, transaction.amount);
	const inferred = {
		...transaction,
		category: inferredCategory,
	};

	return applyRulesToTransaction(inferred, rules);
};

export const applyRulesBulk = (transactions: Transaction[], rules: CategoryRule[]): Transaction[] => transactions.map((tx) => applyRulesToTransaction(tx, rules));
