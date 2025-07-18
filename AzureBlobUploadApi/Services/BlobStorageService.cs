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
using System.IO.Compression; // Added for zip file handling
using System.Security.Cryptography; // Added for SHA256 hash calculation
using Azure.Storage.Blobs.Specialized;

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

        public async Task UploadZipFileAndExtractAsync(string targetContainerName, string sourceContainerName, string sourceBlobName, string zipDocumentId)
        {
            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null || string.IsNullOrWhiteSpace(accountDetail.AccountName) || string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for zip upload and extraction.");
                throw new InvalidOperationException("Storage account for zip upload is not configured properly.");
            }

            var blobServiceClient = new BlobServiceClient(
                $"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net"
            );
            var targetContainerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            var sourceContainerClient = blobServiceClient.GetBlobContainerClient(sourceContainerName);

            // Ensure the target container exists
            await targetContainerClient.CreateIfNotExistsAsync();

            // 1. Download the original ZIP file from the source container
            BlobClient sourceZipBlobClient = sourceContainerClient.GetBlobClient(sourceBlobName);
            if (!await sourceZipBlobClient.ExistsAsync())
            {
                _logger.LogError("Source ZIP file not found in blob storage: {SourceContainerName}/{SourceBlobName}", sourceContainerName, sourceBlobName);
                throw new FileNotFoundException($"Source ZIP file '{sourceBlobName}' not found in container '{sourceContainerName}'.");
            }

            using (MemoryStream zipMemoryStream = new MemoryStream())
            {
                await sourceZipBlobClient.DownloadToAsync(zipMemoryStream);
                zipMemoryStream.Position = 0; // Reset stream position after download

                // 2. Upload the original ZIP file to the target container (if it's different from source)
                // If target and source containers are the same, this is effectively a metadata update.
                BlobClient targetZipBlobClient = targetContainerClient.GetBlobClient(sourceBlobName);
                // We need to re-upload or copy to ensure it's in the target container with the new metadata
                // For simplicity, we'll re-upload the stream. For large files, consider BlobClient.StartCopyFromUriAsync
                zipMemoryStream.Position = 0; // Reset again for upload
                await targetZipBlobClient.UploadAsync(zipMemoryStream, overwrite: true);
                _logger.LogInformation("Original zip file {SourceBlobName} copied/uploaded to target container {TargetContainerName}.", sourceBlobName, targetContainerName);

                // Set metadata for the original ZIP file in the target container
                var zipMetadata = new Dictionary<string, string>
                {
                    { "DocumentId", zipDocumentId },
                    { "ParentId", "" }, // Zip file has no parent
                    { "IsZipFile", "true" },
                    { "createdDate", DateTime.UtcNow.ToString("o") },
                    { "modifiedDate", DateTime.UtcNow.ToString("o") }
                };
                await targetZipBlobClient.SetMetadataAsync(zipMetadata);

                zipMemoryStream.Position = 0; // Reset stream position for unzipping

                // 3. Unzip and upload contents to the target container
                using (ZipArchive archive = new ZipArchive(zipMemoryStream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        // Skip directories and empty entries
                        if (string.IsNullOrEmpty(entry.Name) || entry.FullName.EndsWith("/"))
                        {
                            continue;
                        }

                        // Construct the blob name for the unzipped file to be in the same location as the zip
                        string directoryPath = "";
                        int lastSlashIndex = sourceBlobName.LastIndexOf('/');
                        if (lastSlashIndex > -1)
                        {
                            directoryPath = sourceBlobName.Substring(0, lastSlashIndex + 1);
                        }
                        string unzippedBlobName = $"{directoryPath}{entry.FullName}";

                        using (var entryStream = entry.Open())
                        using (var fileMemoryStream = new MemoryStream())
                        {
                            await entryStream.CopyToAsync(fileMemoryStream);
                            fileMemoryStream.Position = 0; // Reset for hashing

                            // Calculate SHA256 hash for the unzipped file
                            using (var sha256 = SHA256.Create())
                            {
                                byte[] hashBytes = await sha256.ComputeHashAsync(fileMemoryStream);
                                string sha256Hash = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();

                                // Reset stream position after hash calculation for upload
                                fileMemoryStream.Position = 0;

                                BlobClient unzippedBlobClient = targetContainerClient.GetBlobClient(unzippedBlobName);

                                // Generate a new DocumentId for the unzipped file
                                int nextDocNumber = await GetNextDocumentNumberAsync(targetContainerName, "DOC"); // Assuming "DOC" prefix
                                string unzippedDocumentId = $"DOC.{targetContainerName}.{nextDocNumber:D4}";

                                var unzippedMetadata = new Dictionary<string, string>
                                {
                                    { "DocumentId", unzippedDocumentId },
                                    { "parentId", zipDocumentId }, // Link to the original ZIP's DocumentId, using camelCase
                                    { "SHA256HASH", sha256Hash },
                                    { "createdDate", DateTime.UtcNow.ToString("o") },
                                    { "modifiedDate", DateTime.UtcNow.ToString("o") }
                                };

                                await unzippedBlobClient.UploadAsync(fileMemoryStream, overwrite: true);
                                await unzippedBlobClient.SetMetadataAsync(unzippedMetadata);
                                _logger.LogInformation("Extracted file {UnzippedBlobName} uploaded with ParentId {ParentId}.", unzippedBlobName, zipDocumentId);
                            }
                        }
                    }
                }
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
        /// Lists blobs in a container along with their SHA256 checksum from metadata, including virtual folders.
        /// </summary>
        /// <param name="targetContainerName">The name of the container.</param>
        /// <param name="pageSize">Number of blobs to return per page (minimum 1).</param>
        /// <param name="continuationToken">Continuation token for pagination, in the format 'prefix1:token1|prefix2:token2|...|currentIndex' or null for the first page.</param>
        /// <returns>A PaginatedBlobList containing blobs and the next continuation token.</returns>
        public async Task<PaginatedBlobList> ListBlobsAsync(string targetContainerName, int pageSize, string? folderPath, string? continuationToken, bool listFoldersOnly = false)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }

            if (pageSize < 1)
            {
                _logger.LogError("Invalid pageSize: {PageSize}. Must be at least 1.", pageSize);
                throw new ArgumentException("Page size must be at least 1.", nameof(pageSize));
            }

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
            );
            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            var paginatedResult = new PaginatedBlobList();
            var fileInfos = new List<MyBlobUploadApi.Models.FileInfo>();

            // Adjust prefix for listing based on folderPath
            string prefixToUse = folderPath;
            if (!string.IsNullOrEmpty(prefixToUse) && !prefixToUse.EndsWith("/"))
            {
                prefixToUse += "/"; // Ensure prefix ends with "/" for folder listing
            }

            _logger.LogInformation("Listing blobs with prefix: '{Prefix}', continuation token: '{Token}'", prefixToUse ?? "root", continuationToken ?? "none");

            // List blobs
            var resultSegment = containerClient.GetBlobsAsync(prefix: prefixToUse, traits: BlobTraits.Metadata)
                                             .AsPages(continuationToken, pageSize);

            var uniqueFolders = new HashSet<string>();

            await foreach (var page in resultSegment)
            {
                foreach (var blobItem in page.Values)
                {
                    if (listFoldersOnly && string.IsNullOrEmpty(folderPath))
                    {
                        // If we are at the root and only want folders
                        var firstSlashIndex = blobItem.Name.IndexOf('/');
                        if (firstSlashIndex > -1)
                        {
                            var folderName = blobItem.Name.Substring(0, firstSlashIndex);
                            if (uniqueFolders.Add(folderName))
                            {
                                // Create a dummy FileInfo for the folder
                                fileInfos.Add(new MyBlobUploadApi.Models.FileInfo
                                {
                                    Name = folderName + "/", // Represent as a folder
                                    Checksum = "N/A",
                                    Metadata = new Dictionary<string, string>(),
                                    IsFolder = true // Indicate it's a folder
                                });
                            }
                        }
                        // Skip files at the root level when listFoldersOnly is true
                        continue;
                    }

                    // Existing logic for files and subfolders when not in listFoldersOnly mode at root
                    if (blobItem.Properties.ContentLength == 0 && blobItem.Name.EndsWith("/"))
                    {
                        _logger.LogInformation("Skipping directory placeholder blob: {BlobName}", blobItem.Name);
                        continue;
                    }

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
                            string normalizedKey = char.ToLowerInvariant(pair.Key[0]) + pair.Key.Substring(1);
                            metadata[normalizedKey] = pair.Value;
                        }
                    }

                    string metadataString = metadata.Any() ? string.Join(", ", metadata.Select(p => $"{p.Key}={p.Value}")) : "none";
                    _logger.LogInformation("Retrieved blob: {BlobName}, Metadata: {MetadataString}", blobItem.Name, metadataString);

                    fileInfos.Add(new MyBlobUploadApi.Models.FileInfo
                    {
                        Name = blobItem.Name,
                        Checksum = checksum,
                        Metadata = metadata,
                        IsFolder = false, // Default to false for files
                        ParentId = metadata.TryGetValue("parentId", out var parentIdValue) ? parentIdValue : null // Populate ParentId
                    });
                }

                if (!string.IsNullOrEmpty(page.ContinuationToken))
                {
                    paginatedResult.NextContinuationToken = page.ContinuationToken; // The continuation token is just the token from Azure
                }
                // If listFoldersOnly is true and we are at the root, we want to process all blobs to find all unique folders
                // so we should not break after the first page. However, for simplicity and to avoid fetching all blobs
                // in a very large container, we will still break after the first page for now. This might mean not all
                // root folders are returned if they are on subsequent pages. A more robust solution would require
                // iterating through all pages or using a different Azure SDK feature for hierarchical listing.
                if (!listFoldersOnly || !string.IsNullOrEmpty(folderPath))
                {
                    break; // Process only the first page for now, unless listing root folders
                }
            }

            // If we were listing only folders, sort them by name before returning
            if (listFoldersOnly && string.IsNullOrEmpty(folderPath))
            {
                paginatedResult.Items = fileInfos.OrderBy(f => f.Name).ToList();
            }
            else
            {
                paginatedResult.Items = fileInfos;
            }
            string returnedBlobs = paginatedResult.Items.Any() ? string.Join(", ", paginatedResult.Items.Select(i => i.Name)) : "none";
            _logger.LogInformation("Returning {ItemCount} blobs for container {TargetContainerName} with prefix '{Prefix}': {ReturnedBlobs}",
            fileInfos.Count, targetContainerName, prefixToUse ?? "root", returnedBlobs);
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

        /// <summary>
        /// Retrieves the metadata for a specific blob.
        /// </summary>
        /// <param name="targetContainerName">The name of the container.</param>
        /// <param name="blobName">The name of the blob.</param>
        /// <returns>A dictionary of metadata, or null if the blob does not exist.</returns>
        public async Task<IDictionary<string, string>?> GetBlobMetadataAsync(string targetContainerName, string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName) || string.IsNullOrWhiteSpace(blobName))
            {
                throw new ArgumentException("Container and blob names cannot be empty.");
            }

            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null || string.IsNullOrWhiteSpace(accountDetail.AccountName) || string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for getting blob metadata.");
                throw new InvalidOperationException("Storage account for metadata retrieval is not configured properly.");
            }

            var blobServiceClient = new BlobServiceClient($"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net");
            var containerClient = blobServiceClient.GetBlobContainerClient(targetContainerName);
            var blobClient = containerClient.GetBlobClient(blobName);

            if (await blobClient.ExistsAsync())
            {
                BlobProperties properties = await blobClient.GetPropertiesAsync();
                var metadata = new Dictionary<string, string>();
                foreach (var pair in properties.Metadata)
                {
                    string normalizedKey = char.ToLowerInvariant(pair.Key[0]) + pair.Key.Substring(1);
                    metadata[normalizedKey] = pair.Value;
                }
                return metadata;
            }
            return null;
        }

        public async Task<Stream> DownloadBlobAsync(string containerName, string blobName)
        {
            var accountDetail = _storageAccounts.FirstOrDefault();
            if (accountDetail == null || string.IsNullOrWhiteSpace(accountDetail.AccountName) || string.IsNullOrWhiteSpace(accountDetail.AccountKey))
            {
                _logger.LogError("No valid storage account configuration found for getting blob metadata.");
                throw new InvalidOperationException("Storage account for metadata retrieval is not configured properly.");
            }
            var blobServiceClient = new BlobServiceClient($"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net");
            var containerClient = blobServiceClient.GetBlobContainerClient(containerName);
            var blobClient = containerClient.GetBlobClient(blobName);

            if (await blobClient.ExistsAsync())
            {
                var stream = new MemoryStream();
                await blobClient.DownloadToAsync(stream);
                stream.Position = 0;
                return stream;
            }

            return null;
        }
        public async Task UploadBlobAsync(string containerName, string blobName, Stream content, bool overwrite)
        {
            try
            {
                var accountDetail = _storageAccounts.FirstOrDefault();
                if (accountDetail == null || string.IsNullOrWhiteSpace(accountDetail.AccountName) || string.IsNullOrWhiteSpace(accountDetail.AccountKey))
                {
                    _logger.LogError("No valid storage account configuration found for getting blob metadata.");
                    throw new InvalidOperationException("Storage account for metadata retrieval is not configured properly.");
                }
                var blobServiceClient = new BlobServiceClient($"DefaultEndpointsProtocol=https;AccountName={accountDetail.AccountName};AccountKey={accountDetail.AccountKey};EndpointSuffix=core.windows.net");
                var containerClient = blobServiceClient.GetBlobContainerClient(containerName);
                BlobClient blobClient = containerClient.GetBlobClient(blobName);

                if (!overwrite && await blobClient.ExistsAsync())
                {
                    _logger.LogWarning("Blob '{BlobName}' already exists in container '{ContainerName}' and overwrite is false.", blobName, containerName);
                    return;
                }

                await blobClient.UploadAsync(content, overwrite);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading blob {BlobName} to container {ContainerName}", blobName, containerName);
                throw; // Rethrow to allow the caller to handle it.
            }
        }
    }
}