import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Resolves an upload path and refuses anything outside UPLOAD_DIR, including via "../" or symlinks.
 * This stops a prompt-injected instruction from uploading e.g. ~/.ssh/id_rsa or the project's .env.
 */
export function resolveUploadPath(value: string, uploadDir = config.uploadDir): string {
  if (!existsSync(uploadDir)) {
    throw new Error(`Upload folder does not exist: ${uploadDir}. Create it (or set UPLOAD_DIR) and put test files there.`);
  }
  const root = realpathSync(uploadDir);
  const candidate = path.resolve(root, value);
  if (!existsSync(candidate)) throw new Error(`Upload file not found in UPLOAD_DIR: ${value}`);
  const real = realpathSync(candidate);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`Upload refused: files must be inside UPLOAD_DIR (${root}).`);
  }
  if (!statSync(real).isFile()) throw new Error(`Upload path is not a file: ${value}`);
  return real;
}
