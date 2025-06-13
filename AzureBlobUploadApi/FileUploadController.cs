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
    [Authorize] // Protect all actions in this controller
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

            try
            {
                var sasUploadInfos = _blobStorageService.GenerateSasUploadUris(targetContainerName);

                if (!sasUploadInfos.Any())
                {
                    _logger.LogWarning("No SAS upload URLs could be generated for container {TargetContainerName}. Check configuration.", targetContainerName);
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { Message = "Unable to generate upload URLs at this time. Service may be misconfigured." });
                }

                _logger.LogInformation("Successfully generated {Count} SAS upload URLs for container {TargetContainerName}", sasUploadInfos.Count(), targetContainerName);
                return Ok(sasUploadInfos);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating SAS upload URLs for container {TargetContainerName}", targetContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while generating upload URLs." });
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
                string extractedContainerName = path.Split('/').LastOrDefault(); // Assumes shardname might be present

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

                if (!string.IsNullOrWhiteSpace(proxyUrl))
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
        [ProducesResponseType(typeof(IEnumerable<string>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> ListFiles([FromQuery] string targetContainerName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                return BadRequest(new { Message = "Target container name is required." });
            }

            try
            {
                var blobNames = await _blobStorageService.ListBlobsAsync(targetContainerName);
                _logger.LogInformation("Successfully listed {Count} files from container {TargetContainerName}", blobNames.Count(), targetContainerName);
                return Ok(blobNames);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error listing files from container {TargetContainerName}", targetContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An unexpected error occurred while listing files.", Details = ex.Message });
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
    }
}