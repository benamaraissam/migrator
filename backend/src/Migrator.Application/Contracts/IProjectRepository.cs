using Migrator.Application.DTOs;

namespace Migrator.Application.Contracts;

public interface IProjectRepository
{
    Task<List<ProjectListDto>> ListByUserAsync(string userId, CancellationToken cancellationToken = default);
    Task<ProjectGetDto?> GetByIdAsync(Guid id, string userId, CancellationToken cancellationToken = default);
    Task<ProjectListDto> CreateAsync(string userId, ProjectCreateDto dto, CancellationToken cancellationToken = default);
    Task<ProjectListDto?> UpdateAsync(Guid id, string userId, ProjectUpdateDto dto, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(Guid id, string userId, CancellationToken cancellationToken = default);
    Task<List<SharedWithDto>> GetSharesAsync(Guid projectId, string userId, CancellationToken cancellationToken = default);
    Task<bool> AddShareAsync(Guid projectId, string ownerUserId, string sharedWithUserId, string role, string? displayName = null, CancellationToken cancellationToken = default);
    Task<bool> RemoveShareAsync(Guid projectId, string ownerUserId, string sharedWithUserId, CancellationToken cancellationToken = default);
    /// <summary>Upsert current user's display name (call when resolving user from JWT).</summary>
    Task UpsertUserProfileAsync(string userId, string? displayName, CancellationToken cancellationToken = default);
    /// <summary>Returns known users (owners or shared-with) with display names for suggestions.</summary>
    Task<List<UserSuggestDto>> GetKnownUsersAsync(string? searchPrefix = null, int limit = 30, CancellationToken cancellationToken = default);
}
