import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Schema, MappingResult } from "../types.js";
import { mapSchema, refineMapping } from "../services/map-schema.js";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/map-schema", async (req, res) => {
  try {
    const { source_schema, target_schema, user_instruction, rules } = req.body as {
      source_schema: Schema;
      target_schema: Schema;
      user_instruction?: string;
      rules?: string;
    };

    if (!source_schema?.columns?.length || !target_schema?.columns?.length) {
      res.status(400).json({
        error: "Both source_schema and target_schema with columns are required",
      });
      return;
    }

    const result = await mapSchema(source_schema, target_schema, user_instruction, rules);
    res.json(result);
  } catch (err) {
    console.error("Map schema error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/refine-mapping", async (req, res) => {
  try {
    const {
      source_schema,
      target_schema,
      current_mapping,
      messages,
      user_message,
      rules,
    } = req.body as {
      source_schema: Schema;
      target_schema: Schema;
      current_mapping: Record<string, unknown>;
      messages: { role: "user" | "assistant"; content: string }[];
      user_message: string;
      rules?: string;
    };

    if (
      !source_schema?.columns?.length ||
      !target_schema?.columns?.length ||
      !current_mapping ||
      !user_message?.trim()
    ) {
      res.status(400).json({
        error:
          "source_schema, target_schema, current_mapping, and user_message are required",
      });
      return;
    }

    const result = await refineMapping({
      sourceSchema: source_schema,
      targetSchema: target_schema,
      currentMapping: current_mapping as unknown as MappingResult,
      messages: messages || [],
      userMessage: user_message.trim(),
      rules,
    });
    res.json(result);
  } catch (err) {
    console.error("Refine mapping error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`Schema mapping API running on http://localhost:${PORT}`);
});
