namespace Migrator.Domain.Entities;

public class MappingItem
{
    public string TargetColumn { get; set; } = string.Empty;
    public IList<string> SourceColumns { get; set; } = new List<string>();
    public double ConfidenceScore { get; set; }
    public string MatchType { get; set; } = "semantic"; // exact, semantic, transformed, derived, incompatible
    public string? Reasoning { get; set; }
    public string? TransformationRule { get; set; }
}
