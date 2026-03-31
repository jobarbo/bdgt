import Chart from "chart.js/auto";
import "./style.css";
import {DEFAULT_CATEGORIES, type CategoryRule, type MonthlyGoal, type Transaction} from "./domain/types";
import {summarizeMonth, expensesByCategory, expensesByDescriptionForCategory} from "./features/dashboard/dashboard";
import {exportTransactionsCsv} from "./features/export/exportCsv";
import {parseWealthsimpleCsv, createFingerprint} from "./features/import/csvWealthsimple";
import {parseWealthsimplePdfText} from "./features/import/pdfTextImport";
import {applyRulesToTransaction} from "./features/rules/rulesEngine";
import {db} from "./storage/db";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
	throw new Error("Element #app introuvable");
}

const nowMonth = new Date().toISOString().slice(0, 7);

let transactions: Transaction[] = [];
let rules: CategoryRule[] = [];
let goals: MonthlyGoal[] = [];
let activeMonth = nowMonth;
let categoryChart: Chart<"bar"> | null = null;
let categoryDetailChart: Chart<"bar"> | null = null;
let selectedCategoryDrilldown: string | null = null;

const formatMoney = (value: number): string => new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD"}).format(value);

const toInputDate = (value: string): string => {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return value;
	}
	return new Date().toISOString().slice(0, 10);
};

const renderLayout = (): void => {
	app.innerHTML = `
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Budget Local</p>
          <h1>Ou va ton argent chaque mois</h1>
          <p class="subtitle">Importe CSV Wealthsimple, ou colle le texte extrait du PDF, puis ajoute tes transactions BMO sans cloud.</p>
        </div>
        <div class="hero-actions">
          <button id="import-btn" class="btn alt" type="button">Importer CSV</button>
          <input id="csv-input" class="visually-hidden" type="file" accept=".csv,text/csv" />
          <button id="export-btn" class="btn">Exporter CSV</button>
        </div>
      </header>

      <section class="panel controls">
        <div class="control">
          <label for="month-select">Mois</label>
          <input id="month-select" type="month" value="${activeMonth}" />
        </div>
        <div class="control">
          <label for="search-input">Recherche</label>
          <input id="search-input" type="text" placeholder="Marchand, description..." />
        </div>
        <div class="control">
          <label for="category-filter">Categorie</label>
          <select id="category-filter">
            <option value="all">Toutes</option>
            ${DEFAULT_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
          </select>
        </div>
      </section>

      <section class="grid stats" id="stats-cards"></section>

      <section class="grid two-col">
        <article class="panel">
          <h2>Depenses par categorie</h2>
          <p class="muted">Clique une categorie pour voir le detail par marchand.</p>
          <canvas id="category-chart" height="160"></canvas>
          <div class="section-head subchart-head">
            <h3 id="category-detail-title">Detail de categorie</h3>
            <button id="clear-category-detail" class="btn alt compact" type="button" hidden>Reinitialiser</button>
          </div>
          <p id="category-detail-summary" class="muted">Clique une barre du graphique ci-dessus.</p>
          <canvas id="category-detail-chart" height="150"></canvas>
        </article>
        <article class="panel">
          <h2>Objectif d epargne</h2>
          <form id="goal-form" class="inline-form">
            <input id="goal-value" type="number" min="0" step="10" placeholder="Objectif mensuel CAD" />
            <button class="btn" type="submit">Enregistrer</button>
          </form>
          <p id="goal-status" class="muted"></p>
        </article>
      </section>

      <section class="grid two-col">
        <article class="panel">
          <h2>Saisie rapide BMO</h2>
          <form id="manual-form" class="stack-form">
            <input id="manual-date" type="date" value="${new Date().toISOString().slice(0, 10)}" required />
            <input id="manual-description" type="text" placeholder="Description" required />
            <input id="manual-amount" type="number" step="0.01" placeholder="Montant (depense negative)" required />
            <select id="manual-category">
              ${DEFAULT_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
            </select>
            <button class="btn" type="submit">Ajouter transaction</button>
          </form>
        </article>

        <article class="panel">
          <h2>Import PDF Wealthsimple</h2>
          <form id="pdf-text-form" class="stack-form">
            <textarea id="pdf-text-input" rows="7" placeholder="Colle ici le texte copie depuis ton PDF Wealthsimple"></textarea>
            <button class="btn alt" type="submit">Importer texte PDF</button>
          </form>
          <p class="muted">Astuce: ouvre le PDF, selectionne le tableau des transactions, copie-colle ici.</p>
        </article>
      </section>

      <section class="grid two-col">
        <article class="panel">
          <h2>Regles de categorisation</h2>
          <form id="rule-form" class="stack-form small-gap">
            <input id="rule-pattern" type="text" placeholder="Mot-cle (ex: uber)" required />
            <select id="rule-match">
              <option value="contains">Contient</option>
              <option value="startsWith">Commence par</option>
            </select>
            <select id="rule-category">
              ${DEFAULT_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
            </select>
            <input id="rule-priority" type="number" value="10" min="1" max="999" required />
            <div class="split-actions">
              <button class="btn" type="submit">Ajouter regle</button>
              <button id="apply-rules-btn" class="btn alt" type="button">Re-categoriser mois</button>
            </div>
          </form>
          <ul id="rules-list" class="compact-list"></ul>
        </article>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>Transactions du mois</h2>
          <button id="clear-all-btn" class="btn danger" type="button">Effacer tout</button>
        </div>
        <p id="import-feedback" class="muted"></p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Montant</th>
                <th>Categorie</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="transactions-body"></tbody>
          </table>
        </div>
      </section>
    </main>
  `;
};

