import { constants, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve(process.cwd(), ".env.example");
const targetPath = resolve(process.cwd(), ".env");

try {
  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  console.log("Created .env from .env.example");
} catch (error) {
  if (isFileExistsError(error)) {
    console.log("Kept existing .env (no changes made)");
  } else {
    throw error;
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
