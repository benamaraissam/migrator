using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace Migrator.API;

/// <summary>Allows EF Core tools to create migrations in the API project while DbContext lives in Infrastructure.</summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<Migrator.Infrastructure.Data.MigratorDbContext>
{
    public Migrator.Infrastructure.Data.MigratorDbContext CreateDbContext(string[] args)
    {
        var config = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .Build();
        var optionsBuilder = new DbContextOptionsBuilder<Migrator.Infrastructure.Data.MigratorDbContext>();
        var conn = config.GetConnectionString("DefaultConnection") ?? "Host=localhost;Port=5432;Database=migrator;Username=postgres;Password=postgres";
        optionsBuilder.UseNpgsql(conn, npgsql => npgsql.MigrationsAssembly("Migrator.API"));
        return new Migrator.Infrastructure.Data.MigratorDbContext(optionsBuilder.Options);
    }
}