const readFilters = (): {text: string; category: string} => {
	const text = (document.querySelector<HTMLInputElement>("#search-input")?.value ?? "").trim().toLowerCase();
	const category = document.querySelector<HTMLSelectElement>("#category-filter")?.value ?? "all";
	return {text, category};
};

const monthTransactions = (): Transaction[] => transactions.filter((tx) => tx.date.startsWith(activeMonth));

const filteredTransactions = (): Transaction[] => {
	const {text, category} = readFilters();
	return monthTransactions().filter((tx) => {
		const matchText = text.length === 0 || tx.description.toLowerCase().includes(text);
		const matchCategory = category === "all" || tx.category === category;
		return matchText && matchCategory;
	});
};

const renderRules = (): void => {
	const list = document.querySelector<HTMLUListElement>("#rules-list");
	if (!list) return;
	const sorted = [...rules].sort((a, b) => a.priority - b.priority);
	list.innerHTML = sorted.map((rule) => `<li><strong>${rule.pattern}</strong> -> ${rule.category} (${rule.matchType}, p${rule.priority})</li>`).join("");
};

const renderTransactions = (): void => {
	const body = document.querySelector<HTMLTableSectionElement>("#transactions-body");
	if (!body) return;

	const rows = filteredTransactions();
	const categoryOptions = DEFAULT_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join("");
	body.innerHTML = rows
		.slice(0, 300)
		.map(
			(tx) => `<tr>
        <td>${tx.date}</td>
        <td>${tx.description}</td>
        <td class="${tx.amount < 0 ? "neg" : "pos"}">${formatMoney(tx.amount)}</td>
        <td>
          ${
						tx.id
							? `<select class="table-category-select" data-action="change-category" data-id="${tx.id}">
                ${categoryOptions}
              </select>`
							: tx.category
					}
        </td>
        <td>${tx.source}</td>
        <td>
          ${tx.id ? `<button class="btn danger compact" type="button" data-action="delete-transaction" data-id="${tx.id}">Effacer</button>` : '<span class="muted">-</span>'}
        </td>
      </tr>`,
		)
		.join("");

	rows.forEach((tx) => {
		if (!tx.id) return;
		const select = body.querySelector<HTMLSelectElement>(`select[data-action="change-category"][data-id="${tx.id}"]`);
		if (select) {
			select.value = tx.category;
		}
	});
};

