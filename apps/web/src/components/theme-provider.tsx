import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type * as React from "react";
import { useEffect } from "react";

/**
 * The status-bar colour of each theme: index.css's --background, as hex because `theme-color` predates
 * oklch in some browsers. Mirrored by the pre-paint script in index.html.
 */
const THEME_COLORS = { light: "#fdfbf7", dark: "#14110e" } as const;

/** Keeps `<meta name="theme-color">` on the resolved theme, so the phone's status bar matches the app. */
function ThemeColorSync() {
	const { resolvedTheme } = useTheme();
	useEffect(() => {
		const meta = document.querySelector('meta[name="theme-color"]');
		if (!meta) return;
		meta.setAttribute(
			"content",
			resolvedTheme === "light" ? THEME_COLORS.light : THEME_COLORS.dark,
		);
	}, [resolvedTheme]);
	return null;
}

export function ThemeProvider({
	children,
	...props
}: React.ComponentProps<typeof NextThemesProvider>) {
	return (
		<NextThemesProvider {...props}>
			<ThemeColorSync />
			{children}
		</NextThemesProvider>
	);
}

export { useTheme };
