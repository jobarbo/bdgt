export type SourceType = "wealthsimple" | "bmo-manual";

export type MatchType = "contains" | "startsWith";

export interface Transaction {
	id?: number;
	fingerprint: string;
	date: string;
	description: string;
	amount: number;
	source: SourceType;
	category: string;
	notes?: string;
	createdAt: string;
}

export interface CategoryRule {
	id?: number;
	pattern: string;
	matchType: MatchType;
	category: string;
	priority: number;
}

export interface MonthlyGoal {
	id?: number;
	month: string;
	targetSavings: number;
}

export interface DashboardSummary {
	month: string;
	income: number;
	expenses: number;
	net: number;
	fixedExpenses: number;
	variableExpenses: number;
}

export const DEFAULT_CATEGORIES = [
	"Logement",
	"Alimentation",
	"Epicerie",
	"Resto",
	"Depanneur",
	"Essence",
	"Transport",
	"Abonnements",
	"Sante",
	"Pharmacie",
	"Soins personnels",
	"Loisirs",
	"Numerique",
	"Shopping",
	"Frais bancaires",
	"Impots",
	"Transferts",
	"Epargne",
	"Revenu",
	"Non classe",
] as const;

export const FIXED_CATEGORIES = new Set<string>(["Logement", "Abonnements", "Frais bancaires", "Impots"]);
