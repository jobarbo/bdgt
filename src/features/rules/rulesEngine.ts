import type {CategoryRule, MatchType, Transaction} from "../../domain/types";

const normalize = (value: string): string => value.trim().toLowerCase();

const isMatch = (description: string, pattern: string, matchType: MatchType): boolean => {
	if (!pattern) return false;
	if (matchType === "startsWith") {
		return description.startsWith(pattern);
	}
	return description.includes(pattern);
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

export const applyRulesBulk = (transactions: Transaction[], rules: CategoryRule[]): Transaction[] => transactions.map((tx) => applyRulesToTransaction(tx, rules));
