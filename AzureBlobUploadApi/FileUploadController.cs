using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MyBlobUploadApi.Services;
using MyBlobUploadApi.Models; // Added for SasUploadInfo
using Microsoft.AspNetCore.Authorization; // Add this line
using System;
using System.Linq;
using System.Net; // Required for WebProxy
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;

namespace MyBlobUploadApi.Controllers
{
    //[Authorize] // Protect all actions in this controller
    [ApiController]
    [Route("api/files")]
    public class FileUploadController : ControllerBase
    {
        private readonly BlobStorageService _blobStorageService;
        private readonly ILogger<FileUploadController> _logger;
        private readonly IConfiguration _configuration; // To read proxy settings

        public FileUploadController(
            BlobStorageService blobStorageService,
            ILogger<FileUploadController> logger,
            IConfiguration configuration) // Inject IConfiguration
        {
            _blobStorageService = blobStorageService;
            _logger = logger;
            _configuration = configuration; // Store IConfiguration
        }


        [HttpPost("generate-upload-urls")]
        [ProducesResponseType(typeof(IEnumerable<SasUploadInfo>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        // Client should send 'targetContainerName'. userId is removed.
        public IActionResult GenerateUploadUrls([FromQuery] string targetContainerName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                _logger.LogWarning("GenerateUploadUrls attempt with missing targetContainerName.");
                return BadRequest(new { Message = "Target container name is required." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            try
            {
                var sasUploadInfos = _blobStorageService.GenerateSasUploadUris(lowerCaseContainerName);

                if (!sasUploadInfos.Any())
                {
                    _logger.LogWarning("No SAS upload URLs could be generated for container {TargetContainerName}. Check configuration.", lowerCaseContainerName);
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { Message = "Unable to generate upload URLs at this time. Service may be misconfigured." });
                }

                _logger.LogInformation("Successfully generated {Count} SAS upload URLs for container {TargetContainerName}", sasUploadInfos.Count(), lowerCaseContainerName);
                return Ok(sasUploadInfos);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating SAS upload URLs for container {TargetContainerName}", lowerCaseContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while generating upload URLs." });
            }
        }


        [HttpDelete]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> DeleteFile([FromQuery] string targetContainerName, [FromQuery] string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName) || string.IsNullOrWhiteSpace(blobName))
            {
                return BadRequest(new { Message = "Target container name and blob name are required." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            try
            {
                await _blobStorageService.DeleteBlobAsync(lowerCaseContainerName, blobName);
                _logger.LogInformation("Successfully processed delete request for blob {BlobName} in container {TargetContainerName}", blobName, lowerCaseContainerName);
                // Return 204 No Content for successful deletion, which is standard for DELETE operations.
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting blob {BlobName} from container {TargetContainerName}", blobName, lowerCaseContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while deleting the file.", Details = ex.Message });
            }
        }
        
        [HttpPost("upload-via-sas")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)] // Could be 404 if container/shard doesn't exist
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        // This endpoint demonstrates how a client would use the container SAS URL
        // It takes the container SAS URL and the file, and constructs the final blob URL.
        public async Task<IActionResult> UploadFileViaSas([FromForm] string containerSasUrl, IFormFile file)
        {
            if (string.IsNullOrWhiteSpace(containerSasUrl))
            {
                return BadRequest(new { Message = "The container SAS URL is required." });
            }

            if (string.IsNullOrWhiteSpace(file?.FileName))
            {
                return BadRequest(new { Message = "File name is missing." });
            }
            if (file == null || file.Length == 0)
            {
                return BadRequest(new { Message = "Please select a file to upload." });
            }

            try
            {
                // Parse container name from containerSasUrl
                // The path part of containerSasUrl is like /<shardname_if_any>/<containername>
                Uri providedUri = new Uri(containerSasUrl);
                string path = providedUri.AbsolutePath.Trim('/');
                string? extractedContainerName = path.Split('/').LastOrDefault()?.ToLowerInvariant(); // Assumes shardname might be present. Container names must be lowercase.

                if (string.IsNullOrWhiteSpace(extractedContainerName))
                {
                    _logger.LogWarning("Could not extract container name from SAS URL: {ContainerSasUrl}", containerSasUrl);
                    return BadRequest(new { Message = "Invalid container SAS URL format." });
                }

                // Check if blob already exists
                bool blobExists = await _blobStorageService.BlobExistsAsync(extractedContainerName, file.FileName);
                if (blobExists)
                {
                    _logger.LogWarning("File upload conflict: Blob '{BlobName}' already exists in container '{ContainerName}'.", file.FileName, extractedContainerName);
                    return Conflict(new { Message = $"File '{file.FileName}' already exists in container '{extractedContainerName}'." });
                }

                var httpClientHandler = new HttpClientHandler();
                string proxyUrl = _configuration["ProxySettings:UploadSasProxyUrl"]; // Read from appsettings.json
                bool useProxy = _configuration.GetValue<bool>("ProxySettings:UseProxyForSasUpload", false); // Default to false if not found

                if (useProxy && !string.IsNullOrWhiteSpace(proxyUrl))
                {
                    var webProxy = new WebProxy(new Uri(proxyUrl), BypassOnLocal: false)
                    {
                        // Use the default network credentials of the application's process
                        UseDefaultCredentials = true
                    };
                    httpClientHandler.Proxy = webProxy;
                    httpClientHandler.UseProxy = true;
                    _logger.LogInformation("Using proxy {ProxyUrl} with default network credentials for SAS upload of {FileName} to container {ContainerName}", proxyUrl, file.FileName, extractedContainerName);
                }
                else if (useProxy && string.IsNullOrWhiteSpace(proxyUrl))
                {
                    _logger.LogWarning("Proxy usage is enabled (UseProxyForSasUpload=true) but ProxySettings:UploadSasProxyUrl is not configured. Proceeding without proxy.");
                }


                using (var fileStream = file.OpenReadStream())
                using (var httpClient = new HttpClient(httpClientHandler)) // Pass the configured handler
                {
                    // Azure Blob Storage requires this header for block blobs
                    httpClient.DefaultRequestHeaders.Add("x-ms-blob-type", "BlockBlob");

                    //Calculate SHA256Hash
                    using (var sha256 = SHA256.Create())
                    {
                        // Use the fileStream directly for hash calculation
                        byte[] hashBytes = await sha256.ComputeHashAsync(fileStream);
                        string sha256Hash = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();

                        // Add the hash as metadata
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-SHA256HASH", sha256Hash);

                        // --- Add other default metadata properties ---

                        // 1. Generate the unique Document ID
                        string docIdPrefix = _configuration["DocumentIdPrefix"] ?? "DOC"; // Fallback prefix
                        int nextDocNumber = await _blobStorageService.GetNextDocumentNumberAsync(extractedContainerName, docIdPrefix);

                        if (nextDocNumber > 9999)
                        {
                            // Handle the case where the document limit is reached.
                            return BadRequest(new { Message = "Maximum document limit (9999) reached for this matter." });
                        }
                        // D4 format specifier pads the number with leading zeros up to 4 digits
                        string documentId = $"{docIdPrefix}.{extractedContainerName}.{nextDocNumber:D4}";
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-DocumentId", documentId);

                        // 2. Generate ParentId based on virtual folder path
                        string blobName = file.FileName;
                        string parentId = "";
                        int lastSlashIndex = blobName.LastIndexOf('/');
                        if (lastSlashIndex > -1)
                        {
                            parentId = blobName.Substring(0, lastSlashIndex);
                        }
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-ParentId", parentId);

                        // 3. Add a default placeholder for Codings
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-Codings", "{}");

                        // IMPORTANT: Reset the stream position after reading it for hash calculation
                        fileStream.Seek(0, SeekOrigin.Begin);
                    }
                    // Create StreamContent from the reset stream
                    using (var streamContent = new StreamContent(fileStream))
                    {
                        streamContent.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);

                        // Construct the final blob URL by appending the blob name to the container URL part
                        // and then adding the SAS query string.
                        // Example: https://<frontdoor>/<shard>/<container>/<blobname>?<sas>
                        var uriBuilder = new UriBuilder(containerSasUrl);
                        uriBuilder.Path += $"/{file.FileName}"; // Append blob name to the path
                        string finalBlobUploadUrl = uriBuilder.ToString();

                        var response = await httpClient.PutAsync(finalBlobUploadUrl, streamContent);

                        if (response.IsSuccessStatusCode)
                        {
                            _logger.LogInformation("File {FileName} uploaded successfully via SAS to {UploadUrl}", file.FileName, finalBlobUploadUrl);
                            return Ok(new { Message = $"File '{file.FileName}' uploaded successfully.", Url = finalBlobUploadUrl.Split('?')[0] });
                        }
                        else
                        {
                            var errorContent = await response.Content.ReadAsStringAsync();
                            _logger.LogError("Failed to upload file {FileName} via SAS to {UploadUrl}. Status: {StatusCode}, Response: {ErrorContent}", file.FileName, finalBlobUploadUrl, response.StatusCode, errorContent);
                            return StatusCode((int)response.StatusCode, new { Message = $"Failed to upload file. Status: {response.StatusCode}", Details = errorContent });
                        }
                    }

                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading file {FileName} via SAS (container URL) {ContainerUrl}", file.FileName, containerSasUrl); // Use containerSasUrl as finalBlobUploadUrl is out of scope
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred during the upload process.", Details = ex.Message });
            }
        }
        [HttpGet("list")]
        [ProducesResponseType(typeof(IEnumerable<MyBlobUploadApi.Models.FileInfo>), StatusCodes.Status200OK)] // Corrected based on previous changes
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]        
        public async Task<IActionResult> ListFiles([FromQuery] string targetContainerName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                return BadRequest(new { Message = "Target container name is required." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            try
            {                
                // Default page size if not provided
                int pageSize = 20; // You can make this configurable or accept from query
                string? continuationToken = HttpContext.Request.Query["continuationToken"].FirstOrDefault();

                var paginatedResult = await _blobStorageService.ListBlobsAsync(lowerCaseContainerName, pageSize, continuationToken);

                _logger.LogInformation("Successfully listed {Count} files from container {TargetContainerName} with continuation token {ContinuationToken}", 
                                       paginatedResult.Items.Count(), 
                                       lowerCaseContainerName, 
                                       paginatedResult.NextContinuationToken ?? "N/A");

                // Return the paginated result directly
                return Ok(paginatedResult);

            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error listing files from container {TargetContainerName}", lowerCaseContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while listing files.", Details = ex.Message });
            }
        }

