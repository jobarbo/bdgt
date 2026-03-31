import Dexie, {type Table} from "dexie";
import type {CategoryRule, MonthlyGoal, Transaction} from "../domain/types";

class BudgetDb extends Dexie {
	transactions!: Table<Transaction, number>;
	rules!: Table<CategoryRule, number>;
	goals!: Table<MonthlyGoal, number>;

	constructor() {
		super("budget-local-db");
		this.version(1).stores({
			transactions: "++id,fingerprint,date,category,source,description",
			rules: "++id,priority,pattern,category",
			goals: "++id,month",
		});
	}
}

export const db = new BudgetDb();
