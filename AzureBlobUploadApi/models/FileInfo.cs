namespace MyBlobUploadApi.Models
{
    public class FileInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Checksum { get; set; } = string.Empty;
        public IDictionary<string, string> Metadata { get; set; } = new Dictionary<string, string>();
        public bool IsFolder { get; set; } = false; // New property to indicate if it's a folder
        public string? ParentId { get; set; } // Added for hierarchical display
    }
}