using Migrator.Domain.Entities;

namespace Migrator.Application.Contracts;

public interface IMapSchemaService
{
    Task<MappingResult> MapSchemaAsync(
        IReadOnlyList<RawFile> sourceFiles,
        IReadOnlyList<RawFile> targetFiles,
        string? userInstruction = null,
        string? rules = null,
        IProgress<(string Phase, string Detail)>? onProgress = null,
        Func<string, CancellationToken, Task>? onToken = null,
        CancellationToken cancellationToken = default);

    Task<RefineResult> RefineMappingAsync(RefineInput input, CancellationToken cancellationToken = default);
}

public class RefineInput
{
    public IReadOnlyList<RawFile> SourceFiles { get; set; } = Array.Empty<RawFile>();
    public IReadOnlyList<RawFile> TargetFiles { get; set; } = Array.Empty<RawFile>();
    public MappingResult CurrentMapping { get; set; } = new();
    public IReadOnlyList<ChatMessage> Messages { get; set; } = Array.Empty<ChatMessage>();
    public string UserMessage { get; set; } = string.Empty;
    public string? Rules { get; set; }
}

public class ChatMessage
{
    public string Role { get; set; } = "user"; // user | assistant
    public string Content { get; set; } = string.Empty;
}

public class RefineResult
{
    public MappingResult Mapping { get; set; } = new();
    public string Message { get; set; } = string.Empty;
}
