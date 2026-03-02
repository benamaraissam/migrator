using Microsoft.EntityFrameworkCore;
using Migrator.Domain.Entities;

namespace Migrator.Infrastructure.Data;

public class MigratorDbContext : DbContext
{
    public MigratorDbContext(DbContextOptions<MigratorDbContext> options) : base(options) { }

    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectShare> ProjectShares => Set<ProjectShare>();
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Project>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.OwnerUserId).HasMaxLength(256);
            e.Property(x => x.Name).HasMaxLength(500);
            e.HasIndex(x => x.OwnerUserId);
            e.HasIndex(x => x.UpdatedAt);
        });

        modelBuilder.Entity<ProjectShare>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Project).WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.SharedWithUserId).HasMaxLength(256);
            e.Property(x => x.Role).HasMaxLength(50);
            e.HasIndex(x => new { x.ProjectId, x.SharedWithUserId }).IsUnique();
        });

        modelBuilder.Entity<UserProfile>(e =>
        {
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.DisplayName).HasMaxLength(500);
        });
    }
}
