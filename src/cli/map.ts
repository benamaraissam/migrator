#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "fs";
import { mapSchema } from "../services/map-schema.js";
import type { Schema } from "../types.js";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: npm run map -- <source-schema.json> <target-schema.json>");
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

const [sourcePath, targetPath] = args;
const sourceSchema = JSON.parse(readFileSync(sourcePath, "utf-8")) as Schema;
const targetSchema = JSON.parse(readFileSync(targetPath, "utf-8")) as Schema;

console.log("Mapping schemas...");
const result = await mapSchema(sourceSchema, targetSchema);
console.log(JSON.stringify(result, null, 2));
