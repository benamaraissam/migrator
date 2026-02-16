import "dotenv/config";
import express from "express";
import cors from "cors";
import type { MappingResult } from "../types.js";
import type { RawFile } from "../prompts/schema-mapping.js";
import { mapSchema, refineMapping } from "../services/map-schema.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.post("/api/map-schema", async (req, res) => {
  try {
    const { source_files, target_files, user_instruction, rules } = req.body as {
      source_files: RawFile[];
      target_files: RawFile[];
      user_instruction?: string;
      rules?: string;
    };

    if (!source_files?.length || !target_files?.length) {
      res.status(400).json({
        error: "Both source_files and target_files are required (array of {fileName, content})",
      });
      return;
    }

    const result = await mapSchema(source_files, target_files, user_instruction, rules);
    res.json(result);
  } catch (err) {
    console.error("Map schema error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// SSE endpoint for progress-aware mapping (used by frontend for real-time updates)
app.post("/api/map-schema-stream", async (req, res) => {
  const { source_files, target_files, user_instruction, rules } = req.body as {
    source_files: RawFile[];
    target_files: RawFile[];
    user_instruction?: string;
    rules?: string;
  };

  if (!source_files?.length || !target_files?.length) {
    res.status(400).json({
      error: "Both source_files and target_files are required",
    });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await mapSchema(
      source_files,
      target_files,
      user_instruction,
      rules,
      (phase, detail) => {
        sendEvent("progress", { phase, detail });
      }
    );
    sendEvent("result", result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendEvent("error", { error: message });
  } finally {
    res.end();
  }
});

app.post("/api/refine-mapping", async (req, res) => {
  try {
    const {
      source_files,
      target_files,
      current_mapping,
      messages,
      user_message,
      rules,
    } = req.body as {
      source_files: RawFile[];
      target_files: RawFile[];
      current_mapping: Record<string, unknown>;
      messages: { role: "user" | "assistant"; content: string }[];
      user_message: string;
      rules?: string;
    };

    if (
      !source_files?.length ||
      !target_files?.length ||
      !current_mapping ||
      !user_message?.trim()
    ) {
      res.status(400).json({
        error:
          "source_files, target_files, current_mapping, and user_message are required",
      });
      return;
    }

    const result = await refineMapping({
      sourceFiles: source_files,
      targetFiles: target_files,
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
