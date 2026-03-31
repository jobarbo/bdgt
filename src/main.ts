import Chart from "chart.js/auto";
import "./style.css";
import {DEFAULT_CATEGORIES, sortCategories, type CategoryRule, type CustomCategory, type MonthlyGoal, type Transaction} from "./domain/types";
import {summarizeMonth, expensesByCategory, expensesByDescriptionForCategory} from "./features/dashboard/dashboard";
import {exportTransactionsCsv} from "./features/export/exportCsv";
import {parseWealthsimpleCsv, createFingerprint} from "./features/import/csvWealthsimple";
import {parseWealthsimplePdfText} from "./features/import/pdfTextImport";
import {applyRulesToTransaction, categorizeTransaction} from "./features/rules/rulesEngine";
import {db} from "./storage/db";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
	throw new Error("Element #app introuvable");
}

const nowMonth = new Date().toISOString().slice(0, 7);
const backendBaseUrl = "http://localhost:8787";

interface PdfPreviewResponse {
	sourceLabel: string;
	extractedCsvPath: string;
	transactions: Array<{
		date: string;
		description: string;
		amount: number;
		source?: string;
		category?: string;
	}>;
	errors: string[];
}

type ImportMode = "all" | "insert-only" | "update-only";

interface PendingPdfRow {
	previewId: string;
	selected: boolean;
	tx: Transaction;
}

let transactions: Transaction[] = [];
let rules: CategoryRule[] = [];
let goals: MonthlyGoal[] = [];
let customCategories: CustomCategory[] = [];
let activeMonth = nowMonth;
let categoryChart: Chart<"bar"> | null = null;
let categoryDetailChart: Chart<"bar"> | null = null;
let selectedCategoryDrilldown: string | null = null;
let pendingPdfRows: PendingPdfRow[] = [];
let pendingPdfErrors: string[] = [];
let pendingPdfSourceLabel = "";
let pendingPdfSearch = "";
let pendingPdfAmountFilter = "all";
let pendingPdfPage = 1;
const pendingPdfPageSize = 12;
let editingRuleId: number | null = null;
let editingCategoryName: string | null = null;

const formatMoney = (value: number): string => new Intl.NumberFormat("fr-CA", {style: "currency", currency: "CAD"}).format(value);

const allCategories = (): string[] => sortCategories([...DEFAULT_CATEGORIES, ...customCategories.map((category) => category.name)]);

