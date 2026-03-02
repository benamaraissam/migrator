using Migrator.Application.Contracts;
using Migrator.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;
using Migrator.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });

builder.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Core.KestrelServerOptions>(o =>
{
    o.Limits.MaxRequestBodySize = 52_428_800; // 50 MB
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(builder.Configuration["Cors:Origins"] ?? "http://localhost:4200")
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

// Azure AD OAuth2: validate JWT when ClientId is set (app registration)
var azureAdClientId = builder.Configuration["AzureAd:ClientId"];
if (!string.IsNullOrWhiteSpace(azureAdClientId))
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApi(builder.Configuration, "AzureAd");

    builder.Services.AddAuthorization(options =>
    {
        options.FallbackPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .Build();
    });
}

builder.Services.AddDbContext<MigratorDbContext>(options =>
{
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection"),
        npgsql => npgsql.MigrationsAssembly("Migrator.API"));
});
builder.Services.AddScoped<IProjectRepository, Migrator.Infrastructure.Repositories.ProjectRepository>();
builder.Services.AddScoped<IMapSchemaService, MapSchemaService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MigratorDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        db.Database.Migrate();
        logger.LogInformation("Database migrations applied successfully.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database migrations failed. Ensure PostgreSQL is running, database 'migrator' exists, and ConnectionStrings:DefaultConnection in appsettings.json is correct.");
#if DEBUG
        throw; // Fail startup in development so you see the error immediately
#endif
    }
}

// CORS must run before auth so preflight OPTIONS and error responses include CORS headers
app.UseCors();

if (!string.IsNullOrWhiteSpace(azureAdClientId))
{
    app.UseAuthentication();
    app.UseAuthorization();
    // All /api endpoints require a valid Azure AD JWT (one-way: SPA gets token, API validates only)
}

app.MapControllers();

app.Run();