        [HttpGet("generate-read-sas")]
        [ProducesResponseType(typeof(SasDownloadInfo), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> GenerateReadSasUrl([FromQuery] string targetContainerName, [FromQuery] string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName) || string.IsNullOrWhiteSpace(blobName))
            {
                return BadRequest(new { Message = "Target container name and blob name are required." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            try
            {
                // Check if blob exists first
                bool blobExists = await _blobStorageService.BlobExistsAsync(lowerCaseContainerName, blobName);
                if (!blobExists)
                {
                    _logger.LogWarning("Attempt to generate read SAS for non-existent blob: Container '{TargetContainerName}', Blob '{BlobName}'.", lowerCaseContainerName, blobName);
                    return NotFound(new { Message = $"Blob '{blobName}' not found in container '{lowerCaseContainerName}'." });
                }

                var sasDownloadInfo = _blobStorageService.GenerateReadSasUri(lowerCaseContainerName, blobName);
                _logger.LogInformation("Successfully generated read SAS URL for blob {BlobName} in container {TargetContainerName}", blobName, lowerCaseContainerName);
                return Ok(sasDownloadInfo);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating read SAS URL for blob {BlobName} in container {TargetContainerName}", blobName, lowerCaseContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while generating the download URL.", Details = ex.Message });
            }
        }
        
        [HttpPost("get-SHA256-hash")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> UploadFileAndGetHash(IFormFile file)
        {
            if (file == null || file.Length == 0)
            {
                _logger.LogWarning("Upload attempt with no file or empty file.");
                return BadRequest(new { Message = "Please select a file to upload." });
            }

            try
            {
                using (var sha256 = SHA256.Create())
                using (var stream = file.OpenReadStream())
                {
                    byte[] hashBytes = await sha256.ComputeHashAsync(stream);
                    string hash = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();
                    _logger.LogInformation("File {FileName} uploaded and SHA256 hash is {Hash}", file.FileName, hash);
                    return Ok(new { FileName = file.FileName, Sha256Hash = hash });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading file {FileName} and calculating hash", file.FileName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred during file upload and hash calculation." });
            }
        }

        [HttpPut("{targetContainerName}/{blobName}/metadata")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> UpdateFileMetadata(
            [FromRoute] string targetContainerName,
            [FromRoute] string blobName,
            [FromBody] Dictionary<string, string> metadata)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName) || string.IsNullOrWhiteSpace(blobName))
            {
                return BadRequest(new { Message = "Target container name and blob name are required." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            if (metadata == null || !metadata.Any())
            {
                return BadRequest(new { Message = "Metadata cannot be null or empty." });
            }

            try
            {
                bool success = await _blobStorageService.UpdateBlobMetadataAsync(lowerCaseContainerName, blobName, metadata);
                return success ? NoContent() : NotFound(new { Message = $"Blob '{blobName}' not found in container '{lowerCaseContainerName}'." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating metadata for blob {BlobName} in container {TargetContainerName}", blobName, lowerCaseContainerName);
                // Consider if ex is ArgumentException or InvalidOperationException from service for more specific bad requests
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while updating metadata.", Details = ex.Message });
            }
        }
    }
}