const renderStats = (): void => {
	const summary = summarizeMonth(activeMonth, transactions);
	const cardHost = document.querySelector<HTMLDivElement>("#stats-cards");
	if (!cardHost) return;

	cardHost.innerHTML = `
    <article class="card"><p>Revenus</p><h3>${formatMoney(summary.income)}</h3></article>
    <article class="card"><p>Depenses</p><h3>${formatMoney(summary.expenses)}</h3></article>
    <article class="card"><p>Net</p><h3>${formatMoney(summary.net)}</h3></article>
    <article class="card"><p>Fixe vs variable</p><h3>${formatMoney(summary.fixedExpenses)} / ${formatMoney(summary.variableExpenses)}</h3></article>
  `;

	const monthGoal = goals.find((goal) => goal.month === activeMonth);
	const goalStatus = document.querySelector<HTMLParagraphElement>("#goal-status");
	if (goalStatus) {
		if (!monthGoal) {
			goalStatus.textContent = "Aucun objectif defini pour ce mois.";
		} else {
			const progress = summary.net / monthGoal.targetSavings;
			const bounded = Math.max(0, Math.min(progress, 1));
			goalStatus.textContent = `Objectif: ${formatMoney(monthGoal.targetSavings)} | Realise: ${formatMoney(summary.net)} (${Math.round(bounded * 100)}%)`;
		}
	}
};

const renderChart = (): void => {
	const ctx = document.querySelector<HTMLCanvasElement>("#category-chart");
	if (!ctx) return;

	const byCategory = expensesByCategory(activeMonth, transactions).slice(0, 8);

	if (selectedCategoryDrilldown && !byCategory.some((item) => item.category === selectedCategoryDrilldown)) {
		selectedCategoryDrilldown = null;
	}

	if (categoryChart) {
		categoryChart.destroy();
	}

	categoryChart = new Chart(ctx, {
		type: "bar",
		data: {
			labels: byCategory.map((item) => item.category),
			datasets: [
				{
					label: "Depenses CAD",
					data: byCategory.map((item) => item.total),
					backgroundColor: ["#f38d68", "#ffbc42", "#5f0f40", "#0f4c5c", "#9a031e", "#619b8a", "#457b9d", "#bc4749"],
					borderRadius: 8,
				},
			],
		},
		options: {
			responsive: true,
			onClick: (_event, elements) => {
				if (elements.length === 0) return;
				const clicked = byCategory[elements[0].index];
				if (!clicked) return;
				selectedCategoryDrilldown = clicked.category === selectedCategoryDrilldown ? null : clicked.category;
				renderCategoryDetailChart();
			},
			plugins: {
				legend: {display: false},
			},
			scales: {
				y: {
					ticks: {
						callback: (value) => formatMoney(Number(value)),
					},
				},
			},
		},
	});
};

const renderCategoryDetailChart = (): void => {
	const detailCanvas = document.querySelector<HTMLCanvasElement>("#category-detail-chart");
	const title = document.querySelector<HTMLHeadingElement>("#category-detail-title");
	const summary = document.querySelector<HTMLParagraphElement>("#category-detail-summary");
	const clearBtn = document.querySelector<HTMLButtonElement>("#clear-category-detail");
	if (!detailCanvas || !title || !summary || !clearBtn) return;

	if (categoryDetailChart) {
		categoryDetailChart.destroy();
		categoryDetailChart = null;
	}

	if (!selectedCategoryDrilldown) {
		title.textContent = "Detail de categorie";
		summary.textContent = "Clique une barre du graphique ci-dessus.";
		clearBtn.hidden = true;
		return;
	}

	const breakdown = expensesByDescriptionForCategory(activeMonth, transactions, selectedCategoryDrilldown).slice(0, 8);
	if (breakdown.length === 0) {
		title.textContent = `Detail: ${selectedCategoryDrilldown}`;
		summary.textContent = "Aucune depense detaillee disponible pour cette categorie.";
		clearBtn.hidden = false;
		return;
	}

	const total = breakdown.reduce((sum, item) => sum + item.total, 0);
	const top = breakdown[0];
	const ratio = total > 0 ? Math.round((top.total / total) * 100) : 0;

	title.textContent = `Detail: ${selectedCategoryDrilldown}`;
	summary.textContent = `${top.description} represente ${formatMoney(top.total)} sur ${formatMoney(total)} (${ratio}%).`;
	clearBtn.hidden = false;

	categoryDetailChart = new Chart(detailCanvas, {
		type: "bar",
		data: {
			labels: breakdown.map((item) => item.description),
			datasets: [
				{
					label: "Depenses CAD",
					data: breakdown.map((item) => item.total),
					backgroundColor: "#0f4c5c",
					borderRadius: 8,
				},
			],
		},
		options: {
			responsive: true,
			plugins: {
				legend: {display: false},
			},
			scales: {
				x: {
					ticks: {
						maxRotation: 0,
						minRotation: 0,
					},
				},
				y: {
					ticks: {
						callback: (value) => formatMoney(Number(value)),
					},
				},
			},
		},
	});
};