const categoryOptionsHtml = (selected?: string): string =>
	allCategories()
		.map((category) => `<option value="${category}" ${selected === category ? "selected" : ""}>${category}</option>`)
		.join("");

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
						${categoryOptionsHtml()}
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
							${categoryOptionsHtml()}
            </select>
            <button class="btn" type="submit">Ajouter transaction</button>
          </form>
        </article>

        <article class="panel">
          <h2>Import PDF Wealthsimple</h2>
					<div id="pdf-drop-zone" class="pdf-drop-zone">
						<p>Glisse un PDF ici pour lancer une previsualisation.</p>
						<button id="pdf-import-btn" class="btn alt" type="button">Choisir un PDF</button>
						<input id="pdf-input" class="visually-hidden" type="file" accept="application/pdf,.pdf" />
					</div>
					<p class="muted">Le backend local extrait le PDF, puis un modal te permet de valider chaque transaction avant import.</p>
					<details class="pdf-fallback">
						<summary>Mode texte de secours</summary>
						<form id="pdf-text-form" class="stack-form">
							<textarea id="pdf-text-input" rows="7" placeholder="Colle ici le texte copie depuis ton PDF Wealthsimple"></textarea>
							<button class="btn alt" type="submit">Importer texte PDF</button>
						</form>
					</details>
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
							${categoryOptionsHtml()}
            </select>
            <input id="rule-priority" type="number" value="10" min="1" max="999" required />
            <div class="split-actions">
							<button id="rule-submit-btn" class="btn" type="submit">Ajouter regle</button>
							<button id="rule-cancel-edit-btn" class="btn alt" type="button" hidden>Annuler modif</button>
              <button id="apply-rules-btn" class="btn alt" type="button">Re-categoriser mois</button>
            </div>
          </form>
          <ul id="rules-list" class="compact-list"></ul>
        </article>

				<article class="panel">
				<h2>Categories personnalisees</h2>
				<form id="category-form" class="stack-form small-gap">
					<input id="category-name" type="text" placeholder="Nouvelle categorie" required />
					<div class="split-actions">
						<button id="category-submit-btn" class="btn" type="submit">Ajouter categorie</button>
						<button id="category-cancel-edit-btn" class="btn alt" type="button" hidden>Annuler modif</button>
					</div>
				</form>
				<ul id="custom-categories-list" class="compact-list"></ul>
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

			<div id="pdf-preview-modal" class="modal-overlay" hidden>
				<div class="modal-card">
					<div class="section-head">
						<div>
							<h2>Valider import PDF</h2>
							<p id="pdf-preview-source" class="muted"></p>
						</div>
						<button id="close-pdf-preview" class="btn alt compact" type="button">Fermer</button>
					</div>
					<p id="pdf-preview-errors" class="muted"></p>
					<div class="modal-toolbar">
						<input id="pdf-preview-search" type="text" placeholder="Rechercher dans le preview..." />
						<select id="pdf-preview-amount-filter">
							<option value="all">Tous les montants</option>
							<option value="negative">Montants negatifs</option>
							<option value="positive">Montants positifs</option>
						</select>
						<button id="auto-categorize-pdf-preview" class="btn alt compact" type="button">Auto-categoriser</button>
						<label class="row-check">
							<input id="pdf-preview-select-page" type="checkbox" />
							<span>Selectionner la page visible</span>
						</label>
						<p id="pdf-preview-count" class="muted"></p>
					</div>
					<div class="table-wrap modal-table-wrap">
						<table>
							<thead>
								<tr>
									<th></th>
									<th>Date</th>
									<th>Description</th>
									<th>Montant</th>
									<th>Categorie</th>
									<th>Action</th>
								</tr>
							</thead>
							<tbody id="pdf-preview-body"></tbody>
						</table>
					</div>
					<div class="modal-pagination">
						<button id="pdf-preview-prev" class="btn alt compact" type="button">Precedent</button>
						<p id="pdf-preview-page" class="muted"></p>
						<button id="pdf-preview-next" class="btn alt compact" type="button">Suivant</button>
					</div>
					<div class="split-actions modal-actions">
						<button id="cancel-pdf-import" class="btn alt" type="button">Annuler</button>
						<button id="confirm-pdf-import-all" class="btn" type="button">Import complet</button>
						<button id="confirm-pdf-insert-only" class="btn" type="button">Importer nouveaux seulement</button>
						<button id="confirm-pdf-update-only" class="btn alt" type="button">Mettre a jour doublons seulement</button>
					</div>
				</div>
			</div>
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
	list.innerHTML = sorted
		.map(
			(rule) => `<li>
				<span><strong>${rule.pattern}</strong> -> ${rule.category} (${rule.matchType}, p${rule.priority})</span>
				<span class="split-actions">
					<button class="btn alt compact" type="button" data-action="edit-rule" data-rule-id="${rule.id ?? ""}">Modifier</button>
					<button class="btn danger compact" type="button" data-action="delete-rule" data-rule-id="${rule.id ?? ""}">Supprimer</button>
				</span>
			</li>`,
		)
		.join("");

	const customList = document.querySelector<HTMLUListElement>("#custom-categories-list");
	if (!customList) return;
	const categories = sortCategories(customCategories.map((category) => category.name));
	customList.innerHTML = categories.length > 0
		? categories
				.map(
					(category) => `<li>
						<span>${category}</span>
						<span class="split-actions">
							<button class="btn alt compact" type="button" data-action="edit-category" data-category-name="${category}">Modifier</button>
							<button class="btn danger compact" type="button" data-action="delete-category" data-category-name="${category}">Supprimer</button>
						</span>
					</li>`,
				)
				.join("")
		: '<li class="muted">Aucune categorie personnalisee.</li>';
};

const syncCategorySelect = (select: HTMLSelectElement, optionsHtml: string, fallback: string): void => {
	const previousValue = select.value;
	select.innerHTML = optionsHtml;
	const allowedValues = Array.from(select.options).map((option) => option.value);
	select.value = allowedValues.includes(previousValue) ? previousValue : fallback;
};

const syncCategoryControls = (): void => {
	const categoryOptions = categoryOptionsHtml();
	const filterOptions = `<option value="all">Toutes</option>${categoryOptions}`;
	const categoryFilter = document.querySelector<HTMLSelectElement>("#category-filter");
	const manualCategory = document.querySelector<HTMLSelectElement>("#manual-category");
	const ruleCategory = document.querySelector<HTMLSelectElement>("#rule-category");

	if (categoryFilter) {
		syncCategorySelect(categoryFilter, filterOptions, "all");
	}
	if (manualCategory) {
		syncCategorySelect(manualCategory, categoryOptions, allCategories()[0] ?? "Non classe");
	}
	if (ruleCategory) {
		syncCategorySelect(ruleCategory, categoryOptions, allCategories()[0] ?? "Non classe");
	}
};

