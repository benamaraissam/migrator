namespace Migrator.Domain.Entities;

/// <summary>
/// Cached display name for a user (from JWT when they call the API). Used to show names in share UI.
/// </summary>
public class UserProfile
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public DateTime LastUpdated { get; set; }
}
