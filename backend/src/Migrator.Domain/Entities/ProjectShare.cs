namespace Migrator.Domain.Entities;

/// <summary>
/// Grants a user access to another user's project (for future admin/sharing).
/// </summary>
public class ProjectShare
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;
    public string SharedWithUserId { get; set; } = string.Empty;
    /// <summary>e.g. "viewer", "editor"</summary>
    public string Role { get; set; } = "viewer";
    public DateTime SharedAt { get; set; }
}
