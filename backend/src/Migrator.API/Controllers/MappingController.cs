using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Migrator.Application.Contracts;
using Migrator.Application.DTOs;
using Migrator.Domain.Entities;

namespace Migrator.API.Controllers;

[ApiController]
[Route("api")]
public class MappingController : ControllerBase
{
    private readonly IMapSchemaService _mapSchemaService;
    private readonly ILogger<MappingController> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    public MappingController(IMapSchemaService mapSchemaService, ILogger<MappingController> logger)
    {
        _mapSchemaService = mapSchemaService;
        _logger = logger;
    }

    [HttpPost("map-schema")]
    public async Task<IActionResult> MapSchema([FromBody] MapSchemaRequest request, CancellationToken cancellationToken)
    {
        if (request.SourceFiles == null || request.SourceFiles.Count == 0 ||
            request.TargetFiles == null || request.TargetFiles.Count == 0)
            return BadRequest(new { error = "Both source_files and target_files are required (array of {fileName, content})" });

        var sourceFiles = request.SourceFiles.Select(f => new RawFile(f.FileName, f.Content)).ToList();
        var targetFiles = request.TargetFiles.Select(f => new RawFile(f.FileName, f.Content)).ToList();

        try
        {
            var result = await _mapSchemaService.MapSchemaAsync(sourceFiles, targetFiles, request.UserInstruction, request.Rules, cancellationToken: cancellationToken);
            return Ok(ToJsonElement(result));
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("map-schema-stream")]
    public async Task MapSchemaStream([FromBody] MapSchemaRequest request, CancellationToken cancellationToken)
    {
        _logger.LogInformation("map-schema-stream: {SourceCount} source, {TargetCount} target files",
            request.SourceFiles?.Count ?? 0, request.TargetFiles?.Count ?? 0);

        if (request.SourceFiles == null || request.SourceFiles.Count == 0 ||
            request.TargetFiles == null || request.TargetFiles.Count == 0)
        {
            _logger.LogWarning("map-schema-stream: missing source or target files");
            Response.StatusCode = 400;
            await Response.WriteAsJsonAsync(new { error = "Both source_files and target_files are required" }, cancellationToken);
            return;
        }

        var sourceFiles = request.SourceFiles.Select(f => new RawFile(f.FileName, f.Content)).ToList();
        var targetFiles = request.TargetFiles.Select(f => new RawFile(f.FileName, f.Content)).ToList();

        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";
        Response.Headers.Append("X-Accel-Buffering", "no");
        await Response.Body.FlushAsync(cancellationToken);

        var syncLock = new SemaphoreSlim(1, 1);
        int sseEventCount = 0;
        async Task SendEventAsync(string eventType, object data, CancellationToken ct)
        {
            var json = JsonSerializer.Serialize(data);
            var payload = $"event: {eventType}\ndata: {json}\n\n";
            await syncLock.WaitAsync(ct);
            try
            {
                await Response.WriteAsync(payload, ct);
                await Response.Body.FlushAsync(ct);
                Interlocked.Increment(ref sseEventCount);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to send SSE event '{EventType}' (event #{Count})", eventType, sseEventCount);
                throw;
            }
            finally
            {
                syncLock.Release();
            }
        }

        try
        {
            Func<string, CancellationToken, Task> onToken = async (token, ct) =>
            {
                await SendEventAsync("token", new { token }, ct);
            };

            var progress = new Progress<(string Phase, string Detail)>(async p =>
            {
                try
                {
                    await SendEventAsync("progress", new { phase = p.Phase, detail = p.Detail }, cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to send progress SSE event");
                }
            });

            var result = await _mapSchemaService.MapSchemaAsync(sourceFiles, targetFiles, request.UserInstruction, request.Rules, progress, onToken, cancellationToken);

            _logger.LogInformation("map-schema-stream: sending result event ({MappingCount} mappings, {SseEvents} SSE events sent so far)",
                result.Mappings.Count, sseEventCount);
            await SendEventAsync("result", ToJsonElement(result), cancellationToken);
            _logger.LogInformation("map-schema-stream: result sent successfully ({TotalEvents} total SSE events)", sseEventCount);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("map-schema-stream: client disconnected (cancelled)");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "map-schema-stream: error after {SseEvents} SSE events", sseEventCount);
            try { await SendEventAsync("error", new { error = ex.Message }, cancellationToken); } catch { }
        }
    }

    [HttpPost("refine-mapping")]
    public async Task<IActionResult> RefineMapping([FromBody] RefineMappingRequest request, CancellationToken cancellationToken)
    {
        if (request.SourceFiles == null || request.SourceFiles.Count == 0 ||
            request.TargetFiles == null || request.TargetFiles.Count == 0 ||
            request.CurrentMapping == null ||
            string.IsNullOrWhiteSpace(request.UserMessage))
            return BadRequest(new { error = "source_files, target_files, current_mapping, and user_message are required" });

        var input = new RefineInput
        {
            SourceFiles = request.SourceFiles.Select(f => new RawFile(f.FileName, f.Content)).ToList(),
            TargetFiles = request.TargetFiles.Select(f => new RawFile(f.FileName, f.Content)).ToList(),
            CurrentMapping = MapToDomain(request.CurrentMapping),
            Messages = request.Messages.Select(m => new ChatMessage { Role = m.Role, Content = m.Content }).ToList(),
            UserMessage = request.UserMessage.Trim(),
            Rules = request.Rules
        };

        try
        {
            var result = await _mapSchemaService.RefineMappingAsync(input, cancellationToken);
            return Ok(new { mapping = ToJsonElement(result.Mapping), message = result.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private static MappingResult MapToDomain(MappingResultDto dto)
    {
        return new MappingResult
        {
            Mappings = dto.Mappings.Select(m => new MappingItem
            {
                TargetColumn = m.TargetColumn,
                SourceColumns = m.SourceColumns ?? new List<string>(),
                ConfidenceScore = m.ConfidenceScore,
                MatchType = m.MatchType ?? "semantic",
                Reasoning = m.Reasoning,
                TransformationRule = m.TransformationRule
            }).ToList(),
            UnmappedSourceColumns = dto.UnmappedSourceColumns ?? new List<string>(),
            UnmappedTargetColumns = dto.UnmappedTargetColumns ?? new List<string>(),
            GlobalConfidence = dto.GlobalConfidence,
            AnalysisSummary = dto.AnalysisSummary ?? ""
        };
    }

    private static object ToJsonElement(MappingResult result)
    {
        return new
        {
            mappings = result.Mappings.Select(m => new
            {
                target_column = m.TargetColumn,
                source_columns = m.SourceColumns,
                confidence_score = m.ConfidenceScore,
                match_type = m.MatchType,
                reasoning = m.Reasoning,
                transformation_rule = m.TransformationRule
            }),
            unmapped_source_columns = result.UnmappedSourceColumns,
            unmapped_target_columns = result.UnmappedTargetColumns,
            global_confidence = result.GlobalConfidence,
            analysis_summary = result.AnalysisSummary
        };
    }
}
