using System.Text.Json.Serialization;

namespace Migrator.Application.DTOs;

public class ProjectListDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("updated_at")]
    public string UpdatedAt { get; set; } = string.Empty;

    [JsonPropertyName("is_owner")]
    public bool IsOwner { get; set; }

    [JsonPropertyName("owner_user_id")]
    public string? OwnerUserId { get; set; }

    [JsonPropertyName("owner_display_name")]
    public string? OwnerDisplayName { get; set; }
}

public class SharedWithDto
{
    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("display_name")]
    public string? DisplayName { get; set; }

    [JsonPropertyName("role")]
    public string Role { get; set; } = "viewer";

    [JsonPropertyName("shared_at")]
    public string SharedAt { get; set; } = string.Empty;
}

public class ProjectGetDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = string.Empty;

    [JsonPropertyName("updated_at")]
    public string UpdatedAt { get; set; } = string.Empty;

    [JsonPropertyName("is_owner")]
    public bool IsOwner { get; set; }

    [JsonPropertyName("owner_user_id")]
    public string? OwnerUserId { get; set; }

    [JsonPropertyName("owner_display_name")]
    public string? OwnerDisplayName { get; set; }

    [JsonPropertyName("shared_with")]
    public List<SharedWithDto> SharedWith { get; set; } = new();

    [JsonPropertyName("source_files")]
    public List<RawFileDto> SourceFiles { get; set; } = new();

    [JsonPropertyName("target_files")]
    public List<RawFileDto> TargetFiles { get; set; } = new();

    [JsonPropertyName("chat_history")]
    public List<ChatMessageDto> ChatHistory { get; set; } = new();

    [JsonPropertyName("current_mapping")]
    public MappingResultDto? CurrentMapping { get; set; }

    [JsonPropertyName("rules")]
    public List<RuleItemDto> Rules { get; set; } = new();
}

public class RuleItemDto
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class ProjectCreateDto
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("source_files")]
    public List<RawFileDto> SourceFiles { get; set; } = new();

    [JsonPropertyName("target_files")]
    public List<RawFileDto> TargetFiles { get; set; } = new();

    [JsonPropertyName("chat_history")]
    public List<ChatMessageDto> ChatHistory { get; set; } = new();

    [JsonPropertyName("current_mapping")]
    public MappingResultDto? CurrentMapping { get; set; }

    [JsonPropertyName("rules")]
    public List<RuleItemDto> Rules { get; set; } = new();
}

public class ProjectUpdateDto
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("source_files")]
    public List<RawFileDto>? SourceFiles { get; set; }

    [JsonPropertyName("target_files")]
    public List<RawFileDto>? TargetFiles { get; set; }

    [JsonPropertyName("chat_history")]
    public List<ChatMessageDto>? ChatHistory { get; set; }

    [JsonPropertyName("current_mapping")]
    public MappingResultDto? CurrentMapping { get; set; }

    [JsonPropertyName("rules")]
    public List<RuleItemDto>? Rules { get; set; }
}

public class ProjectShareRequestDto
{
    [JsonPropertyName("shared_with_user_ids")]
    public List<string> SharedWithUserIds { get; set; } = new();

    [JsonPropertyName("role")]
    public string Role { get; set; } = "viewer";

    /// <summary>Optional display names for the shared users (user_id -> display_name). Stored so names show in UI.</summary>
    [JsonPropertyName("display_names")]
    public Dictionary<string, string>? DisplayNames { get; set; }
}

/// <summary>User suggestion for share dropdown (user_id + display_name).</summary>
public class UserSuggestDto
{
    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("display_name")]
    public string? DisplayName { get; set; }
}
