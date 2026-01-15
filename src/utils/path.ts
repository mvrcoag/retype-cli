import * as path from "path";
import * as fs from "fs";

export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, "/");
}

export function getRelativePath(from: string, to: string): string {
  const relativePath = path.relative(path.dirname(from), to);
  const normalized = normalizePath(relativePath);

  if (!normalized.startsWith(".")) {
    return "./" + normalized;
  }

  return normalized;
}

export function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveFromCwd(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

export function getFileExtension(filePath: string): string {
  return path.extname(filePath);
}

export function removeExtension(filePath: string): string {
  const ext = path.extname(filePath);
  return filePath.slice(0, -ext.length);
}

export function isTypeScriptFile(filePath: string): boolean {
  const ext = getFileExtension(filePath).toLowerCase();
  return ext === ".ts" || ext === ".tsx";
}
