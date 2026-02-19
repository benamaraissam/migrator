namespace Migrator.Domain.Entities;

public class MappingResult
{
    public IList<MappingItem> Mappings { get; set; } = new List<MappingItem>();
    public IList<string> UnmappedSourceColumns { get; set; } = new List<string>();
    public IList<string> UnmappedTargetColumns { get; set; } = new List<string>();
    public double GlobalConfidence { get; set; }
    public string AnalysisSummary { get; set; } = string.Empty;
}
