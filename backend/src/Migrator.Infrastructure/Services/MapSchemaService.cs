using System.ClientModel;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Migrator.Application.Contracts;
using Migrator.Domain.Entities;
using Migrator.Infrastructure.Prompts;
using OpenAI;
using OpenAI.Chat;

namespace Migrator.Infrastructure.Services;

public class MapSchemaService : IMapSchemaService
{
    private readonly ILogger<MapSchemaService> _logger;
    private readonly ChatClient _chatClient;
    private readonly string _model;

    public MapSchemaService(IConfiguration configuration, ILogger<MapSchemaService> logger)
    {
        _logger = logger;
        var apiKey = configuration["HF_TOKEN"];
        if (string.IsNullOrEmpty(apiKey)) apiKey = configuration["LLM_API_KEY"];
        if (string.IsNullOrEmpty(apiKey)) apiKey = configuration["OPENAI_API_KEY"];
        var baseUrl = configuration["LLM_BASE_URL"];
        _model = configuration["LLM_MODEL"] ?? configuration["OPENAI_MODEL"] ?? "gpt-4o-mini";

        if (int.TryParse(configuration["LLM_MAX_TOKENS"], out var maxTok) && maxTok > 0)
            _maxTokens = maxTok;

        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException("Set LLM_API_KEY, OPENAI_API_KEY, or HF_TOKEN");

        _logger.LogInformation("LLM config: model={Model}, baseUrl={BaseUrl}, maxTokens={MaxTokens}", _model, baseUrl ?? "(default OpenAI)", _maxTokens);

        var credential = new ApiKeyCredential(apiKey);
        if (!string.IsNullOrEmpty(baseUrl))
        {
            var options = new OpenAIClientOptions { Endpoint = new Uri(baseUrl) };
            _chatClient = new ChatClient(_model, credential, options);
        }
        else
        {
            _chatClient = new ChatClient(_model, apiKey);
        }
    }

    private int _maxTokens = 128000;

    public async Task<MappingResult> MapSchemaAsync(
        IReadOnlyList<RawFile> sourceFiles,
        IReadOnlyList<RawFile> targetFiles,
        string? userInstruction = null,
        string? rules = null,
        IProgress<(string Phase, string Detail)>? onProgress = null,
        Func<string, CancellationToken, Task>? onToken = null,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("MapSchemaAsync called: {SourceCount} source files, {TargetCount} target files, model={Model}",
            sourceFiles.Count, targetFiles.Count, _model);

        var (effectiveSource, effectiveTarget, tier) = SelectCompressionTier(sourceFiles, targetFiles, userInstruction, rules, onProgress);

        _logger.LogInformation("Using compression tier {Tier}", tier);

        var userPrompt = SchemaMappingPrompts.BuildUserPrompt(effectiveSource, effectiveTarget, userInstruction, rules);
        var promptTokens = FileCompressor.EstimateTokens(SchemaMappingPrompts.SystemPrompt + userPrompt);
        _logger.LogInformation("Final prompt: ~{Tokens} estimated tokens, {Chars} chars", promptTokens, userPrompt.Length);

        return await CallLlm(userPrompt, onToken, cancellationToken);
    }

