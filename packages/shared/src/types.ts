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

/** Asset class of an investment. The specific provider goes in `Investment.platform`. */
export const INVESTMENT_TYPES = [
	"bond",
	"p2p",
	"fd",
	"ncd",
	"savings",
	"equity",
	"mutual_fund",
	"gold",
	"other",
] as const;
export type InvestmentType = (typeof INVESTMENT_TYPES)[number];

/** `income` = pays cash (interest/coupons); `growth` = appreciates, counts at its own return in the total tier (ADR-0015). */
export type IncomeClass = "income" | "growth";
export type ValuationSource = "compute" | "nav_api" | "manual";
export type InvestmentStatus = "active" | "matured" | "closed";
export type ActionOnMaturity = "reinvest" | "withdraw" | "auto_renew";
/** `cash` = interest is deposited to the account (counts in the "cash in hand" coverage tier); `accrue` = compounds / paid at maturity. */
export type Payout = "cash" | "accrue";

/** Payout / recurrence cadences. `maturity`/`none` are non-periodic (contribute 0 to a monthly-normalised sum). */
export const CADENCES = [
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"half_yearly",
	"yearly",
	"maturity",
	"none",
] as const;
export type Cadence = (typeof CADENCES)[number];

export interface Investment {
	id: string;
	name: string;
	type: InvestmentType;
	incomeClass: IncomeClass;
	valuationSource: ValuationSource;
	isPassiveIncomeSource: boolean;
	active: boolean;
	// ── plan-driven KPI fields (2026-07-19, ADR-0011 revised) ──────────────────────────────
	/** provider/counterparty, used to reconcile against statement rows ("Wint Wealth", "SustVest") */
	platform?: string;
	/** rollup bucket — holdings sharing a group nest under one weighted-avg header ("SustVest", "Wint", "FDs") */
	group?: string;
	/** cash = interest deposited to the account; accrue = compounds / paid at maturity */
	payout?: Payout;
	/** invested amount / cost basis (INR) */
	principal?: number;
	/** expected annual interest rate as a fraction, e.g. 0.11 (income investments) */
	annualRate?: number;
	/** explicit expected monthly interest (INR) — overrides principal×rate/12 for amortising instruments */
	expectedMonthlyInterest?: number;
	interestCadence?: Cadence;
	principalCadence?: Cadence;
	/** YYYY-MM-DD */
	startDate?: string;
	/** YYYY-MM-DD */
	maturityDate?: string;
	actionOnMaturity?: ActionOnMaturity;
	/** latest known value (in `currency`) — feeds the wealth rollup + net-worth log */
	currentValue?: number;
	/** ISO 4217 code the monetary fields are stored in (default INR); normalised to INR for aggregate math */
	currency?: string;
	status?: InvestmentStatus;
}

/** A committed recurring outflow — the KPI denominator (ADR-0011). One-off spend does NOT belong here. */
export interface RecurringExpense {
	id: string;
	name: string;
	category?: string;
	/** amount per period (i.e. per `cadence`), in `currency` */
	amount: number;
	/** ISO 4217 code `amount` is stored in (default INR) */
	currency?: string;
	cadence: Cadence;
	active: boolean;
	/** YYYY-MM-DD */
	startDate?: string;
	/** YYYY-MM-DD */
	endDate?: string;
	source?: "manual" | "seeded";
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
