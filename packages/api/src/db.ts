import { controlDbPath, userAppDbPath } from "@money/analytics";
import {
	type AppDb,
	type ControlDb,
	createAppDb,
	createControlDb,
} from "@money/db";
import { dataDir } from "./paths";

/** The shared control DB (auth + curated reference). One instance per process. */
let control: ControlDb | undefined;
export function controlDb(): ControlDb {
	control ??= createControlDb(`file:${controlDbPath(dataDir())}`);
	return control;
}

/** A user's private app-state DB. Cached per uid (libSQL handles are cheap). */
const appDbs = new Map<string, AppDb>();
export function appDbFor(uid: string): AppDb {
	let d = appDbs.get(uid);
	if (!d) {
		d = createAppDb(`file:${userAppDbPath(dataDir(), uid)}`);
		appDbs.set(uid, d);
	}
	return d;
}
