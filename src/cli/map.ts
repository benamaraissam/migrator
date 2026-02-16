#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "fs";
import { basename } from "path";
import { mapSchema } from "../services/map-schema.js";
import type { RawFile } from "../prompts/schema-mapping.js";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: npm run map -- <source-file> <target-file> [more files...]");
  console.error("  First half of files = source, second half = target");
  process.exit(1);
}

if (
  !process.env.HF_TOKEN &&
  !process.env.HUGGINGFACE_HUB_TOKEN &&
  !process.env.LLM_API_KEY &&
  !process.env.OPENAI_API_KEY
) {
  console.error("Set HF_TOKEN, LLM_API_KEY, or OPENAI_API_KEY");
  process.exit(1);
}

const mid = Math.ceil(args.length / 2);
const sourcePaths = args.slice(0, mid);
const targetPaths = args.slice(mid);

const toRawFiles = (paths: string[]): RawFile[] =>
  paths.map((p) => ({
    fileName: basename(p),
    content: readFileSync(p, "utf-8"),
  }));

const sourceFiles = toRawFiles(sourcePaths);
const targetFiles = toRawFiles(targetPaths);

console.log(`Mapping ${sourceFiles.length} source file(s) → ${targetFiles.length} target file(s)...`);
const result = await mapSchema(sourceFiles, targetFiles);
console.log(JSON.stringify(result, null, 2));
