using System.Text.Json.Serialization;

namespace Migrator.Application.DTOs;

public class MapSchemaRequest
{
    [JsonPropertyName("source_files")]
    public List<RawFileDto> SourceFiles { get; set; } = new();

    [JsonPropertyName("target_files")]
    public List<RawFileDto> TargetFiles { get; set; } = new();

    [JsonPropertyName("user_instruction")]
    public string? UserInstruction { get; set; }

    [JsonPropertyName("rules")]
    public string? Rules { get; set; }
}

public class RawFileDto
{
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}
