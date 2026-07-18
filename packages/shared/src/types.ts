import type { CashflowType, Kind } from "./kinds";

/**
 * Shared domain & API response types (ADR-0007). Framework-agnostic; imported by the API, the web app,
 * and scripts. Monetary amounts are INR numbers; dates are ISO `YYYY-MM-DD` strings.
 */

/** One allocation line of a transaction (ADR-0012). Default = a single split for the whole amount. */
export interface TransactionSplit {
	seq: number;
	/** signed INR; credit +, debit − */
	amount: number;
	kind: Kind;
	categoryKey: string;
	/** set when this split feeds an investment's XIRR ledger */
	investmentId?: string;
	cashflowType?: CashflowType;
}

/** A bank-statement row (atomic) plus its splits. `txnId` is the deterministic idempotency key (ADR-0013). */
export interface Transaction {
	txnId: string;
	accountId: string;
	date: string;
	valueDate?: string;
	narration: string;
	refNo?: string;
	/** signed INR: credit +, debit − */
	amount: number;
	/** running balance from the statement */
	balance: number;
	sourceFile: string;
	importBatchId: string;
	/** e.g. "FY2026-27" */
	fy: string;
	/** "YYYY-MM" */
	month: string;
	splits: TransactionSplit[];
}

/** One month of the north-star KPI (ADR-0011). */
export interface CoverageRatioPoint {
	month: string;
	passiveIncomeCash: number;
	/** 0 when the drawdown setting is disabled */
	imputedDrawdown: number;
	expenses: number;
	/** (passiveIncomeCash + imputedDrawdown) / expenses; null when expenses = 0 */
	ratio: number | null;
}

export interface NetWorthPoint {
	date: string;
	totalAssets: number;
	totalLiabilities: number;
	netWorth: number;
}

export type InvestmentType =
	| "sustvest"
	| "wint_wealth"
	| "sbi_fd"
	| "ppf"
	| "stock"
	| "mf";
export type IncomeClass = "cash_yielding" | "growth";
export type ValuationSource = "compute" | "nav_api" | "manual";

export interface Investment {
	id: string;
	name: string;
	type: InvestmentType;
	/** `growth` assets (that don't pay out) are the ones eligible for imputed drawdown (ADR-0011) */
	incomeClass: IncomeClass;
	valuationSource: ValuationSource;
	isPassiveIncomeSource: boolean;
	active: boolean;
}

/** XIRR + totals for one investment (computed over its cashflows + current value as the final flow). */
export interface InvestmentXirr {
	investmentId: string;
	/** annualised money-weighted return; null when not computable */
	xirr: number | null;
	invested: number;
	currentValue: number;
	realizedPayouts: number;
}

/** Result of an ingest run / import (ADR-0013). */
export interface ImportReport {
	batchId: string;
	sourceFile: string;
	rowsTotal: number;
	rowsNew: number;
	rowsDuplicate: number;
	rowsConflict: number;
	/** true = dry-run preview only, nothing committed */
	dryRun: boolean;
}
