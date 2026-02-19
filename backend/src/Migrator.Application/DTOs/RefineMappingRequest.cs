using System.Text.Json.Serialization;
using Migrator.Domain.Entities;

namespace Migrator.Application.DTOs;

public class RefineMappingRequest
{
    [JsonPropertyName("source_files")]
    public List<RawFileDto> SourceFiles { get; set; } = new();

    [JsonPropertyName("target_files")]
    public List<RawFileDto> TargetFiles { get; set; } = new();

    [JsonPropertyName("current_mapping")]
    public MappingResultDto? CurrentMapping { get; set; }

    [JsonPropertyName("messages")]
    public List<ChatMessageDto> Messages { get; set; } = new();

    [JsonPropertyName("user_message")]
    public string? UserMessage { get; set; }

    [JsonPropertyName("rules")]
    public string? Rules { get; set; }
}

public class ChatMessageDto
{
    [JsonPropertyName("role")]
    public string Role { get; set; } = "user";

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class MappingResultDto
{
    [JsonPropertyName("mappings")]
    public List<MappingItemDto> Mappings { get; set; } = new();

    [JsonPropertyName("unmapped_source_columns")]
    public List<string> UnmappedSourceColumns { get; set; } = new();

    [JsonPropertyName("unmapped_target_columns")]
    public List<string> UnmappedTargetColumns { get; set; } = new();

    [JsonPropertyName("global_confidence")]
    public double GlobalConfidence { get; set; }

    [JsonPropertyName("analysis_summary")]
    public string AnalysisSummary { get; set; } = string.Empty;
}

public class MappingItemDto
{
    [JsonPropertyName("target_column")]
    public string TargetColumn { get; set; } = string.Empty;

    [JsonPropertyName("source_columns")]
    public List<string> SourceColumns { get; set; } = new();

    [JsonPropertyName("confidence_score")]
    public double ConfidenceScore { get; set; }

    [JsonPropertyName("match_type")]
    public string MatchType { get; set; } = "semantic";

    [JsonPropertyName("reasoning")]
    public string? Reasoning { get; set; }

    [JsonPropertyName("transformation_rule")]
    public string? TransformationRule { get; set; }
}
