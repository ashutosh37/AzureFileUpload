namespace MyBlobUploadApi.Models
{
    public class PaginatedBlobList
    {
        public IEnumerable<FileInfo> Items { get; set; } = new List<FileInfo>();
        public string? NextContinuationToken { get; set; }
    }
}