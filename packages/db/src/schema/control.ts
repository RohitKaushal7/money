// Shared, superadmin-curated + auth schema — lives in control.db (spec §3.2, §4).
//
// Cards used to live here. They do not any more: `card_spend_profile` (monthly spend by category),
// `card_assignments`, and `cards.in_wallet`/`status` describe a PERSON's wallet, not a shared catalogue,
// so on a multi-user install they leaked between users. They are per-user state now — see ./app.ts.
export * from "./auth";
export * from "./currency";
export * from "./install";