const renderTransactions = (): void => {
	const body = document.querySelector<HTMLTableSectionElement>("#transactions-body");
	if (!body) return;

	const rows = filteredTransactions();
	const categoryOptions = categoryOptionsHtml();
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
	const submitBtn = document.querySelector<HTMLButtonElement>("#rule-submit-btn");
	const cancelBtn = document.querySelector<HTMLButtonElement>("#rule-cancel-edit-btn");
	if (!patternInput || !matchInput || !categoryInput || !priorityInput) return;

	const pattern = patternInput.value.trim();
	const priority = Number.parseInt(priorityInput.value, 10);
	if (!pattern || Number.isNaN(priority)) return;
	const nextRule: Omit<CategoryRule, "id"> = {
		pattern,
		matchType: matchInput.value === "startsWith" ? "startsWith" : "contains",
		category: categoryInput.value,
		priority,
	};

	if (editingRuleId !== null) {
		await db.rules.update(editingRuleId, nextRule);
	} else {
		await db.rules.add(nextRule);
	}

	rules = await db.rules.toArray();
	editingRuleId = null;
	patternInput.value = "";
	matchInput.value = "contains";
	priorityInput.value = "10";
	if (submitBtn) {
		submitBtn.textContent = "Ajouter regle";
	}
	if (cancelBtn) {
		cancelBtn.hidden = true;
	}
	refresh();
};

const startRuleEdition = (ruleId: number): void => {
	const rule = rules.find((candidate) => candidate.id === ruleId);
	if (!rule) return;
	const patternInput = document.querySelector<HTMLInputElement>("#rule-pattern");
	const matchInput = document.querySelector<HTMLSelectElement>("#rule-match");
	const categoryInput = document.querySelector<HTMLSelectElement>("#rule-category");
	const priorityInput = document.querySelector<HTMLInputElement>("#rule-priority");
	const submitBtn = document.querySelector<HTMLButtonElement>("#rule-submit-btn");
	const cancelBtn = document.querySelector<HTMLButtonElement>("#rule-cancel-edit-btn");
	if (!patternInput || !matchInput || !categoryInput || !priorityInput || !submitBtn || !cancelBtn) return;

	editingRuleId = ruleId;
	patternInput.value = rule.pattern;
	matchInput.value = rule.matchType;
	categoryInput.value = rule.category;
	priorityInput.value = String(rule.priority);
	submitBtn.textContent = "Enregistrer modif";
	cancelBtn.hidden = false;
	patternInput.focus();
};

const resetRuleEdition = (): void => {
	const patternInput = document.querySelector<HTMLInputElement>("#rule-pattern");
	const matchInput = document.querySelector<HTMLSelectElement>("#rule-match");
	const priorityInput = document.querySelector<HTMLInputElement>("#rule-priority");
	const submitBtn = document.querySelector<HTMLButtonElement>("#rule-submit-btn");
	const cancelBtn = document.querySelector<HTMLButtonElement>("#rule-cancel-edit-btn");

	editingRuleId = null;
	if (patternInput) patternInput.value = "";
	if (matchInput) matchInput.value = "contains";
	if (priorityInput) priorityInput.value = "10";
	if (submitBtn) submitBtn.textContent = "Ajouter regle";
	if (cancelBtn) cancelBtn.hidden = true;
};

