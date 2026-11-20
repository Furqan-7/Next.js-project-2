import { readFile } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
export const resumePath = (userId: string) => path.join(UPLOAD_DIR, `${userId}.pdf`);

export async function readResume(userId: string): Promise<Buffer | null> {
  try {
    return await readFile(resumePath(userId));
  } catch {
    return null;
  }
}