    private (IReadOnlyList<RawFile> source, IReadOnlyList<RawFile> target, string tier) SelectCompressionTier(
        IReadOnlyList<RawFile> sourceFiles,
        IReadOnlyList<RawFile> targetFiles,
        string? userInstruction,
        string? rules,
        IProgress<(string Phase, string Detail)>? onProgress)
    {
        var fullTokens = FileCompressor.EstimatePromptTokens(SchemaMappingPrompts.SystemPrompt, sourceFiles, targetFiles, userInstruction, rules);
        _logger.LogInformation("[Token mgmt] Full prompt: ~{Tokens} tokens, limit: {Limit}", fullTokens, _maxTokens);

        if (fullTokens <= _maxTokens)
        {
            onProgress?.Report(("mapping", "Sending all files to LLM (fits in context)..."));
            return (sourceFiles, targetFiles, "Tier 1 (raw)");
        }

        var lightSource = FileCompressor.CompressFiles(sourceFiles, CompressionLevel.Light);
        var lightTarget = FileCompressor.CompressFiles(targetFiles, CompressionLevel.Light);
        var lightTokens = FileCompressor.EstimatePromptTokens(SchemaMappingPrompts.SystemPrompt, lightSource, lightTarget, userInstruction, rules);
        _logger.LogInformation("[Token mgmt] Light compressed: ~{Tokens} tokens", lightTokens);

        if (lightTokens <= _maxTokens)
        {
            onProgress?.Report(("mapping", "Light compression applied (CSV trimmed to ~20 rows), sending to LLM..."));
            return (lightSource, lightTarget, "Tier 2 (light)");
        }

        var medSource = FileCompressor.CompressFiles(sourceFiles, CompressionLevel.Medium);
        var medTarget = FileCompressor.CompressFiles(targetFiles, CompressionLevel.Medium);
        var medTokens = FileCompressor.EstimatePromptTokens(SchemaMappingPrompts.SystemPrompt, medSource, medTarget, userInstruction, rules);
        _logger.LogInformation("[Token mgmt] Medium compressed: ~{Tokens} tokens", medTokens);

        if (medTokens <= _maxTokens)
        {
            onProgress?.Report(("mapping", "Medium compression applied (CSV trimmed to ~6 rows), sending to LLM..."));
            return (medSource, medTarget, "Tier 3 (medium)");
        }

        var heavySource = FileCompressor.CompressFiles(sourceFiles, CompressionLevel.Heavy);
        var heavyTarget = FileCompressor.CompressFiles(targetFiles, CompressionLevel.Heavy);
        var heavyTokens = FileCompressor.EstimatePromptTokens(SchemaMappingPrompts.SystemPrompt, heavySource, heavyTarget, userInstruction, rules);
        _logger.LogInformation("[Token mgmt] Heavy compressed: ~{Tokens} tokens", heavyTokens);

        onProgress?.Report(("mapping", "Heavy compression applied (schema-only extraction), sending to LLM..."));
        return (heavySource, heavyTarget, "Tier 4 (heavy)");
    }

    private async Task<MappingResult> CallLlm(
        string userPrompt,
        Func<string, CancellationToken, Task>? onToken,
        CancellationToken cancellationToken)
    {
        var messages = new List<OpenAI.Chat.ChatMessage>
        {
            new SystemChatMessage(SchemaMappingPrompts.SystemPrompt),
            new UserChatMessage(userPrompt)
        };

        var options = new ChatCompletionOptions { Temperature = 0.2f };
        if (OperatingSystem.IsBrowser() == false)
            options.ResponseFormat = ChatResponseFormat.CreateJsonObjectFormat();

        string fullContent;
        if (onToken != null)
        {
            _logger.LogInformation("Starting streaming completion...");
            fullContent = "";
            int tokenCount = 0;
            try
            {
                var stream = _chatClient.CompleteChatStreamingAsync(messages, options, cancellationToken);
                await foreach (var update in stream)
                {
                    if (update.ContentUpdate.Count > 0)
                    {
                        var text = update.ContentUpdate[0].Text;
                        if (!string.IsNullOrEmpty(text))
                        {
                            fullContent += text;
                            tokenCount++;
                            await onToken(text, cancellationToken);
                        }
                    }
                }
                _logger.LogInformation("Streaming complete: {TokenCount} chunks, {ContentLength} chars total", tokenCount, fullContent.Length);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Error during streaming after {TokenCount} chunks ({ContentLength} chars)", tokenCount, fullContent.Length);
                throw;
            }
        }
        else
        {
            _logger.LogInformation("Starting non-streaming completion...");
            try
            {
                var completion = await _chatClient.CompleteChatAsync(messages, options, cancellationToken);
                fullContent = completion.Value.Content[0].Text ?? "";
                _logger.LogInformation("Non-streaming completion done: {ContentLength} chars", fullContent.Length);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Error during non-streaming completion");
                throw;
            }
        }

        if (string.IsNullOrWhiteSpace(fullContent))
        {
            _logger.LogError("LLM returned empty response");
            throw new InvalidOperationException("No response from LLM — the model returned an empty response. This may happen if the prompt is too large for the model's context window.");
        }

        try
        {
            var jsonStr = ExtractJsonString(fullContent);
            _logger.LogDebug("Extracted JSON length: {Length}", jsonStr.Length);
            var result = ValidateResult(JsonSerializer.Deserialize<JsonElement>(jsonStr));
            _logger.LogInformation("Mapping result: {MappingCount} mappings, {UnmappedSource} unmapped source, {UnmappedTarget} unmapped target, confidence={Confidence:F1}%",
                result.Mappings.Count, result.UnmappedSourceColumns.Count, result.UnmappedTargetColumns.Count, result.GlobalConfidence);
            return result;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Failed to parse LLM response. First 500 chars: {Preview}", fullContent[..Math.Min(500, fullContent.Length)]);
            throw;
        }
    }

