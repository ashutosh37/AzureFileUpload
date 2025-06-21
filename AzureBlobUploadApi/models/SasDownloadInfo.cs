namespace MyBlobUploadApi.Models
{
    public class SasDownloadInfo
    {
        /// <summary>
        /// The full URL (including SAS token) to directly access/download the blob.
        /// </summary>
        public string? FullDownloadUrl { get; set; } // Made nullable to resolve CS8618 warning
    }
}