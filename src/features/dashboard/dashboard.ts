import type {DashboardSummary, MonthlyGoal, Transaction} from "../../domain/types";
import {FIXED_CATEGORIES} from "../../domain/types";

export const monthKeyFromDate = (dateIso: string): string => dateIso.slice(0, 7);

const EXCLUDED_BUDGET_CATEGORIES = new Set<string>(["Transferts"]);

const isBudgetRelevant = (tx: Transaction): boolean => !EXCLUDED_BUDGET_CATEGORIES.has(tx.category);

export const summarizeMonth = (month: string, transactions: Transaction[]): DashboardSummary => {
	const monthTransactions = transactions.filter((tx) => monthKeyFromDate(tx.date) === month && isBudgetRelevant(tx));

	const income = monthTransactions.filter((tx) => tx.amount > 0).reduce((acc, tx) => acc + tx.amount, 0);

	const expenseAbs = monthTransactions.filter((tx) => tx.amount < 0).reduce((acc, tx) => acc + Math.abs(tx.amount), 0);

	const fixedExpenses = monthTransactions.filter((tx) => tx.amount < 0 && FIXED_CATEGORIES.has(tx.category)).reduce((acc, tx) => acc + Math.abs(tx.amount), 0);

	const variableExpenses = Math.max(expenseAbs - fixedExpenses, 0);

	return {
		month,
		income,
		expenses: expenseAbs,
		net: income - expenseAbs,
		fixedExpenses,
		variableExpenses,
	};
};

export const expensesByCategory = (month: string, transactions: Transaction[]): Array<{category: string; total: number}> => {
	const totals = new Map<string, number>();

	transactions
		.filter((tx) => monthKeyFromDate(tx.date) === month && tx.amount < 0 && isBudgetRelevant(tx))
		.forEach((tx) => {
			totals.set(tx.category, (totals.get(tx.category) ?? 0) + Math.abs(tx.amount));
		});

	return [...totals.entries()].map(([category, total]) => ({category, total})).sort((a, b) => b.total - a.total);
};

export const expensesByDescriptionForCategory = (month: string, transactions: Transaction[], category: string): Array<{description: string; total: number}> => {
	const totals = new Map<string, number>();

	transactions
		.filter((tx) => monthKeyFromDate(tx.date) === month && tx.amount < 0 && isBudgetRelevant(tx) && tx.category === category)
		.forEach((tx) => {
			totals.set(tx.description, (totals.get(tx.description) ?? 0) + Math.abs(tx.amount));
		});

	return [...totals.entries()].map(([description, total]) => ({description, total})).sort((a, b) => b.total - a.total);
};

export const getGoalForMonth = (month: string, goals: MonthlyGoal[]): MonthlyGoal | undefined => goals.find((goal) => goal.month === month);