const refresh = (): void => {
	renderStats();
	renderChart();
	renderCategoryDetailChart();
	renderRules();
	renderTransactions();
};

const upsertGoal = async (month: string, targetSavings: number): Promise<void> => {
	const existing = await db.goals.where("month").equals(month).first();
	if (existing?.id) {
		await db.goals.update(existing.id, {targetSavings});
	} else {
		await db.goals.add({month, targetSavings});
	}
	goals = await db.goals.toArray();
};

const addManualTransaction = async (): Promise<void> => {
	const dateInput = document.querySelector<HTMLInputElement>("#manual-date");
	const descriptionInput = document.querySelector<HTMLInputElement>("#manual-description");
	const amountInput = document.querySelector<HTMLInputElement>("#manual-amount");
	const categoryInput = document.querySelector<HTMLSelectElement>("#manual-category");
	if (!dateInput || !descriptionInput || !amountInput || !categoryInput) return;

	const date = toInputDate(dateInput.value);
	const description = descriptionInput.value.trim();
	const amount = Number.parseFloat(amountInput.value);
	const category = categoryInput.value;
	if (!description || Number.isNaN(amount)) return;

	const source = "bmo-manual" as const;
	const tx: Transaction = {
		date,
		description,
		amount,
		source,
		category,
		fingerprint: createFingerprint(date, description, amount, source),
		createdAt: new Date().toISOString(),
	};

	const exists = await db.transactions.where("fingerprint").equals(tx.fingerprint).first();
	if (!exists) {
		await db.transactions.add(tx);
		transactions = await db.transactions.toArray();
		refresh();
	}
};

const addRule = async (): Promise<void> => {
	const patternInput = document.querySelector<HTMLInputElement>("#rule-pattern");
	const matchInput = document.querySelector<HTMLSelectElement>("#rule-match");
	const categoryInput = document.querySelector<HTMLSelectElement>("#rule-category");
	const priorityInput = document.querySelector<HTMLInputElement>("#rule-priority");
	if (!patternInput || !matchInput || !categoryInput || !priorityInput) return;

	const pattern = patternInput.value.trim();
	const priority = Number.parseInt(priorityInput.value, 10);
	if (!pattern || Number.isNaN(priority)) return;

	await db.rules.add({
		pattern,
		matchType: matchInput.value === "startsWith" ? "startsWith" : "contains",
		category: categoryInput.value,
		priority,
	});

	rules = await db.rules.toArray();
	patternInput.value = "";
	refresh();
};

const recategorizeMonth = async (): Promise<void> => {
	const inMonth = monthTransactions();
	for (const tx of inMonth) {
		const next = applyRulesToTransaction(tx, rules);
		if (next.id && next.category !== tx.category) {
			await db.transactions.update(next.id, {category: next.category});
		}
	}
	transactions = await db.transactions.toArray();
	refresh();
};

const persistImportedTransactions = async (imported: Transaction[], parseErrors: string[], originLabel: string): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	const existingTransactions = await db.transactions.toArray();
	const existingSet = new Set(existingTransactions.map((tx) => tx.fingerprint));
	const existingByFingerprint = new Map(existingTransactions.map((tx) => [tx.fingerprint, tx]));
	let inserted = 0;
	let duplicates = 0;
	let updated = 0;
	let insertedInActiveMonth = 0;

	for (const tx of imported) {
		const categorized = applyRulesToTransaction(tx, rules);
		if (existingSet.has(categorized.fingerprint)) {
			duplicates += 1;
			const existing = existingByFingerprint.get(categorized.fingerprint);
			if (existing?.id && existing.category !== categorized.category) {
				await db.transactions.update(existing.id, {category: categorized.category});
				existing.category = categorized.category;
				updated += 1;
			}
			continue;
		}
		await db.transactions.add(categorized);
		existingSet.add(categorized.fingerprint);
		existingByFingerprint.set(categorized.fingerprint, categorized);
		inserted += 1;
		if (categorized.date.startsWith(activeMonth)) {
			insertedInActiveMonth += 1;
		}
	}

	transactions = await db.transactions.toArray();
	refresh();

	if (feedback) {
		const details = parseErrors.slice(0, 3).join(" | ");
		if (imported.length === 0) {
			feedback.textContent = `Aucune transaction lisible dans ${originLabel}.${details ? ` Details: ${details}` : ""}`;
			return;
		}
		const monthHint = inserted > 0 && insertedInActiveMonth === 0 ? " Les nouvelles transactions ne sont pas dans le mois selectionne." : "";
		feedback.textContent = `Import termine (${originLabel}): ${inserted} ajoutees, ${updated} mises a jour, ${duplicates} doublons, ${parseErrors.length} erreurs.${monthHint}${details ? ` Exemples: ${details}` : ""}`;
	}
};

