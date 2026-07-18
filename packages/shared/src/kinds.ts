/**
 * The two orthogonal classification axes of the ledger (ADR-0012).
 *
 * `Kind` is a transaction split's KPI/accounting role. `CashflowType` describes an investment-linked
 * split's role in that investment's XIRR cashflow ledger. They are independent: a bond coupon is
 * `kind = "passive_income"` AND `cashflowType = "coupon"`.
 */

/** KPI/accounting role of a transaction split. */
export const KINDS = [
	"active_income",
	"passive_income",
	"expense",
	"investment",
	"transfer",
] as const;
export type Kind = (typeof KINDS)[number];

/** Role of an investment-linked split within that investment's cashflow ledger (XIRR). */
export const CASHFLOW_TYPES = [
	"contribution",
	"coupon",
	"dividend",
	"redemption",
	"maturity",
] as const;
export type CashflowType = (typeof CASHFLOW_TYPES)[number];

/** KPI numerator = this kind (+ optional imputed drawdown); see ADR-0011. */
export const KPI_NUMERATOR_KIND: Kind = "passive_income";
/** KPI denominator = this kind. `investment` and `transfer` are excluded from the ratio entirely. */
export const KPI_DENOMINATOR_KIND: Kind = "expense";