const deleteRule = async (ruleId: number): Promise<void> => {
	await db.rules.delete(ruleId);
	rules = await db.rules.toArray();
	if (editingRuleId === ruleId) {
		resetRuleEdition();
	}
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

const persistImportedTransactions = async (imported: Transaction[], parseErrors: string[], originLabel: string, mode: ImportMode = "all"): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	const existingTransactions = await db.transactions.toArray();
	const existingSet = new Set(existingTransactions.map((tx) => tx.fingerprint));
	const existingByFingerprint = new Map(existingTransactions.map((tx) => [tx.fingerprint, tx]));
	let inserted = 0;
	let duplicates = 0;
	let updated = 0;
	let skippedForMode = 0;
	let insertedInActiveMonth = 0;

	for (const tx of imported) {
		const categorized = categorizeTransaction(tx, rules, {preserveExistingCategory: true});
		if (existingSet.has(categorized.fingerprint)) {
			duplicates += 1;
			if (mode === "insert-only") {
				skippedForMode += 1;
				continue;
			}
			const existing = existingByFingerprint.get(categorized.fingerprint);
			if (existing?.id && existing.category !== categorized.category) {
				await db.transactions.update(existing.id, {category: categorized.category});
				existing.category = categorized.category;
				updated += 1;
			}
			continue;
		}
		if (mode === "update-only") {
			skippedForMode += 1;
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
		const modeLabel = mode === "insert-only" ? "mode nouveaux seulement" : mode === "update-only" ? "mode mises a jour doublons" : "mode complet";
		if (imported.length === 0) {
			feedback.textContent = `Aucune transaction lisible dans ${originLabel}.${details ? ` Details: ${details}` : ""}`;
			return;
		}
		const monthHint = inserted > 0 && insertedInActiveMonth === 0 ? " Les nouvelles transactions ne sont pas dans le mois selectionne." : "";
		feedback.textContent = `Import termine (${originLabel}, ${modeLabel}): ${inserted} ajoutees, ${updated} mises a jour, ${duplicates} doublons, ${skippedForMode} ignorees par mode, ${parseErrors.length} erreurs.${monthHint}${details ? ` Exemples: ${details}` : ""}`;
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

const pickPdfFile = (fileList: FileList | null): File | null => {
	if (!fileList || fileList.length === 0) return null;
	for (const file of Array.from(fileList)) {
		const name = file.name.toLowerCase();
		const type = file.type.toLowerCase();
		if (name.endsWith(".pdf") || type.includes("pdf")) {
			return file;
		}
	}
	return null;
};

const filteredPendingPdfRows = (): PendingPdfRow[] => {
	const query = pendingPdfSearch.trim().toLowerCase();
	return pendingPdfRows.filter((row) => {
		const matchesAmount = pendingPdfAmountFilter === "all" || (pendingPdfAmountFilter === "negative" && row.tx.amount < 0) || (pendingPdfAmountFilter === "positive" && row.tx.amount > 0);
		if (!matchesAmount) return false;

		if (!query) return true;
		const amountText = String(row.tx.amount);
		return row.tx.date.toLowerCase().includes(query) || row.tx.description.toLowerCase().includes(query) || row.tx.category.toLowerCase().includes(query) || amountText.includes(query);
	});
};

const currentPendingPageRows = (): PendingPdfRow[] => {
	const filtered = filteredPendingPdfRows();
	const maxPage = Math.max(1, Math.ceil(filtered.length / pendingPdfPageSize));
	if (pendingPdfPage > maxPage) {
		pendingPdfPage = maxPage;
	}
	const start = (pendingPdfPage - 1) * pendingPdfPageSize;
	return filtered.slice(start, start + pendingPdfPageSize);
};

const autoCategorizePendingPdfRows = (scope: "all" | "selected", announce = true): void => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	let updated = 0;

	pendingPdfRows = pendingPdfRows.map((row) => {
		if (scope === "selected" && !row.selected) {
			return row;
		}

		const nextTx = categorizeTransaction(row.tx, rules);
		if (nextTx.category !== row.tx.category) {
			updated += 1;
		}

		return {
			...row,
			tx: nextTx,
		};
	});

	renderPdfPreviewModal();

	if (announce && feedback) {
		const scopeLabel = scope === "selected" ? "selection" : "preview";
		feedback.textContent = updated > 0 ? `${updated} categories mises a jour selon tes regles pour la ${scopeLabel}.` : `Aucune categorie a ajuster selon tes regles pour la ${scopeLabel}.`;
	}
};

const renderPdfPreviewModal = (): void => {
	const modal = document.querySelector<HTMLDivElement>("#pdf-preview-modal");
	const source = document.querySelector<HTMLParagraphElement>("#pdf-preview-source");
	const errors = document.querySelector<HTMLParagraphElement>("#pdf-preview-errors");
	const body = document.querySelector<HTMLTableSectionElement>("#pdf-preview-body");
	const autoCategorizeBtn = document.querySelector<HTMLButtonElement>("#auto-categorize-pdf-preview");
	const importAllBtn = document.querySelector<HTMLButtonElement>("#confirm-pdf-import-all");
	const insertBtn = document.querySelector<HTMLButtonElement>("#confirm-pdf-insert-only");
	const updateBtn = document.querySelector<HTMLButtonElement>("#confirm-pdf-update-only");
	const pageLabel = document.querySelector<HTMLParagraphElement>("#pdf-preview-page");
	const countLabel = document.querySelector<HTMLParagraphElement>("#pdf-preview-count");
	const pageSelect = document.querySelector<HTMLInputElement>("#pdf-preview-select-page");
	if (!modal || !source || !errors || !body || !autoCategorizeBtn || !importAllBtn || !insertBtn || !updateBtn || !pageLabel || !countLabel || !pageSelect) return;

	if (pendingPdfRows.length === 0 && pendingPdfErrors.length === 0 && !pendingPdfSourceLabel) {
		modal.hidden = true;
		return;
	}

	modal.hidden = false;
	source.textContent = pendingPdfSourceLabel ? `Source: ${pendingPdfSourceLabel}` : "";
	errors.textContent = pendingPdfErrors.length > 0 ? `${pendingPdfErrors.length} avertissements: ${pendingPdfErrors.slice(0, 4).join(" | ")}` : "Aucun avertissement.";
	const filtered = filteredPendingPdfRows();
	const pageRows = currentPendingPageRows();
	const maxPage = Math.max(1, Math.ceil(filtered.length / pendingPdfPageSize));
	const selectedCount = pendingPdfRows.filter((row) => row.selected).length;
	autoCategorizeBtn.disabled = pendingPdfRows.length === 0;
	importAllBtn.disabled = selectedCount === 0;
	insertBtn.disabled = selectedCount === 0;
	updateBtn.disabled = selectedCount === 0;
	countLabel.textContent = `${selectedCount} selectionnees sur ${filtered.length} visibles (${pendingPdfRows.length} total).`;
	pageLabel.textContent = `Page ${pendingPdfPage}/${maxPage}`;
	pageSelect.checked = pageRows.length > 0 && pageRows.every((row) => row.selected);

	const categoryOptions = categoryOptionsHtml();
	body.innerHTML = pageRows
		.map(
			(row) => `<tr>
				<td><input type="checkbox" data-action="pending-pdf-toggle" data-preview-id="${row.previewId}" ${row.selected ? "checked" : ""} /></td>
				<td>${row.tx.date}</td>
				<td>${row.tx.description}</td>
				<td class="${row.tx.amount < 0 ? "neg" : "pos"}">${formatMoney(row.tx.amount)}</td>
				<td>
					<select class="table-category-select" data-action="pending-pdf-category" data-preview-id="${row.previewId}">
						${categoryOptions}
					</select>
				</td>
				<td><button class="btn danger compact" type="button" data-action="pending-pdf-delete" data-preview-id="${row.previewId}">Retirer</button></td>
			</tr>`,
		)
		.join("");

	pageRows.forEach((row) => {
		const select = body.querySelector<HTMLSelectElement>(`select[data-action="pending-pdf-category"][data-preview-id="${row.previewId}"]`);
		if (select) {
			select.value = row.tx.category;
		}
	});
};

const addCustomCategory = async (): Promise<void> => {
	const categoryInput = document.querySelector<HTMLInputElement>("#category-name");
	const submitBtn = document.querySelector<HTMLButtonElement>("#category-submit-btn");
	const cancelBtn = document.querySelector<HTMLButtonElement>("#category-cancel-edit-btn");
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	if (!categoryInput) return;

	const rawName = categoryInput.value.trim();
	if (!rawName) return;

	const normalizedName = rawName.replace(/\s+/g, " ");
	const wasEditing = editingCategoryName !== null;
	const existing = allCategories().some(
		(category) => category.localeCompare(normalizedName, "fr-CA", {sensitivity: "base"}) === 0 && category.localeCompare(editingCategoryName ?? "", "fr-CA", {sensitivity: "base"}) !== 0,
	);
	if (existing) {
		if (feedback) {
			feedback.textContent = `La categorie \"${normalizedName}\" existe deja.`;
		}
		return;
	}

	if (editingCategoryName) {
		const originalName = editingCategoryName;
		const originalCategory = customCategories.find((category) => category.name === originalName);
		if (!originalCategory) return;

		await db.transaction("rw", db.categories, db.transactions, db.rules, async () => {
			if (originalName !== normalizedName) {
				await db.categories.delete(originalName);
				await db.categories.add({
					name: normalizedName,
					createdAt: originalCategory.createdAt,
				});

				const relatedTransactions = await db.transactions.where("category").equals(originalName).toArray();
				for (const transaction of relatedTransactions) {
					if (transaction.id) {
						await db.transactions.update(transaction.id, {category: normalizedName});
					}
				}

				const relatedRules = await db.rules.where("category").equals(originalName).toArray();
				for (const rule of relatedRules) {
					if (rule.id) {
						await db.rules.update(rule.id, {category: normalizedName});
					}
				}
			}
		});

		transactions = transactions.map((transaction) => (transaction.category === originalName ? {...transaction, category: normalizedName} : transaction));
		rules = rules.map((rule) => (rule.category === originalName ? {...rule, category: normalizedName} : rule));
		pendingPdfRows = pendingPdfRows.map((row) => (row.tx.category === originalName ? {...row, tx: {...row.tx, category: normalizedName}} : row));
		if (selectedCategoryDrilldown === originalName) {
			selectedCategoryDrilldown = normalizedName;
		}
	} else {
		await db.categories.add({
			name: normalizedName,
			createdAt: new Date().toISOString(),
		});
	}
	customCategories = await db.categories.toArray();
	editingCategoryName = null;
	categoryInput.value = "";
	if (submitBtn) {
		submitBtn.textContent = "Ajouter categorie";
	}
	if (cancelBtn) {
		cancelBtn.hidden = true;
	}
	syncCategoryControls();
	refresh();
	renderPdfPreviewModal();

	if (feedback) {
		feedback.textContent = wasEditing ? `Categorie modifiee: ${normalizedName}` : `Categorie ajoutee: ${normalizedName}`;
	}
};

const startCategoryEdition = (categoryName: string): void => {
	const categoryInput = document.querySelector<HTMLInputElement>("#category-name");
	const submitBtn = document.querySelector<HTMLButtonElement>("#category-submit-btn");
	const cancelBtn = document.querySelector<HTMLButtonElement>("#category-cancel-edit-btn");
	if (!categoryInput || !submitBtn || !cancelBtn) return;

	editingCategoryName = categoryName;
	categoryInput.value = categoryName;
	submitBtn.textContent = "Enregistrer modif";
	cancelBtn.hidden = false;
	categoryInput.focus();
};

const resetCategoryEdition = (): void => {
	const categoryInput = document.querySelector<HTMLInputElement>("#category-name");
	const submitBtn = document.querySelector<HTMLButtonElement>("#category-submit-btn");
	const cancelBtn = document.querySelector<HTMLButtonElement>("#category-cancel-edit-btn");

	editingCategoryName = null;
	if (categoryInput) {
		categoryInput.value = "";
	}
	if (submitBtn) {
		submitBtn.textContent = "Ajouter categorie";
	}
	if (cancelBtn) {
		cancelBtn.hidden = true;
	}
};

const deleteCustomCategory = async (categoryName: string): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	const relatedTransactions = transactions.filter((transaction) => transaction.category === categoryName);
	const relatedRules = rules.filter((rule) => rule.category === categoryName);
	const needsReassign = relatedTransactions.length > 0 || relatedRules.length > 0;
	const message = needsReassign
		? `Supprimer la categorie \"${categoryName}\" ? ${relatedTransactions.length} transaction(s) et ${relatedRules.length} regle(s) seront reaffectees a \"Non classe\".`
		: `Supprimer la categorie \"${categoryName}\" ?`;
	if (!window.confirm(message)) return;

	await db.transaction("rw", db.categories, db.transactions, db.rules, async () => {
		await db.categories.delete(categoryName);

		for (const transaction of relatedTransactions) {
			if (transaction.id) {
				await db.transactions.update(transaction.id, {category: "Non classe"});
			}
		}

		for (const rule of relatedRules) {
			if (rule.id) {
				await db.rules.update(rule.id, {category: "Non classe"});
			}
		}
	});

	transactions = transactions.map((transaction) => (transaction.category === categoryName ? {...transaction, category: "Non classe"} : transaction));
	rules = rules.map((rule) => (rule.category === categoryName ? {...rule, category: "Non classe"} : rule));
	pendingPdfRows = pendingPdfRows.map((row) => (row.tx.category === categoryName ? {...row, tx: {...row.tx, category: "Non classe"}} : row));
	customCategories = await db.categories.toArray();
	if (selectedCategoryDrilldown === categoryName) {
		selectedCategoryDrilldown = null;
	}
	if (editingCategoryName === categoryName) {
		resetCategoryEdition();
	}
	syncCategoryControls();
	refresh();
	renderPdfPreviewModal();

	if (feedback) {
		feedback.textContent = `Categorie supprimee: ${categoryName}`;
	}
};

const closePdfPreviewModal = (): void => {
	pendingPdfRows = [];
	pendingPdfErrors = [];
	pendingPdfSourceLabel = "";
	pendingPdfSearch = "";
	pendingPdfAmountFilter = "all";
	pendingPdfPage = 1;
	renderPdfPreviewModal();
};

const openPdfPreviewModal = (nextTransactions: Transaction[], nextErrors: string[], sourceLabel: string): void => {
	pendingPdfRows = nextTransactions.map((tx, index) => ({
		previewId: `${tx.fingerprint}-${index}`,
		selected: true,
		tx,
	}));
	pendingPdfErrors = nextErrors;
	pendingPdfSourceLabel = sourceLabel;
	pendingPdfSearch = "";
	pendingPdfAmountFilter = "all";
	pendingPdfPage = 1;
	autoCategorizePendingPdfRows("all", false);
};

const importPdfWithBackend = async (file: File): Promise<void> => {
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");
	if (feedback) {
		feedback.textContent = `Extraction PDF en cours: ${file.name}`;
	}

	try {
		const formData = new FormData();
		formData.append("pdf", file);

		const response = await fetch(`${backendBaseUrl}/api/import/pdf-preview`, {
			method: "POST",
			body: formData,
		});

		const payload = (await response.json()) as PdfPreviewResponse | {error: string};
		if (!response.ok || "error" in payload) {
			throw new Error("error" in payload ? payload.error : "Erreur backend inconnue.");
		}

		const previewTransactions = payload.transactions.map((item) => {
			const source = "wealthsimple" as const;
			return categorizeTransaction(
				{
					date: item.date,
					description: item.description,
					amount: item.amount,
					source,
					category: item.category ?? "Non classe",
					fingerprint: createFingerprint(item.date, item.description, item.amount, source),
					createdAt: new Date().toISOString(),
				},
				rules,
			);
		});

		if (previewTransactions.length === 0) {
			if (feedback) {
				feedback.textContent = `Aucune transaction detectee dans ${file.name}.`;
			}
			return;
		}

		openPdfPreviewModal(previewTransactions, payload.errors, payload.sourceLabel);
		if (feedback) {
			feedback.textContent = `Preview PDF prete: ${previewTransactions.length} transactions detectees.`;
		}
	} catch (error) {
		if (feedback) {
			const message = error instanceof Error ? error.message : "Erreur inconnue";
			feedback.textContent = `Echec import PDF: ${message}`;
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
	const pdfImportBtn = document.querySelector<HTMLButtonElement>("#pdf-import-btn");
	const pdfInput = document.querySelector<HTMLInputElement>("#pdf-input");
	const pdfDropZone = document.querySelector<HTMLDivElement>("#pdf-drop-zone");
	const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn");
	const monthSelect = document.querySelector<HTMLInputElement>("#month-select");
	const searchInput = document.querySelector<HTMLInputElement>("#search-input");
	const categoryFilter = document.querySelector<HTMLSelectElement>("#category-filter");
	const manualForm = document.querySelector<HTMLFormElement>("#manual-form");
	const pdfTextForm = document.querySelector<HTMLFormElement>("#pdf-text-form");
	const pdfTextInput = document.querySelector<HTMLTextAreaElement>("#pdf-text-input");
	const ruleForm = document.querySelector<HTMLFormElement>("#rule-form");
	const ruleList = document.querySelector<HTMLUListElement>("#rules-list");
	const ruleCancelEditBtn = document.querySelector<HTMLButtonElement>("#rule-cancel-edit-btn");
	const categoryForm = document.querySelector<HTMLFormElement>("#category-form");
	const customCategoriesList = document.querySelector<HTMLUListElement>("#custom-categories-list");
	const categoryCancelEditBtn = document.querySelector<HTMLButtonElement>("#category-cancel-edit-btn");
	const applyRulesBtn = document.querySelector<HTMLButtonElement>("#apply-rules-btn");
	const goalForm = document.querySelector<HTMLFormElement>("#goal-form");
	const goalInput = document.querySelector<HTMLInputElement>("#goal-value");
	const transactionsBody = document.querySelector<HTMLTableSectionElement>("#transactions-body");
	const clearAllBtn = document.querySelector<HTMLButtonElement>("#clear-all-btn");
	const clearCategoryDetailBtn = document.querySelector<HTMLButtonElement>("#clear-category-detail");
	const pdfPreviewBody = document.querySelector<HTMLTableSectionElement>("#pdf-preview-body");
	const autoCategorizePdfPreviewBtn = document.querySelector<HTMLButtonElement>("#auto-categorize-pdf-preview");
	const confirmPdfImportAllBtn = document.querySelector<HTMLButtonElement>("#confirm-pdf-import-all");
	const confirmPdfInsertOnlyBtn = document.querySelector<HTMLButtonElement>("#confirm-pdf-insert-only");
	const confirmPdfUpdateOnlyBtn = document.querySelector<HTMLButtonElement>("#confirm-pdf-update-only");
	const cancelPdfImportBtn = document.querySelector<HTMLButtonElement>("#cancel-pdf-import");
	const closePdfPreviewBtn = document.querySelector<HTMLButtonElement>("#close-pdf-preview");
	const pdfPreviewSearch = document.querySelector<HTMLInputElement>("#pdf-preview-search");
	const pdfPreviewAmountFilter = document.querySelector<HTMLSelectElement>("#pdf-preview-amount-filter");
	const pdfPreviewSelectPage = document.querySelector<HTMLInputElement>("#pdf-preview-select-page");
	const pdfPreviewPrev = document.querySelector<HTMLButtonElement>("#pdf-preview-prev");
	const pdfPreviewNext = document.querySelector<HTMLButtonElement>("#pdf-preview-next");
	const feedback = document.querySelector<HTMLParagraphElement>("#import-feedback");

	const setImportDragState = (isActive: boolean): void => {
		importBtn?.classList.toggle("drag-active", isActive);
	};

	const setPdfDragState = (isActive: boolean): void => {
		pdfDropZone?.classList.toggle("drag-active", isActive);
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

	pdfImportBtn?.addEventListener("click", () => {
		pdfInput?.click();
	});

	pdfDropZone?.addEventListener("dragenter", (event) => {
		event.preventDefault();
		setPdfDragState(true);
	});

	pdfDropZone?.addEventListener("dragover", (event) => {
		event.preventDefault();
		setPdfDragState(true);
	});

	pdfDropZone?.addEventListener("dragleave", () => {
		setPdfDragState(false);
	});

	pdfDropZone?.addEventListener("drop", async (event) => {
		event.preventDefault();
		setPdfDragState(false);
		const file = pickPdfFile(event.dataTransfer?.files ?? null);
		if (!file) {
			if (feedback) {
				feedback.textContent = "Depose un fichier PDF valide.";
			}
			return;
		}
		await importPdfWithBackend(file);
	});

	pdfInput?.addEventListener("change", async (event) => {
		const file = pickPdfFile((event.target as HTMLInputElement).files ?? null);
		if (file) {
			await importPdfWithBackend(file);
			(event.target as HTMLInputElement).value = "";
		} else if (feedback) {
			feedback.textContent = "Selectionne un fichier PDF valide.";
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

	ruleCancelEditBtn?.addEventListener("click", () => {
		resetRuleEdition();
	});

	ruleList?.addEventListener("click", async (event) => {
		const target = event.target as HTMLElement;
		const actionButton = target.closest<HTMLButtonElement>("button[data-action]");
		if (!actionButton) return;

		const rawId = actionButton.dataset.ruleId;
		const ruleId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
		if (Number.isNaN(ruleId)) return;

		if (actionButton.dataset.action === "edit-rule") {
			startRuleEdition(ruleId);
			return;
		}

		if (actionButton.dataset.action === "delete-rule") {
			await deleteRule(ruleId);
		}
	});

	categoryForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		await addCustomCategory();
	});

	categoryCancelEditBtn?.addEventListener("click", () => {
		resetCategoryEdition();
	});

	customCategoriesList?.addEventListener("click", async (event) => {
		const target = event.target as HTMLElement;
		const actionButton = target.closest<HTMLButtonElement>("button[data-action]");
		if (!actionButton) return;

		const categoryName = actionButton.dataset.categoryName;
		if (!categoryName) return;

		if (actionButton.dataset.action === "edit-category") {
			startCategoryEdition(categoryName);
			return;
		}

		if (actionButton.dataset.action === "delete-category") {
			await deleteCustomCategory(categoryName);
		}
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

	pdfPreviewBody?.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const button = target.closest<HTMLButtonElement>('button[data-action="pending-pdf-delete"]');
		if (!button) return;
		const previewId = button.dataset.previewId;
		if (!previewId) return;
		pendingPdfRows = pendingPdfRows.filter((row) => row.previewId !== previewId);
		renderPdfPreviewModal();
	});

	pdfPreviewBody?.addEventListener("change", (event) => {
		const target = event.target as HTMLElement;
		const select = target.closest<HTMLSelectElement>('select[data-action="pending-pdf-category"]');
		if (select) {
			const previewId = select.dataset.previewId;
			if (!previewId) return;
			const row = pendingPdfRows.find((item) => item.previewId === previewId);
			if (!row) return;
			row.tx.category = select.value;
			return;
		}

		const toggle = target.closest<HTMLInputElement>('input[data-action="pending-pdf-toggle"]');
		if (!toggle) return;
		const previewId = toggle.dataset.previewId;
		if (!previewId) return;
		const row = pendingPdfRows.find((item) => item.previewId === previewId);
		if (!row) return;
		row.selected = toggle.checked;
		renderPdfPreviewModal();
	});

	pdfPreviewSearch?.addEventListener("input", () => {
		pendingPdfSearch = pdfPreviewSearch.value;
		pendingPdfPage = 1;
		renderPdfPreviewModal();
	});

	pdfPreviewAmountFilter?.addEventListener("change", () => {
		pendingPdfAmountFilter = pdfPreviewAmountFilter.value;
		pendingPdfPage = 1;
		renderPdfPreviewModal();
	});

	pdfPreviewSelectPage?.addEventListener("change", () => {
		const pageRows = currentPendingPageRows();
		for (const row of pageRows) {
			row.selected = pdfPreviewSelectPage.checked;
		}
		renderPdfPreviewModal();
	});

	pdfPreviewPrev?.addEventListener("click", () => {
		if (pendingPdfPage > 1) {
			pendingPdfPage -= 1;
			renderPdfPreviewModal();
		}
	});

	pdfPreviewNext?.addEventListener("click", () => {
		const total = filteredPendingPdfRows().length;
		const maxPage = Math.max(1, Math.ceil(total / pendingPdfPageSize));
		if (pendingPdfPage < maxPage) {
			pendingPdfPage += 1;
			renderPdfPreviewModal();
		}
	});

	autoCategorizePdfPreviewBtn?.addEventListener("click", () => {
		autoCategorizePendingPdfRows("selected");
	});

	const closeModal = () => {
		closePdfPreviewModal();
	};

	closePdfPreviewBtn?.addEventListener("click", closeModal);
	cancelPdfImportBtn?.addEventListener("click", closeModal);
	confirmPdfImportAllBtn?.addEventListener("click", async () => {
		const selected = pendingPdfRows.filter((row) => row.selected).map((row) => row.tx);
		await persistImportedTransactions(selected, pendingPdfErrors, `PDF ${pendingPdfSourceLabel}`, "all");
		closePdfPreviewModal();
	});
	confirmPdfInsertOnlyBtn?.addEventListener("click", async () => {
		const selected = pendingPdfRows.filter((row) => row.selected).map((row) => row.tx);
		await persistImportedTransactions(selected, pendingPdfErrors, `PDF ${pendingPdfSourceLabel}`, "insert-only");
		closePdfPreviewModal();
	});
	confirmPdfUpdateOnlyBtn?.addEventListener("click", async () => {
		const selected = pendingPdfRows.filter((row) => row.selected).map((row) => row.tx);
		await persistImportedTransactions(selected, pendingPdfErrors, `PDF ${pendingPdfSourceLabel}`, "update-only");
		closePdfPreviewModal();
	});
};

const bootstrap = async (): Promise<void> => {
	transactions = await db.transactions.toArray();
	rules = await db.rules.toArray();
	goals = await db.goals.toArray();
	customCategories = await db.categories.toArray();
	renderLayout();
	bindEvents();
	syncCategoryControls();
	refresh();
};

void bootstrap();