const importCsv = async (file: File): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	if (feedback) {
		feedback.textContent = `Import en cours: ${file.name}`;
	}

	try {
		const parsed = await parseWealthsimpleCsv(file);
		await persistImportedTransactions(parsed.transactions, parsed.errors, file.name);
	} catch (error) {
		if (feedback) {
			const message = error instanceof Error ? error.message : "Erreur inconnue";
			feedback.textContent = `Echec import CSV: ${message}`;
		}
	}
};

const pickCsvFile = (fileList: FileList | null): File | null => {
	if (!fileList || fileList.length === 0) return null;
	for (const file of Array.from(fileList)) {
		const name = file.name.toLowerCase();
		const type = file.type.toLowerCase();
		if (name.endsWith(".csv") || type.includes("csv") || type === "text/plain") {
			return file;
		}
	}
	return null;
};

const importPdfText = async (rawText: string): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	if (feedback) {
		feedback.textContent = "Import PDF texte en cours...";
	}

	const parsed = parseWealthsimplePdfText(rawText);
	await persistImportedTransactions(parsed.transactions, parsed.errors, "PDF texte");
};

const deleteTransactionById = async (transactionId: number): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	const toDelete = transactions.find((tx) => tx.id === transactionId);
	if (!toDelete) {
		if (feedback) {
			feedback.textContent = "Transaction introuvable.";
		}
		return;
	}

	const confirmed = window.confirm(`Supprimer cette transaction ?\n${toDelete.date} | ${toDelete.description} | ${formatMoney(toDelete.amount)}`);
	if (!confirmed) return;

	await db.transactions.delete(transactionId);
	transactions = await db.transactions.toArray();
	refresh();

	if (feedback) {
		feedback.textContent = "Transaction effacee.";
	}
};

const updateTransactionCategory = async (transactionId: number, category: string): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	const found = transactions.find((tx) => tx.id === transactionId);
	if (!found?.id) return;

	if (found.category === category) return;

	await db.transactions.update(found.id, {category});
	found.category = category;
	renderStats();
	renderChart();

	if (feedback) {
		feedback.textContent = `Categorie mise a jour pour \"${found.description}\".`;
	}
};

const clearAllTransactions = async (): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	if (transactions.length === 0) {
		if (feedback) {
			feedback.textContent = "Aucune transaction a effacer.";
		}
		return;
	}

	const firstConfirm = window.confirm("Effacer toutes les transactions locales ? Cette action est irreversible.");
	if (!firstConfirm) return;

	const secondConfirm = window.confirm("Confirmation finale: supprimer toutes les transactions maintenant ?");
	if (!secondConfirm) return;

	await db.transactions.clear();
	transactions = [];
	refresh();

	if (feedback) {
		feedback.textContent = "Toutes les transactions ont ete effacees.";
	}
};

