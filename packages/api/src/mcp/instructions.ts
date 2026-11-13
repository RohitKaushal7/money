/** Sent to Claude in the MCP `initialize` result: how to read this server's numbers and use its tools. */
export const MCP_INSTRUCTIONS = `This server is a self-hosted personal-finance app for one person in India. Its tools read and change that person's own financial plan, holdings, spending and tax records.

How to read the numbers:
- Amounts are in INR unless a row says otherwise (a holding or expense can carry its own currency).
- Years are Indian financial years, April 1 to March 31 (FY 2025-26 runs from 2025-04-01 to 2026-03-31).
- Rates are pre-tax fractions: 0.1175 means 11.75% a year.
- "value" means a holding's current value today, not the amount invested.

How to work:
- Before a bulk edit of holdings, call update_holdings in preview mode first and show the person what will change.
- After changing categorisation rules, transaction overrides or splits, run ingest_retag so the analytics reflect them.

What matters: the north-star number is passive income divided by monthly expenses — how much of the person's monthly spending their investments cover — and whether that ratio is trending up.`;
