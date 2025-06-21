using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using MyBlobUploadApi.Models;
using Azure.Storage.Blobs.Models; // Required for BlobTraits
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace MyBlobUploadApi.Services
{
    public class BlobStorageService
    {
        private readonly List<StorageAccountDetail> _storageAccounts;
        private readonly ILogger<BlobStorageService> _logger;

        public BlobStorageService(IOptions<List<StorageAccountDetail>> storageAccountsOptions, ILogger<BlobStorageService> logger)
        {
            _storageAccounts = storageAccountsOptions.Value ?? throw new ArgumentNullException(nameof(storageAccountsOptions), "StorageAccountsForSasUpload configuration is missing or empty.");
            _logger = logger;

            if (!_storageAccounts.Any())
            {
                throw new ArgumentException("No storage accounts configured for SAS upload.", nameof(storageAccountsOptions));
            }
        }

        /// <summary>
        /// Generates a list of SAS URIs for uploading a file via Azure Front Door.
        /// </summary>
        /// <param name="targetContainerName">The name of the container to generate SAS for.</param>
        /// <returns>An enumerable of SasUploadInfo objects, each containing a Blob URI and a SAS token.</returns>
        public IEnumerable<SasUploadInfo> GenerateSasUploadUris(string targetContainerName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }

            var locations = _storageAccounts.Select(account =>
            {
                if (string.IsNullOrWhiteSpace(account.FrontDoorHostname) ||
                    string.IsNullOrWhiteSpace(account.AccountName) ||
                    string.IsNullOrWhiteSpace(account.AccountKey) ||
                    string.IsNullOrWhiteSpace(account.ContainerName)) // This ContainerName from config might be a default or less relevant if targetContainerName is dynamic
                {
                    _logger.LogWarning("Incomplete storage account configuration for AccountName: {AccountName}. Skipping.", account.AccountName);
                    return null; // Skip misconfigured entries
                }
                // Construct the Container URI that points to the Front Door endpoint for the specified container.
                // Handle optional ShardName.
                string path = string.IsNullOrWhiteSpace(account.ShardName) ? targetContainerName : $"{account.ShardName}/{targetContainerName}";
                Uri frontDoorContainerUri = new Uri($"https://{account.FrontDoorHostname}/{path}");

                var sasBuilder = new BlobSasBuilder
                {
                    BlobContainerName = targetContainerName, // Use the dynamically provided container name
                    Resource = "c", // "c" for container
                    ExpiresOn = DateTimeOffset.UtcNow.AddHours(1), // SAS token validity period
                };
                // Permissions for container: Write (upload new blobs), Create (create new blobs), List (list blobs)
                // Adjust permissions as needed. For just uploading, Write & Create are key.
                sasBuilder.SetPermissions(BlobSasPermissions.Write | BlobSasPermissions.Create | BlobSasPermissions.List);

                var storageSharedKeyCredential = new StorageSharedKeyCredential(account.AccountName, account.AccountKey);
                string sasToken = sasBuilder.ToSasQueryParameters(storageSharedKeyCredential).ToString();
                // BlobUri now represents the ContainerUri
                return new SasUploadInfo { BlobUri = frontDoorContainerUri.ToString(), SharedAccessSignature = sasToken };
            }).Where(info => info != null).Select(info => info!).ToList();

            // Sharding logic based on userId is removed.
            return locations;
        }

        /// <summary>
        /// Generates a SAS URI for reading/downloading a specific blob via Azure Front Door.
        /// </summary>
        /// <param name="targetContainerName">The name of the container where the blob resides.</param>
        /// <param name="blobName">The name of the blob.</param>
        /// <returns>A SasDownloadInfo object containing the full URI with SAS token for downloading the blob.</returns>
        public SasDownloadInfo GenerateReadSasUri(string targetContainerName, string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }
            if (string.IsNullOrWhiteSpace(blobName))
            {
                throw new ArgumentException("Blob name cannot be empty.", nameof(blobName));
            }

            // For simplicity, use the first configured storage account.
            // This assumes the blob exists in the storage account associated with the first configuration.
            // In a sharded environment, you'd need a way to determine which account hosts the blob.
            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null || string.IsNullOrWhiteSpace(accountDetail.FrontDoorHostname) ||
                string.IsNullOrWhiteSpace(accountDetail.AccountName) || string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("Incomplete storage account configuration for generating read SAS. AccountName: {AccountName}", accountDetail?.AccountName);
                throw new InvalidOperationException("Storage account for generating read SAS is not configured properly.");
            }

            string path = string.IsNullOrWhiteSpace(accountDetail.ShardName)
                ? $"{targetContainerName}/{blobName}"
                : $"{accountDetail.ShardName}/{targetContainerName}/{blobName}";
            Uri frontDoorBlobUri = new Uri($"https://{accountDetail.FrontDoorHostname}/{path}");

            var sasBuilder = new BlobSasBuilder
            {
                BlobContainerName = targetContainerName,
                BlobName = blobName,
                Resource = "b", // "b" for blob
                ExpiresOn = DateTimeOffset.UtcNow.AddHours(1), // SAS token validity period
            };
            sasBuilder.SetPermissions(BlobSasPermissions.Read); // Only Read permission

            var storageSharedKeyCredential = new StorageSharedKeyCredential(accountDetail.AccountName, accountDetail.AccountKey);
            string sasToken = sasBuilder.ToSasQueryParameters(storageSharedKeyCredential).ToString();

            return new SasDownloadInfo { FullDownloadUrl = $"{frontDoorBlobUri}?{sasToken}" };
        }

        /// <summary>
        /// Lists blobs in a container along with their SHA256 checksum from metadata.
        /// </summary>
        /// <param name="targetContainerName">The name of the container.</param>
        /// <returns>An enumerable of FileInfo objects.</returns>
        // Explicitly use MyBlobUploadApi.Models.FileInfo in the return type
        public async Task<PaginatedBlobList> ListBlobsAsync(string targetContainerName, int pageSize, string? continuationToken)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }

            // For simplicity, use the first configured storage account.
            // In a real sharded scenario, you might need a way to select the correct account.
            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null ||
                string.IsNullOrWhiteSpace(accountDetail.AccountName) ||
                string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for listing blobs.");
                throw new InvalidOperationException("Storage account for listing is not configured properly.");
            }

            var blobServiceClient = new BlobServiceClient(
                $"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net"
            ); // Or construct connection string differently if needed

            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            var paginatedResult = new PaginatedBlobList();
            var fileInfos = new List<MyBlobUploadApi.Models.FileInfo>();

            // Use AsPages for efficient pagination
            var pages = containerClient.GetBlobsAsync(traits: BlobTraits.Metadata)
                                       .AsPages(continuationToken, pageSize);

            await foreach (Azure.Page<BlobItem> page in pages)
            {
                foreach (BlobItem blobItem in page.Values)
                {
                    string checksum = "N/A";
                    if (blobItem.Metadata != null && blobItem.Metadata.TryGetValue("sha256hash", out var hashValue))
                    {
                        checksum = hashValue;
                    }

                    var metadata = new Dictionary<string, string>();
                    if (blobItem.Metadata != null)
                    {
                        foreach (var pair in blobItem.Metadata)
                        {
                            metadata[pair.Key] = pair.Value;
                        }
                    }
                    fileInfos.Add(new MyBlobUploadApi.Models.FileInfo { Name = blobItem.Name, Checksum = checksum, Metadata = metadata });
                }

                paginatedResult.Items = fileInfos;
                paginatedResult.NextContinuationToken = page.ContinuationToken;
                break; // Process only one page at a time
            }
            return paginatedResult;
        }

        /// <summary>
        /// Calculates the next sequential document number for a given container based on existing blob metadata.
        /// </summary>
        /// <param name="targetContainerName">The container (matter) to scan.</param>
        /// <param name="documentIdPrefix">The system-wide prefix for document IDs (e.g., "EVD").</param>
        /// <returns>The next integer to be used as the document number.</returns>
        public async Task<int> GetNextDocumentNumberAsync(string targetContainerName, string documentIdPrefix)
        {
            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null) throw new InvalidOperationException("Storage account is not configured properly.");

            var blobServiceClient = new BlobServiceClient($"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net");
            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);

            if (!await containerClient.ExistsAsync())
            {
                // If the container doesn't exist, this is the first document.
                return 1;
            }

            int maxDocNumber = 0;
            string expectedPrefix = $"{documentIdPrefix}.{targetContainerName}.";

            await foreach (var blobItem in containerClient.GetBlobsAsync(traits: BlobTraits.Metadata))
            {
                if (blobItem.Metadata != null && blobItem.Metadata.TryGetValue("DocumentId", out var docIdValue))
                {
                    if (docIdValue != null && docIdValue.StartsWith(expectedPrefix))
                    {
                        var parts = docIdValue.Split('.');
                        if (parts.Length == 3 && int.TryParse(parts[2], out int currentDocNumber))
                        {
                            if (currentDocNumber > maxDocNumber)
                            {
                                maxDocNumber = currentDocNumber;
                            }
                        }
                    }
                }
            }
            return maxDocNumber + 1;
        }

        /// <summary>
        /// Checks if a specific blob exists in a container.
        /// </summary>
        /// <param name="targetContainerName">The name of the container.</param>
        /// <param name="blobName">The name of the blob to check.</param>
        /// <returns>True if the blob exists; false otherwise.</returns>
        public async Task<bool> BlobExistsAsync(string targetContainerName, string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                _logger.LogWarning("BlobExistsAsync called with missing container name.");
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }
            if (string.IsNullOrWhiteSpace(blobName))
            {
                _logger.LogWarning("BlobExistsAsync called with missing blob name.");
                throw new ArgumentException("Blob name cannot be empty.", nameof(blobName));
            }

            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null ||
                string.IsNullOrWhiteSpace(accountDetail.AccountName) ||
                string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for checking blob existence.");
                throw new InvalidOperationException("Storage account for blob existence check is not configured properly.");
            }

            var blobServiceClient = new BlobServiceClient(
                $"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net"
            );

            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            
            // GetBlobClient does not make a network call. ExistsAsync does.
            var blobClient = containerClient.GetBlobClient(blobName);
            
            // Check if the blob exists
            return await blobClient.ExistsAsync();
        }


        /// <summary>
        /// Updates the metadata for a specific blob.
        /// </summary>
        /// <param name="targetContainerName">The name of the container where the blob resides.</param>
        /// <param name="blobName">The name of the blob to update.</param>
        /// <param name="metadataToSet">A dictionary containing the metadata key-value pairs to set. This will replace existing metadata.</param>
        /// <returns>True if the metadata was updated successfully; false otherwise (e.g., if the blob doesn't exist).</returns>
        public async Task<bool> UpdateBlobMetadataAsync(string targetContainerName, string blobName, IDictionary<string, string> metadataToSet)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }
            if (string.IsNullOrWhiteSpace(blobName))
            {
                throw new ArgumentException("Blob name cannot be empty.", nameof(blobName));
            }
            if (metadataToSet == null)
            {
                throw new ArgumentNullException(nameof(metadataToSet));
            }

            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null ||
                string.IsNullOrWhiteSpace(accountDetail.AccountName) ||
                string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for updating blob metadata.");
                throw new InvalidOperationException("Storage account for metadata update is not configured properly.");
            }

            var blobServiceClient = new BlobServiceClient(
                $"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net"
            );

            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            var blobClient = containerClient.GetBlobClient(blobName);

            if (!await blobClient.ExistsAsync())
            {
                _logger.LogWarning("Attempted to update metadata for a non-existent blob: Container '{TargetContainerName}', Blob '{BlobName}'.", targetContainerName, blobName);
                return false;
            }

            await blobClient.SetMetadataAsync(metadataToSet);
            _logger.LogInformation("Successfully updated metadata for blob: Container '{TargetContainerName}', Blob '{BlobName}'.", targetContainerName, blobName);
            return true;
        }

        /// <summary>
        /// Deletes a specific blob from a container.
        /// </summary>
        /// <param name="targetContainerName">The name of the container.</param>
        /// <param name="blobName">The name of the blob to delete.</param>
        /// <returns>True if the blob was deleted or did not exist; false if an error occurred.</returns>
        public async Task<bool> DeleteBlobAsync(string targetContainerName, string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName) || string.IsNullOrWhiteSpace(blobName))
            {
                _logger.LogWarning("DeleteBlobAsync called with missing container or blob name.");
                throw new ArgumentException("Container and blob names cannot be empty.");
            }

            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null ||
                string.IsNullOrWhiteSpace(accountDetail.AccountName) ||
                string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for deleting blob.");
                throw new InvalidOperationException("Storage account for deletion is not configured properly.");
            }

            var blobServiceClient = new BlobServiceClient(
                $"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net"
            );

            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            var blobClient = containerClient.GetBlobClient(blobName);

            // DeleteIfExistsAsync returns true if the blob was deleted, and false if it did not exist.
            // Both are considered a "success" from the caller's perspective (the blob is gone).
            var response = await blobClient.DeleteIfExistsAsync();
            return response.Value; // Will be true if deleted, false if not found.
        }
    }
}