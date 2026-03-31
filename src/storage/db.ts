import Dexie, {type Table} from "dexie";
import type {CategoryRule, CustomCategory, MonthlyGoal, Transaction} from "../domain/types";

class BudgetDb extends Dexie {
	transactions!: Table<Transaction, number>;
	rules!: Table<CategoryRule, number>;
	goals!: Table<MonthlyGoal, number>;
	categories!: Table<CustomCategory, string>;

	constructor() {
		super("budget-local-db");
		this.version(1).stores({
			transactions: "++id,fingerprint,date,category,source,description",
			rules: "++id,priority,pattern,category",
			goals: "++id,month",
		});
		this.version(2).stores({
			transactions: "++id,fingerprint,date,category,source,description",
			rules: "++id,priority,pattern,category",
			goals: "++id,month",
			categories: "&name,createdAt",
		});
	}
}

export const db = new BudgetDb();
