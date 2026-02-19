using System.Text.RegularExpressions;
using Migrator.Domain.Entities;

namespace Migrator.Infrastructure.Services;

public enum CompressionLevel { Light, Medium, Heavy }

public static class FileCompressor
{
    private const int ResponseBuffer = 4000;
    private static readonly string[] SchemaKeywords = ["table", "column", "field", "type", "schema", "description", "comment", "nullable"];

    public static int EstimateTokens(string text) => (int)Math.Ceiling(text.Length / 4.0);

    public static int EstimatePromptTokens(
        string systemPrompt,
        IReadOnlyList<RawFile> sourceFiles,
        IReadOnlyList<RawFile> targetFiles,
        string? userInstruction,
        string? rules)
    {
        int total = EstimateTokens(systemPrompt);
        foreach (var f in sourceFiles)
            total += EstimateTokens(f.Content) + EstimateTokens(f.FileName) + 20;
        foreach (var f in targetFiles)
            total += EstimateTokens(f.Content) + EstimateTokens(f.FileName) + 20;
        if (!string.IsNullOrWhiteSpace(userInstruction))
            total += EstimateTokens(userInstruction);
        if (!string.IsNullOrWhiteSpace(rules))
            total += EstimateTokens(rules);
        total += 200 + ResponseBuffer;
        return total;
    }

    public static List<RawFile> CompressFiles(IReadOnlyList<RawFile> files, CompressionLevel level)
        => files.Select(f => CompressFile(f, level)).ToList();

    public static RawFile CompressFile(RawFile file, CompressionLevel level)
    {
        var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        var content = file.Content;
        int dataRows = level == CompressionLevel.Heavy ? 3 : level == CompressionLevel.Medium ? 6 : 21;
        int jsonObjects = level == CompressionLevel.Heavy ? 1 : level == CompressionLevel.Medium ? 2 : 5;
        int textLines = level == CompressionLevel.Heavy ? 50 : level == CompressionLevel.Medium ? 100 : 500;

        if (ext is "csv" or "tsv" or "txt")
        {
            var lines = content.Split('\n').Where(l => l.Trim().Length > 0).ToArray();
            if (lines.Length <= dataRows) return file;

            if (LooksLikeSchemaFile(lines[0]))
            {
                if (level == CompressionLevel.Light) return file;

                var delimiter = lines[0].Contains('\t') ? "\t" : lines[0].Contains(';') ? ";" : ",";
                var headerCells = lines[0].Split(delimiter).Select(h => h.Trim().ToLowerInvariant()).ToArray();

                if (level == CompressionLevel.Heavy)
                {
                    string[] essentialKw = ["table", "column", "field", "name", "type", "data_type", "datatype"];
                    var essentialIdx = headerCells
                        .Select((h, i) => essentialKw.Any(kw => h.Contains(kw)) ? i : -1)
                        .Where(i => i != -1).ToArray();

                    if (essentialIdx.Length >= 2)
                    {
                        var stripped = lines.Select(line =>
                        {
                            var cells = line.Split(delimiter);
                            return string.Join(delimiter, essentialIdx.Select(i => i < cells.Length ? cells[i].Trim() : ""));
                        });
                        return new RawFile(file.FileName,
                            string.Join("\n", stripped) + $"\n(compressed: kept {essentialIdx.Length} of {headerCells.Length} columns)");
                    }
                }

                var strippedLines = lines.Select(line =>
                {
                    var cells = line.Split(delimiter);
                    return string.Join(delimiter, cells.Select(c => c.Length > 50 ? c[..50] + "..." : c));
                });
                return new RawFile(file.FileName, string.Join("\n", strippedLines));
            }

            var kept = string.Join("\n", lines.Take(dataRows));
            return new RawFile(file.FileName,
                kept + $"\n... ({lines.Length - dataRows} more data rows, {lines.Length} total)");
        }

        if (ext == "json")
        {
            try
            {
                var doc = System.Text.Json.JsonDocument.Parse(content);
                if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    var arr = doc.RootElement.EnumerateArray().ToList();
                    if (arr.Count > jsonObjects)
                    {
                        var slice = arr.Take(jsonObjects).Select(e => e.GetRawText());
                        var compressed = "[\n" + string.Join(",\n", slice) + "\n]";
                        return new RawFile(file.FileName,
                            compressed + $"\n// ... ({arr.Count - jsonObjects} more objects, {arr.Count} total)");
                    }
                }
            }
            catch { /* not valid JSON, treat as text */ }

            var jsonLines = content.Split('\n');
            if (jsonLines.Length > textLines)
                return new RawFile(file.FileName,
                    string.Join("\n", jsonLines.Take(textLines)) + $"\n... (truncated from {jsonLines.Length} lines)");
            return file;
        }

        var txtLines = content.Split('\n');
        if (txtLines.Length > textLines)
            return new RawFile(file.FileName,
                string.Join("\n", txtLines.Take(textLines)) + $"\n... (truncated from {txtLines.Length} lines)");
        return file;
    }

    private static bool LooksLikeSchemaFile(string firstLine)
    {
        var lower = firstLine.ToLowerInvariant();
        return SchemaKeywords.Count(kw => lower.Contains(kw)) >= 2;
    }
}
