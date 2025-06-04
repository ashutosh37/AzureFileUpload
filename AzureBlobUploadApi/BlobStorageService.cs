using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using Azure.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using MyBlobUploadApi.Models;
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

        public async Task<IEnumerable<string>> ListBlobsAsync(string targetContainerName)
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
            var blobNames = new List<string>();

            await foreach (var blobItem in containerClient.GetBlobsAsync())
            {
                blobNames.Add(blobItem.Name);
            }
            return blobNames;
        }
                public async Task<bool> BlobExistsAsync(string targetContainerName, string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                throw new ArgumentException("Target container name cannot be empty.", nameof(targetContainerName));
            }
            if (string.IsNullOrWhiteSpace(blobName))
            {
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
            var blobClient = containerClient.GetBlobClient(blobName);
            return await blobClient.ExistsAsync();
        }
    }
}