    public async Task<RefineResult> RefineMappingAsync(RefineInput input, CancellationToken cancellationToken = default)
    {
        var contextBlock = "\n=== SOURCE FILES ===\n";
        foreach (var f in input.SourceFiles)
            contextBlock += $"\n--- File: {f.FileName} ---\n{f.Content}\n";
        contextBlock += "\n=== TARGET FILES ===\n";
        foreach (var f in input.TargetFiles)
            contextBlock += $"\n--- File: {f.FileName} ---\n{f.Content}\n";
        contextBlock += $"\nCURRENT_MAPPING:\n{JsonSerializer.Serialize(input.CurrentMapping, new JsonSerializerOptions { WriteIndented = true })}\n";
        if (!string.IsNullOrWhiteSpace(input.Rules))
            contextBlock += $"\nADDITIONAL RULES (you MUST follow these):\n{input.Rules!.Trim()}\n";

        var messages = new List<OpenAI.Chat.ChatMessage>
        {
            new SystemChatMessage(SchemaMappingPrompts.RefineSystemPrompt + "\n\n" + contextBlock)
        };
        foreach (var msg in input.Messages)
            messages.Add(msg.Role == "assistant" ? new AssistantChatMessage(msg.Content) : new UserChatMessage(msg.Content));
        messages.Add(new UserChatMessage(input.UserMessage));

        var options = new ChatCompletionOptions { Temperature = 0.3f };
        if (OperatingSystem.IsBrowser() == false)
            options.ResponseFormat = ChatResponseFormat.CreateJsonObjectFormat();

        var completion = await _chatClient.CompleteChatAsync(messages, options, cancellationToken);
        var content = completion.Value.Content[0].Text;
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException("No response from LLM");

        var jsonStr = ExtractJsonString(content);
        using var doc = JsonDocument.Parse(jsonStr);
        var root = doc.RootElement;
        var mappingEl = root.TryGetProperty("mapping", out var mappingProp) ? mappingProp : root;
        var mapping = ValidateResult(mappingEl);
        var resultMessage = root.TryGetProperty("message", out var msgProp) ? msgProp.GetString() ?? "Mapping updated." : "Mapping updated.";
        return new RefineResult { Mapping = mapping, Message = resultMessage };
    }

    private static string ExtractJsonString(string raw)
    {
        var fenced = Regex.Match(raw, @"```(?:json)?\s*([\s\S]*?)```");
        if (fenced.Success)
            return fenced.Groups[1].Value.Trim();
        var start = raw.IndexOf('{');
        var end = raw.LastIndexOf('}');
        if (start >= 0 && end > start)
        {
            var candidate = raw[start..(end + 1)];
            var cleaned = Regex.Replace(candidate, @",\s*}", "}").Replace(", ]", "]");
            return cleaned;
        }
        throw new InvalidOperationException($"Failed to extract JSON from response. Starts with: {raw[..Math.Min(200, raw.Length)]}...");
    }

