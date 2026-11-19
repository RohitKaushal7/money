import type { KeyboardEvent } from "react";

/**
 * The phone keyboard's "Next" key for a form field marked `enterKeyHint="next"`: it moves to the form's
 * next field instead of submitting a half-filled form (iOS sends Enter for that key, which a form takes as
 * submit). Phone width only, so a desktop Enter still submits from any field, as it always has.
 */
export function enterToNextField(e: KeyboardEvent<HTMLInputElement>) {
	if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
	if (!window.matchMedia("(max-width: 767px)").matches) return;
	const form = e.currentTarget.form;
	if (!form) return;
	const fields = [...form.elements].filter(
		(el): el is HTMLInputElement =>
			el instanceof HTMLInputElement &&
			el.type !== "hidden" &&
			!el.disabled &&
			el.tabIndex >= 0 &&
			el.getClientRects().length > 0,
	);
	const next = fields[fields.indexOf(e.currentTarget) + 1];
	if (!next) return;
	e.preventDefault();
	next.focus();
}
