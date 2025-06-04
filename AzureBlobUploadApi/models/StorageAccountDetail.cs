namespace MyBlobUploadApi.Models
{
    public class StorageAccountDetail
    {
        /// <summary>
        /// The hostname of the Front Door endpoint.
        /// Example: "contosoFrontDoorEndpoint-XXXXXX.azurefd.net"
        /// </summary>
        public string? FrontDoorHostname { get; set; }

        /// <summary>
        /// The shard name used in the Front Door path.
        /// Example: "contosoUK01"
        /// </summary>
        public string? ShardName { get; set; }

        /// <summary>
        /// The name of the Azure Storage account.
        /// </summary>
        public string? AccountName { get; set; }

        /// <summary>
        /// The access key for the Azure Storage account.
        /// </summary>
        public string? AccountKey { get; set; }

        /// <summary>
        /// The name of the blob container where files will be uploaded.
        /// </summary>
        public string? ContainerName { get; set; }
    }

    public class SasUploadInfo
    {
        public string? BlobUri { get; set; }
        public string? SharedAccessSignature { get; set; }
        public string? FullUploadUrl => $"{BlobUri}?{SharedAccessSignature}";
    }
}
