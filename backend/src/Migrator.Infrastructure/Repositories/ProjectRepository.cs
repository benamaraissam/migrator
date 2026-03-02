using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Migrator.Application.Contracts;
using Migrator.Application.DTOs;
using Migrator.Domain.Entities;
using Migrator.Infrastructure.Data;

namespace Migrator.Infrastructure.Repositories;

public class ProjectRepository : IProjectRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly MigratorDbContext _db;

    public ProjectRepository(MigratorDbContext db)
    {
        _db = db;
    }

    public async Task<List<ProjectListDto>> ListByUserAsync(string userId, CancellationToken cancellationToken = default)
    {
        var owned = await _db.Projects
            .Where(p => p.OwnerUserId == userId)
            .Select(p => new ProjectListDto
            {
                Id = p.Id.ToString(),
                Name = p.Name,
                Date = p.CreatedAt.ToString("O"),
                UpdatedAt = p.UpdatedAt.ToString("O"),
                IsOwner = true,
                OwnerUserId = p.OwnerUserId
            })
            .ToListAsync(cancellationToken);

        var shared = await _db.ProjectShares
            .Where(s => s.SharedWithUserId == userId)
            .Join(_db.Projects, s => s.ProjectId, p => p.Id, (s, p) => new ProjectListDto
            {
                Id = p.Id.ToString(),
                Name = p.Name,
                Date = p.CreatedAt.ToString("O"),
                UpdatedAt = p.UpdatedAt.ToString("O"),
                IsOwner = false,
                OwnerUserId = p.OwnerUserId
            })
            .ToListAsync(cancellationToken);

        var combined = owned.Concat(shared).OrderByDescending(x => x.UpdatedAt).ToList();
        var ownerIds = combined.Select(x => x.OwnerUserId).Where(x => !string.IsNullOrEmpty(x)).Distinct().ToList();
        var ownerNames = ownerIds.Count > 0
            ? await _db.UserProfiles.Where(u => ownerIds.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId, u => u.DisplayName, cancellationToken)
            : new Dictionary<string, string>();
        foreach (var item in combined)
        {
            if (!string.IsNullOrEmpty(item.OwnerUserId))
                item.OwnerDisplayName = ownerNames.GetValueOrDefault(item.OwnerUserId);
        }
        return combined;
    }

    public async Task<ProjectGetDto?> GetByIdAsync(Guid id, string userId, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects
            .Where(p => p.Id == id && (p.OwnerUserId == userId || _db.ProjectShares.Any(s => s.ProjectId == id && s.SharedWithUserId == userId)))
            .Select(p => new { p.Id, p.OwnerUserId, p.Name, p.CreatedAt, p.UpdatedAt, p.SourceFilesJson, p.TargetFilesJson, p.ChatHistoryJson, p.CurrentMappingJson, p.RulesJson })
            .FirstOrDefaultAsync(cancellationToken);
        if (project == null) return null;

        var sharedWith = await _db.ProjectShares
            .Where(s => s.ProjectId == id)
            .OrderBy(s => s.SharedAt)
            .Select(s => new { s.SharedWithUserId, s.Role, s.SharedAt })
            .ToListAsync(cancellationToken);

        var sharedUserIds = sharedWith.Select(s => s.SharedWithUserId).Distinct().ToList();
        var displayNames = sharedUserIds.Count > 0
            ? await _db.UserProfiles.Where(u => sharedUserIds.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId, u => u.DisplayName, cancellationToken)
            : new Dictionary<string, string>();

        var sharedWithDtos = sharedWith.Select(s => new SharedWithDto
        {
            UserId = s.SharedWithUserId,
            DisplayName = displayNames.GetValueOrDefault(s.SharedWithUserId),
            Role = s.Role,
            SharedAt = s.SharedAt.ToString("O")
        }).ToList();

        string? ownerDisplayName = null;
        if (!string.IsNullOrEmpty(project.OwnerUserId))
        {
            var ownerProfile = await _db.UserProfiles.FindAsync(new object[] { project.OwnerUserId }, cancellationToken);
            ownerDisplayName = ownerProfile?.DisplayName;
        }

        return new ProjectGetDto
        {
            Id = project.Id.ToString(),
            Name = project.Name,
            Date = project.CreatedAt.ToString("O"),
            CreatedAt = project.CreatedAt.ToString("O"),
            UpdatedAt = project.UpdatedAt.ToString("O"),
            IsOwner = project.OwnerUserId == userId,
            OwnerUserId = project.OwnerUserId,
            OwnerDisplayName = ownerDisplayName,
            SharedWith = sharedWithDtos,
            SourceFiles = Deserialize<List<RawFileDto>>(project.SourceFilesJson) ?? new List<RawFileDto>(),
            TargetFiles = Deserialize<List<RawFileDto>>(project.TargetFilesJson) ?? new List<RawFileDto>(),
            ChatHistory = Deserialize<List<ChatMessageDto>>(project.ChatHistoryJson) ?? new List<ChatMessageDto>(),
            CurrentMapping = project.CurrentMappingJson != null ? Deserialize<MappingResultDto>(project.CurrentMappingJson) : null,
            Rules = Deserialize<List<RuleItemDto>>(project.RulesJson) ?? new List<RuleItemDto>()
        };
    }

    public async Task<ProjectListDto> CreateAsync(string userId, ProjectCreateDto dto, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var name = !string.IsNullOrWhiteSpace(dto.Name) ? dto.Name.Trim() : $"Session {now:yyyy-MM-dd HH:mm}";
        var project = new Project
        {
            Id = Guid.NewGuid(),
            OwnerUserId = userId,
            Name = name,
            SourceFilesJson = JsonSerializer.Serialize(dto.SourceFiles ?? new List<RawFileDto>(), JsonOptions),
            TargetFilesJson = JsonSerializer.Serialize(dto.TargetFiles ?? new List<RawFileDto>(), JsonOptions),
            ChatHistoryJson = JsonSerializer.Serialize(dto.ChatHistory ?? new List<ChatMessageDto>(), JsonOptions),
            CurrentMappingJson = dto.CurrentMapping != null ? JsonSerializer.Serialize(dto.CurrentMapping, JsonOptions) : null,
            RulesJson = JsonSerializer.Serialize(dto.Rules ?? new List<RuleItemDto>(), JsonOptions),
            CreatedAt = now,
            UpdatedAt = now
        };
        _db.Projects.Add(project);
        await _db.SaveChangesAsync(cancellationToken);
        return new ProjectListDto
        {
            Id = project.Id.ToString(),
            Name = project.Name,
            Date = project.CreatedAt.ToString("O"),
            UpdatedAt = project.UpdatedAt.ToString("O"),
            IsOwner = true,
            OwnerUserId = project.OwnerUserId
        };
    }

    public async Task<ProjectListDto?> UpdateAsync(Guid id, string userId, ProjectUpdateDto dto, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (project == null) return null;
        var isOwner = project.OwnerUserId == userId;
        var isEditor = !isOwner && await _db.ProjectShares.AnyAsync(s => s.ProjectId == id && s.SharedWithUserId == userId && s.Role == "editor", cancellationToken);
        if (!isOwner && !isEditor) return null;

        if (dto.Name != null) project.Name = dto.Name.Trim();
        if (dto.SourceFiles != null) project.SourceFilesJson = JsonSerializer.Serialize(dto.SourceFiles, JsonOptions);
        if (dto.TargetFiles != null) project.TargetFilesJson = JsonSerializer.Serialize(dto.TargetFiles, JsonOptions);
        if (dto.ChatHistory != null) project.ChatHistoryJson = JsonSerializer.Serialize(dto.ChatHistory, JsonOptions);
        if (dto.CurrentMapping != null) project.CurrentMappingJson = JsonSerializer.Serialize(dto.CurrentMapping, JsonOptions);
        else if (dto.CurrentMapping == null && project.CurrentMappingJson != null) project.CurrentMappingJson = null; // clear
        if (dto.Rules != null) project.RulesJson = JsonSerializer.Serialize(dto.Rules, JsonOptions);
        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return new ProjectListDto
        {
            Id = project.Id.ToString(),
            Name = project.Name,
            Date = project.CreatedAt.ToString("O"),
            UpdatedAt = project.UpdatedAt.ToString("O"),
            IsOwner = true,
            OwnerUserId = project.OwnerUserId
        };
    }

    public async Task<bool> DeleteAsync(Guid id, string userId, CancellationToken cancellationToken = default)
    {
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.OwnerUserId == userId, cancellationToken);
        if (project == null) return false;
        _db.Projects.Remove(project);
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<List<SharedWithDto>> GetSharesAsync(Guid projectId, string userId, CancellationToken cancellationToken = default)
    {
        var isOwner = await _db.Projects.AnyAsync(p => p.Id == projectId && p.OwnerUserId == userId, cancellationToken);
        if (!isOwner) return new List<SharedWithDto>();

        var shares = await _db.ProjectShares
            .Where(s => s.ProjectId == projectId)
            .OrderBy(s => s.SharedAt)
            .Select(s => new { s.SharedWithUserId, s.Role, s.SharedAt })
            .ToListAsync(cancellationToken);
        var ids = shares.Select(s => s.SharedWithUserId).Distinct().ToList();
        var names = ids.Count > 0
            ? await _db.UserProfiles.Where(u => ids.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId, u => u.DisplayName, cancellationToken)
            : new Dictionary<string, string>();
        return shares.Select(s => new SharedWithDto
        {
            UserId = s.SharedWithUserId,
            DisplayName = names.GetValueOrDefault(s.SharedWithUserId),
            Role = s.Role,
            SharedAt = s.SharedAt.ToString("O")
        }).ToList();
    }

    public async Task<bool> AddShareAsync(Guid projectId, string ownerUserId, string sharedWithUserId, string role, string? displayName = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sharedWithUserId)) return false;
        var project = await _db.Projects.FirstOrDefaultAsync(p => p.Id == projectId && p.OwnerUserId == ownerUserId, cancellationToken);
        if (project == null) return false;
        var uid = sharedWithUserId.Trim();
        var existing = await _db.ProjectShares.AnyAsync(s => s.ProjectId == projectId && s.SharedWithUserId == uid, cancellationToken);
        if (existing)
        {
            if (!string.IsNullOrWhiteSpace(displayName))
                await UpsertUserProfileAsync(uid, displayName, cancellationToken);
            return true;
        }
        _db.ProjectShares.Add(new ProjectShare
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            SharedWithUserId = uid,
            Role = string.IsNullOrWhiteSpace(role) ? "viewer" : role.Trim(),
            SharedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(displayName))
            await UpsertUserProfileAsync(uid, displayName, cancellationToken);
        return true;
    }

    public async Task<bool> RemoveShareAsync(Guid projectId, string ownerUserId, string sharedWithUserId, CancellationToken cancellationToken = default)
    {
        var isOwner = await _db.Projects.AnyAsync(p => p.Id == projectId && p.OwnerUserId == ownerUserId, cancellationToken);
        if (!isOwner) return false;
        var share = await _db.ProjectShares.FirstOrDefaultAsync(s => s.ProjectId == projectId && s.SharedWithUserId == sharedWithUserId, cancellationToken);
        if (share == null) return false;
        _db.ProjectShares.Remove(share);
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task UpsertUserProfileAsync(string userId, string? displayName, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(userId)) return;
        var name = string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim();
        var profile = await _db.UserProfiles.FindAsync(new object[] { userId }, cancellationToken);
        var now = DateTime.UtcNow;
        if (profile == null)
        {
            _db.UserProfiles.Add(new UserProfile { UserId = userId, DisplayName = name ?? userId, LastUpdated = now });
        }
        else
        {
            if (name != null) profile.DisplayName = name;
            profile.LastUpdated = now;
        }
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<List<UserSuggestDto>> GetKnownUsersAsync(string? searchPrefix = null, int limit = 30, CancellationToken cancellationToken = default)
    {
        // Only return users who have a real display name (i.e. have logged in and had their JWT name stored).
        // Users with no profile (never logged in) or whose display name is just their user ID are excluded from suggestions.
        var fromProjects = _db.Projects.Select(p => p.OwnerUserId);
        var fromShares = _db.ProjectShares.Select(s => s.SharedWithUserId);
        var distinctIds = await fromProjects.Union(fromShares).Distinct().ToListAsync(cancellationToken);
        if (distinctIds.Count == 0) return new List<UserSuggestDto>();

        // Only include users that have a non-empty display name that doesn't look like a raw ID
        var profiles = await _db.UserProfiles
            .Where(u => distinctIds.Contains(u.UserId) && !string.IsNullOrWhiteSpace(u.DisplayName) && u.DisplayName != u.UserId)
            .ToListAsync(cancellationToken);

        var prefix = searchPrefix?.Trim();
        var filtered = profiles
            .Select(u => new UserSuggestDto { UserId = u.UserId, DisplayName = u.DisplayName })
            .Where(u => string.IsNullOrWhiteSpace(prefix)
                || u.DisplayName!.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                || u.UserId.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .OrderBy(u => u.DisplayName)
            .Take(limit)
            .ToList();
        return filtered;
    }

    private static T? Deserialize<T>(string json)
    {
        try { return JsonSerializer.Deserialize<T>(json, JsonOptions); }
        catch { return default; }
    }
}