const bindEvents = (): void => {
	const importBtn = document.querySelector<HTMLButtonElement>("#import-btn");
	const csvInput = document.querySelector<HTMLInputElement>("#csv-input");
	const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
	const monthSelect = document.querySelector<HTMLInputElement>("#month-select");
	const searchInput = document.querySelector<HTMLInputElement>("#search-input");
	const categoryFilter = document.querySelector<HTMLSelectElement>("#category-filter");
	const manualForm = document.querySelector<HTMLFormElement>("#manual-form");
	const pdfTextForm = document.querySelector<HTMLFormElement>("#pdf-text-form");
	const pdfTextInput = document.querySelector<HTMLTextAreaElement>("#pdf-text-input");
	const ruleForm = document.querySelector<HTMLFormElement>("#rule-form");
	const applyRulesBtn = document.querySelector<HTMLButtonElement>("#apply-rules-btn");
	const goalForm = document.querySelector<HTMLFormElement>("#goal-form");
	const goalInput = document.querySelector<HTMLInputElement>("#goal-value");
	const transactionsBody = document.querySelector<HTMLTableSectionElement>("#transactions-body");
	const clearAllBtn = document.querySelector<HTMLButtonElement>("#clear-all-btn");
	const clearCategoryDetailBtn = document.querySelector<HTMLButtonElement>("#clear-category-detail");
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");

	const setImportDragState = (isActive: boolean): void => {
		importBtn?.classList.toggle("drag-active", isActive);
	};

	importBtn?.addEventListener("click", () => {
		csvInput?.click();
	});

	importBtn?.addEventListener("dragenter", (event) => {
		event.preventDefault();
		setImportDragState(true);
	});

	importBtn?.addEventListener("dragover", (event) => {
		event.preventDefault();
		setImportDragState(true);
	});

	importBtn?.addEventListener("dragleave", () => {
		setImportDragState(false);
	});

	importBtn?.addEventListener("drop", async (event) => {
		event.preventDefault();
		setImportDragState(false);
		const file = pickCsvFile(event.dataTransfer?.files ?? null);
		if (!file) {
			if (feedback) {
				feedback.textContent = "Depose un fichier CSV valide.";
			}
			return;
		}
		await importCsv(file);
	});

	csvInput?.addEventListener("change", async (event) => {
		const file = pickCsvFile((event.target as HTMLInputElement).files ?? null);
		if (file) {
			await importCsv(file);
			(event.target as HTMLInputElement).value = "";
		} else if (feedback) {
			feedback.textContent = "Selectionne un fichier CSV valide.";
		}
	});

	exportBtn?.addEventListener("click", () => {
		exportTransactionsCsv(filteredTransactions(), `budget-${activeMonth}.csv`);
	});

	monthSelect?.addEventListener("change", () => {
		activeMonth = monthSelect.value;
		refresh();
	});

	searchInput?.addEventListener("input", () => renderTransactions());
	categoryFilter?.addEventListener("change", () => renderTransactions());

	transactionsBody?.addEventListener("click", async (event) => {
		const target = event.target as HTMLElement;
		const button = target.closest<HTMLButtonElement>('button[data-action="delete-transaction"]');
		if (!button) return;

		const rawId = button.dataset.id;
		const transactionId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
		if (Number.isNaN(transactionId)) return;
		await deleteTransactionById(transactionId);
	});

	transactionsBody?.addEventListener("change", async (event) => {
		const target = event.target as HTMLElement;
		const select = target.closest<HTMLSelectElement>('select[data-action="change-category"]');
		if (!select) return;

		const rawId = select.dataset.id;
		const transactionId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
		if (Number.isNaN(transactionId)) return;
		await updateTransactionCategory(transactionId, select.value);
	});

	clearAllBtn?.addEventListener("click", async () => {
		await clearAllTransactions();
	});

	clearCategoryDetailBtn?.addEventListener("click", () => {
		selectedCategoryDrilldown = null;
		renderCategoryDetailChart();
	});

	manualForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		await addManualTransaction();
		manualForm.reset();
		const manualDate = document.querySelector<HTMLInputElement>("#manual-date");
		if (manualDate) {
			manualDate.value = new Date().toISOString().slice(0, 10);
		}
	});

	pdfTextForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const text = pdfTextInput?.value.trim() ?? "";
		if (!text) {
			const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
			if (feedback) {
				feedback.textContent = "Colle du texte de PDF avant de lancer l import.";
			}
			return;
		}
		await importPdfText(text);
		if (pdfTextInput) {
			pdfTextInput.value = "";
		}
	});

	ruleForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		await addRule();
	});

	applyRulesBtn?.addEventListener("click", async () => {
		await recategorizeMonth();
	});

	goalForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!goalInput) return;
		const target = Number.parseFloat(goalInput.value);
		if (!Number.isNaN(target) && target >= 0) {
			await upsertGoal(activeMonth, target);
			refresh();
		}
	});
};

const bootstrap = async (): Promise<void> => {
	renderLayout();
	transactions = await db.transactions.toArray();
	rules = await db.rules.toArray();
	goals = await db.goals.toArray();
	bindEvents();
	refresh();
};

void bootstrap();
