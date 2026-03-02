namespace Migrator.Domain.Entities;

/// <summary>
/// A saved session/project: source/target files, chat, mapping, rules.
/// Owned by a user (via OwnerUserId); can be shared with others later.
/// </summary>
public class Project
{
    public Guid Id { get; set; }
    /// <summary>Owner: Azure AD OID or anonymous cookie id until auth is enabled.</summary>
    public string OwnerUserId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string SourceFilesJson { get; set; } = "[]";
    public string TargetFilesJson { get; set; } = "[]";
    public string ChatHistoryJson { get; set; } = "[]";
    public string? CurrentMappingJson { get; set; }
    public string RulesJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