    private static MappingResult ValidateResult(JsonElement el)
    {
        var rawMappings = new List<JsonElement>();
        if (el.TryGetProperty("mappings", out var arr1))
            foreach (var x in arr1.EnumerateArray()) rawMappings.Add(x);
        else if (el.TryGetProperty("mapping", out var arr2))
            foreach (var x in arr2.EnumerateArray()) rawMappings.Add(x);

        var byTarget = new Dictionary<string, MappingItem>();
        foreach (var m in rawMappings)
        {
            var norm = NormalizeMapping(m);
            if (norm == null) continue;
            if (byTarget.TryGetValue(norm.TargetColumn, out var existing))
            {
                var merged = existing.SourceColumns.Union(norm.SourceColumns).Distinct().ToList();
                byTarget[norm.TargetColumn] = new MappingItem
                {
                    TargetColumn = norm.TargetColumn,
                    SourceColumns = merged,
                    ConfidenceScore = Math.Max(existing.ConfidenceScore, norm.ConfidenceScore),
                    MatchType = norm.MatchType,
                    Reasoning = norm.Reasoning ?? existing.Reasoning,
                    TransformationRule = norm.TransformationRule ?? existing.TransformationRule
                };
            }
            else
                byTarget[norm.TargetColumn] = norm;
        }

        var mappings = byTarget.Values.ToList();
        var globalConf = mappings.Count > 0 ? mappings.Average(x => x.ConfidenceScore) : 0.0;
        return new MappingResult
        {
            Mappings = mappings,
            UnmappedSourceColumns = GetStringList(el, "unmapped_source_columns"),
            UnmappedTargetColumns = GetStringList(el, "unmapped_target_columns"),
            GlobalConfidence = el.TryGetProperty("global_confidence", out var gc) && gc.TryGetDouble(out var g) ? g : globalConf,
            AnalysisSummary = el.TryGetProperty("analysis_summary", out var asum) ? asum.GetString() ?? "" : ""
        };
    }

    private static MappingItem? NormalizeMapping(JsonElement row)
    {
        var targetTable = row.TryGetProperty("target_table", out var tt) ? tt.GetString() : null;
        var sourceTable = row.TryGetProperty("source_table", out var st) ? st.GetString() : null;
        var target = row.TryGetProperty("target_column", out var tc) ? tc.GetString() : (row.TryGetProperty("target", out var t) ? t.GetString() : null);
        if (string.IsNullOrEmpty(target)) return null;
        if (!string.IsNullOrEmpty(targetTable) && !target.Contains('.'))
            target = $"{targetTable}.{target}";

        var sourceCols = GetStringList(row, "source_columns") ?? (row.TryGetProperty("source_column", out var sc) ? new List<string> { sc.GetString() ?? "" } : null) ?? (row.TryGetProperty("source", out var s) ? new List<string> { s.GetString() ?? "" } : null) ?? new List<string>();
        if (!string.IsNullOrEmpty(sourceTable))
            sourceCols = sourceCols.Select(c => c.Contains('.') ? c : $"{sourceTable}.{c}").ToList();

        var transformationRule = row.TryGetProperty("transformation_rule", out var tr) ? tr.GetString() : (row.TryGetProperty("transformation", out var tr2) ? tr2.GetString() : null);
        var reasoning = row.TryGetProperty("reasoning", out var r) ? r.GetString() ?? "" : (row.TryGetProperty("reason", out var r2) ? r2.GetString() ?? "" : "");
        var matchType = row.TryGetProperty("match_type", out var mt) ? mt.GetString() : "semantic";
        if (string.IsNullOrEmpty(matchType) || !new[] { "exact", "semantic", "transformed", "derived", "incompatible" }.Contains(matchType))
            matchType = "semantic";

        var confidence = row.TryGetProperty("confidence_score", out var cs) && cs.TryGetDouble(out var c1) ? c1 : (row.TryGetProperty("confidence", out var c) && c.TryGetDouble(out var c2) ? c2 : 0.0);

        return new MappingItem
        {
            TargetColumn = target,
            SourceColumns = sourceCols,
            ConfidenceScore = confidence,
            MatchType = matchType,
            Reasoning = reasoning,
            TransformationRule = transformationRule
        };
    }

    private static List<string> GetStringList(JsonElement el, string key)
    {
        if (!el.TryGetProperty(key, out var arr)) return new List<string>();
        var list = new List<string>();
        foreach (var x in arr.EnumerateArray())
        {
            var s = x.GetString();
            if (!string.IsNullOrEmpty(s)) list.Add(s);
        }
        return list;
    }
}
