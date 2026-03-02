using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Identity.Web;
using Migrator.Application.Contracts;
using Migrator.Application.DTOs;

namespace Migrator.API.Controllers;

[ApiController]
[Route("api")]
[Authorize] // When Azure AD is configured (UseAuthorization in Program), all actions require a valid JWT. When not configured, this is not enforced.
public class SessionsController : ControllerBase
{
    private const string UserIdCookieName = "migrator_uid";
    private const int UserIdCookieDays = 365;
    private readonly IProjectRepository _projects;
    private readonly ILogger<SessionsController> _logger;

    public SessionsController(IProjectRepository projects, ILogger<SessionsController> logger)
    {
        _projects = projects;
        _logger = logger;
    }

    /// <summary>
    /// Resolve current user id: when OAuth2/Azure AD is configured, use the JWT claim "oid" (stable across browsers/devices for the same user).
    /// Otherwise use cookie migrator_uid (or optional X-User-Id header). With Azure AD you do NOT send X-User-Id — the backend gets the user from the validated Bearer token.
    /// Also upserts the current user's display name from JWT so it can be shown in share UI.
    /// </summary>
    private async Task<string> GetOrCreateUserIdAsync(CancellationToken cancellationToken)
    {
        string? displayName = null;
        // When [Authorize] + JWT validation are enabled, use the token's Azure AD object id (same for same user in every browser)
        if (User.Identity?.IsAuthenticated == true)
        {
            displayName = User.FindFirst("name")?.Value?.Trim()
                ?? User.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value?.Trim()
                ?? User.FindFirst("preferred_username")?.Value?.Trim()
                ?? User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value?.Trim()
                ?? User.FindFirst("email")?.Value?.Trim()
                ?? User.FindFirst("unique_name")?.Value?.Trim()
                ?? User.FindFirst("upn")?.Value?.Trim();
            var oid = User.GetObjectId();
            if (string.IsNullOrWhiteSpace(oid))
                oid = User.FindFirst("oid")?.Value ?? User.FindFirst("sub")?.Value
                    ?? User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                    ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (!string.IsNullOrWhiteSpace(oid))
            {
                await _projects.UpsertUserProfileAsync(oid, displayName, cancellationToken);
                return oid;
            }
        }

        // Optional header fallback (e.g. when cookie is blocked in private/incognito)
        if (Request.Headers.TryGetValue("X-User-Id", out var headerVal) && !string.IsNullOrWhiteSpace(headerVal))
            return headerVal.ToString().Trim();

        // Cookie (anonymous user when no auth)
        if (Request.Cookies.TryGetValue(UserIdCookieName, out var existing) && !string.IsNullOrWhiteSpace(existing))
            return existing;

        var newId = Guid.NewGuid().ToString("N");
        Response.Cookies.Append(UserIdCookieName, newId, new CookieOptions
        {
            HttpOnly = true,
            Secure = false,
            SameSite = SameSiteMode.Lax,
            Expires = DateTimeOffset.UtcNow.AddDays(UserIdCookieDays),
            Path = "/"
        });
        await _projects.UpsertUserProfileAsync(newId, null, cancellationToken);
        return newId;
    }

    [HttpGet("sessions")]
    public async Task<ActionResult<List<ProjectListDto>>> List(CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var list = await _projects.ListByUserAsync(userId, cancellationToken);
            _logger.LogInformation("Sessions list: userId={UserId}, count={Count}", userId.Substring(0, 8), list.Count);
            return Ok(list);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list sessions");
            return StatusCode(503, new { error = "Database error. Ensure PostgreSQL is running and connection string is correct." });
        }
    }

    /// <summary>Returns known users (owners or shared-with) with display names for share suggestions. Optional ?q= prefix to filter.</summary>
    [HttpGet("users")]
    public async Task<ActionResult<object>> GetKnownUsers([FromQuery] string? q, CancellationToken cancellationToken)
    {
        try
        {
            await GetOrCreateUserIdAsync(cancellationToken);
            var users = await _projects.GetKnownUsersAsync(searchPrefix: q, limit: 30, cancellationToken);
            return Ok(new { users });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get known users");
            return StatusCode(503, new { error = "Database error." });
        }
    }

    [HttpGet("sessions/{id:guid}")]
    public async Task<ActionResult<ProjectGetDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var project = await _projects.GetByIdAsync(id, userId, cancellationToken);
            if (project == null) return NotFound();
            return Ok(project);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get session {Id}", id);
            return StatusCode(503, new { error = "Database error." });
        }
    }

    [HttpPost("sessions")]
    public async Task<ActionResult<ProjectListDto>> Create([FromBody] ProjectCreateDto dto, CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var created = await _projects.CreateAsync(userId, dto ?? new ProjectCreateDto(), cancellationToken);
            _logger.LogInformation("Session created: id={Id}, userId={UserId}, name={Name}", created.Id, userId.Substring(0, 8), created.Name);
            return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create session");
            return StatusCode(503, new { error = "Database error. Ensure PostgreSQL is running, database 'migrator' exists, and connection string in appsettings.json is correct." });
        }
    }

    [HttpPut("sessions/{id:guid}")]
    public async Task<ActionResult<ProjectListDto>> Update(Guid id, [FromBody] ProjectUpdateDto dto, CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var updated = await _projects.UpdateAsync(id, userId, dto ?? new ProjectUpdateDto(), cancellationToken);
            if (updated == null) return NotFound();
            return Ok(updated);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update session {Id}", id);
            return StatusCode(503, new { error = "Database error." });
        }
    }

    [HttpDelete("sessions/{id:guid}")]
    public async Task<ActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var deleted = await _projects.DeleteAsync(id, userId, cancellationToken);
            if (!deleted) return NotFound();
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete session {Id}", id);
            return StatusCode(503, new { error = "Database error." });
        }
    }

    /// <summary>Share session with users (owner only). Body: { shared_with_user_ids: string[], role?: "viewer"|"editor", display_names?: { [user_id]: string } }.</summary>
    [HttpPost("sessions/{id:guid}/share")]
    public async Task<ActionResult> Share(Guid id, [FromBody] ProjectShareRequestDto dto, CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var role = dto?.Role?.Trim() ?? "viewer";
            if (dto?.SharedWithUserIds == null || dto.SharedWithUserIds.Count == 0)
                return BadRequest(new { error = "shared_with_user_ids is required (array of user ids or emails)." });
            foreach (var sharedWithUserId in dto.SharedWithUserIds.Where(x => !string.IsNullOrWhiteSpace(x)))
            {
                var uid = sharedWithUserId.Trim();
                var displayName = dto?.DisplayNames != null && dto.DisplayNames.TryGetValue(uid, out var dn) ? dn : null;
                await _projects.AddShareAsync(id, userId, uid, role, displayName, cancellationToken);
            }
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to share session {Id}", id);
            return StatusCode(503, new { error = "Database error." });
        }
    }

    /// <summary>Remove share for one user (owner only).</summary>
    [HttpDelete("sessions/{id:guid}/share/{sharedWithUserId}")]
    public async Task<ActionResult> Unshare(Guid id, string sharedWithUserId, CancellationToken cancellationToken)
    {
        try
        {
            var userId = await GetOrCreateUserIdAsync(cancellationToken);
            var removed = await _projects.RemoveShareAsync(id, userId, sharedWithUserId, cancellationToken);
            if (!removed) return NotFound();
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to unshare session {Id}", id);
            return StatusCode(503, new { error = "Database error." });
        }
    }
}
