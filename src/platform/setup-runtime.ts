import path from "node:path";

export function setupRuntimeExecutable(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.OMP_COMPUTER_USE_BUN_PATH?.trim();
	if (configured) return configured;

	const bunInstall = env.BUN_INSTALL?.trim();
	if (bunInstall) {
		return path.join(bunInstall, "bin", process.platform === "win32" ? "bun.exe" : "bun");
	}

	return process.platform === "win32" ? "bun.exe" : "bun";
}
