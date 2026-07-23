/**
 * Turn a CSV string into a browser download. Pure DOM: Blob → object URL → transient <a download> → click →
 * revoke. No dependencies.
 */
export function downloadCsv(filename: string, csv: string): void {
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/** `money-<dataset>-<YYYY-MM-DD>.csv`, using the browser clock. */
export function csvFilename(dataset: string): string {
	const now = new Date();
	const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
		2,
		"0",
	)}-${String(now.getDate()).padStart(2, "0")}`;
	return `money-${dataset}-${ymd}.csv`;
}
