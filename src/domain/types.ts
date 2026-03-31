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

export interface CustomCategory {
	name: string;
	createdAt: string;
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
	"Animaux",
	"Epicerie",
	"Resto",
	"Depanneur",
	"Essence",
	"Formation",
	"Informatique",
	"Maison",
	"Mecanique",
	"Musique",
	"Transport",
	"Abonnements",
	"Sante",
	"Pharmacie",
	"Soins personnels",
	"Telecom",
	"Loisirs",
	"Numerique",
	"Vetements",
	"Voyage",
	"Cadeaux",
	"Shopping",
	"Frais bancaires",
	"Impots",
	"Transferts",
	"Epargne",
	"Revenu",
	"Non classe",
] as const;

export const FIXED_CATEGORIES = new Set<string>(["Logement", "Abonnements", "Frais bancaires", "Impots"]);

export const sortCategories = (categories: string[]): string[] =>
	[...new Set(categories.map((category) => category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr-CA", {sensitivity: "base"}));
