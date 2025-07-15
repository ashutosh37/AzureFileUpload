using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MyBlobUploadApi.Services;
using MyBlobUploadApi.Models; // Added for SasUploadInfo
using Microsoft.Identity.Web; // Required for ITokenAcquisition
using Microsoft.AspNetCore.Authorization; // Add this line
using System;
using System.Linq;
using System.Net; // Required for WebProxy
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using MimeKit;
using System.Text.Json;
using System.Security.Principal;
using MsgReader.Outlook;

namespace MyBlobUploadApi.Controllers
{
    [Authorize] // Protect all actions in this controller
    [ApiController]
    [Route("api/files")]
    public class FileUploadController : ControllerBase
    {
        private readonly BlobStorageService _blobStorageService;
        private readonly ILogger<FileUploadController> _logger;
        private readonly IConfiguration _configuration;
        private readonly ITokenAcquisition _tokenAcquisition;
        private readonly IHttpClientFactory _httpClientFactory;

        public FileUploadController(
            BlobStorageService blobStorageService,
            ILogger<FileUploadController> logger,
            IConfiguration configuration,
            ITokenAcquisition tokenAcquisition,
            IHttpClientFactory httpClientFactory)
        {
            _blobStorageService = blobStorageService;
            _logger = logger;
            _configuration = configuration;
            _tokenAcquisition = tokenAcquisition;
            _httpClientFactory = httpClientFactory;
        }


        [HttpPost("generate-upload-urls")]
        [ProducesResponseType(typeof(IEnumerable<SasUploadInfo>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)] // Added for clarity, though [Authorize] handles it
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> GenerateUploadUrls([FromQuery] string targetContainerName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                _logger.LogWarning("GenerateUploadUrls attempt with missing targetContainerName.");
                return BadRequest(new { Message = "Target container name is required." });
            }

            // Check if the authenticated user is the allowed user.
            if (!await IsUserAuthorizedForRestrictedActions(HttpContext.User))
            {
                _logger.LogWarning("Forbidden: User {UserName} attempted to generate upload URLs without permission.",
                    HttpContext.User.Identity?.Name ?? "Unknown");
                return StatusCode(StatusCodes.Status403Forbidden, new { Message = "You do not have access to perform this action." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            try
            {
                // Log user details from the token claims for debugging purposes (moved here after auth check)
                var user = HttpContext.User; // Re-declare user in this scope
                var userName = user.Identity?.Name ?? "Unknown"; // Re-declare userName in this scope
                // The 'oid' or objectidentifier claim holds the user's unique ID
                var userObjectId = user.Claims.FirstOrDefault(c => c.Type == "http://schemas.microsoft.com/identity/claims/objectidentifier" || c.Type == "oid")?.Value ?? "N/A";

                _logger.LogInformation("GenerateUploadUrls request received from User: {UserName}, Object ID: {UserObjectId} for container {TargetContainerName}", userName, userObjectId, lowerCaseContainerName);

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
        [ProducesResponseType(StatusCodes.Status409Conflict)] // Added for file conflict
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

            bool overwrite = HttpContext.Request.Form.ContainsKey("overwrite") && HttpContext.Request.Form["overwrite"] == "true";
            // fileLastModifiedIso will be the ISO string from the frontend's file.lastModified
            string fileLastModifiedIso = HttpContext.Request.Form["fileLastModified"];

            try
            {
                // Parse container name from containerSasUrl
                Uri providedUri = new Uri(containerSasUrl);
                string path = providedUri.AbsolutePath.Trim('/');
                string? extractedContainerName = path.Split('/').LastOrDefault()?.ToLowerInvariant(); // Assumes shardname might be present. Container names must be lowercase.

                _logger.LogInformation("Backend: Received fileLastModifiedIso for {FileName}: {FileLastModifiedIso}", file.FileName, fileLastModifiedIso);
                string originalCreatedDate = null;
                string originalCreatedBy = null;

                if (overwrite && !string.IsNullOrWhiteSpace(extractedContainerName))
                {
                    var existingMetadata = await _blobStorageService.GetBlobMetadataAsync(extractedContainerName, file.FileName);
                    if (existingMetadata != null)
                    {
                        existingMetadata.TryGetValue("createdDate", out originalCreatedDate);
                        existingMetadata.TryGetValue("createdBy", out originalCreatedBy);
                    }
                }

                if (string.IsNullOrWhiteSpace(extractedContainerName))
                {
                    _logger.LogWarning("Could not extract container name from SAS URL: {ContainerSasUrl}", containerSasUrl);
                    return BadRequest(new { Message = "Invalid container SAS URL format." });
                }

                // Check if blob already exists
                if (!overwrite && await _blobStorageService.BlobExistsAsync(extractedContainerName, file.FileName))
                {
                    _logger.LogWarning("File upload conflict: Blob '{BlobName}' already exists in container '{ContainerName}'.", file.FileName, extractedContainerName);
                    return Conflict(new { Message = $"File '{file.FileName}' already exists.", OverwriteOption = true });
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

                        // Add audit metadata. For this implementation, an overwrite resets all audit fields.
                        var userName = HttpContext.User.Identity?.Name ?? "Unknown";
                        var now = DateTime.UtcNow.ToString("o"); // Fallback

                        // For createdDate: Preserve original if it's an overwrite, otherwise use current server time.
                        var createdDate = originalCreatedDate ?? now;
                        var createdBy = originalCreatedBy ?? userName;

                        // For modifiedDate: Always use the server's current time for the upload event.
                        _logger.LogInformation("Backend: Setting createdDate for {FileName}: {CreatedDate}", file.FileName, createdDate);
                        _logger.LogInformation("Backend: Setting modifiedDate for {FileName}: {ModifiedDate}", file.FileName, now);

                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-createdDate", createdDate);
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-createdBy", createdBy);
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-modifiedDate", now);
                        httpClient.DefaultRequestHeaders.Add("x-ms-meta-modifiedBy", userName);

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
        [ProducesResponseType(StatusCodes.Status401Unauthorized)] // Added for clarity, though [Authorize] handles it
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]        
        public async Task<IActionResult> ListFiles([FromQuery] string targetContainerName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName))
            {
                return BadRequest(new { Message = "Target container name is required." });
            }

            // Check if the authenticated user is the allowed user.
            if (!await IsUserAuthorizedForRestrictedActions(HttpContext.User))
            {
                _logger.LogWarning("Forbidden: User {UserName} attempted to list files without permission.",
                    HttpContext.User.Identity?.Name ?? "Unknown");
                return StatusCode(StatusCodes.Status403Forbidden, new { Message = "You do not have access to view these files." });
            }

            var lowerCaseContainerName = targetContainerName.ToLowerInvariant();

            try
            {                
                // Log user details from the token claims for debugging purposes (moved here after auth check)
                var user = HttpContext.User; // Re-declare user in this scope
                var userName = user.Identity?.Name ?? "Unknown"; // Re-declare userName in this scope
                // The 'oid' or objectidentifier claim holds the user's unique ID
                var userObjectId = user.Claims.FirstOrDefault(c => c.Type == "http://schemas.microsoft.com/identity/claims/objectidentifier" || c.Type == "oid")?.Value ?? "N/A";

                _logger.LogInformation("ListFiles request received from User: {UserName}, Object ID: {UserObjectId}", userName, userObjectId);

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
                // Store original createdDate and createdBy if they exist in the incoming metadata
                // This ensures they are preserved even if the frontend didn't explicitly send them back
                // (though the frontend should be sending all existing metadata).
                string originalCreatedDate = null;
                string originalCreatedBy = null;
                metadata.TryGetValue("createdDate", out originalCreatedDate);
                metadata.TryGetValue("createdBy", out originalCreatedBy);

                // On any metadata update, also update the modifiedDate and modifiedBy fields.
                // This assumes the frontend sends back existing metadata (including createdDate/By) to preserve it.
                var userName = HttpContext.User.Identity?.Name ?? "Unknown";
                var now = DateTime.UtcNow.ToString("o"); // ISO 8601 format
                metadata["modifiedDate"] = now;
                metadata["modifiedBy"] = userName;

                // Ensure createdDate and createdBy are re-added if they were present initially
                // and not explicitly removed or changed by the user in the properties pane.
                if (!string.IsNullOrEmpty(originalCreatedDate))
                {
                    metadata["createdDate"] = originalCreatedDate;
                }
                if (!string.IsNullOrEmpty(originalCreatedBy))
                {
                    metadata["createdBy"] = originalCreatedBy;
                }

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

        [HttpGet("matters")]
        [ProducesResponseType(typeof(IEnumerable<object>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> GetMattersAsync()
        {
            // This is a dummy endpoint. In a real application, you would query
            // your data source (e.g., Dataverse, SQL) to get a list of matters
            // the current user has access to.
            // The [Authorize] attribute on the controller ensures this is only accessible to logged-in users.

            // Get user's email from the token claims.
            // The 'preferred_username' claim often contains the user's email/UPN.
            
            foreach (var claim in HttpContext.User.Claims)
            {
                Console.WriteLine($"Type: {claim.Type}, Value: {claim.Value}");
            }

            var userEmail = HttpContext.User.Claims.FirstOrDefault(c => c.Type == "upn" || c.Type == "upn" || c.Type == "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value ?? "N/A";
            Console.WriteLine(userEmail);
            if (string.IsNullOrEmpty(userEmail))
            {
                // Fallback to other possible email claims if needed
                userEmail = HttpContext.User.Claims.FirstOrDefault(c => c.Type == "email")?.Value;
            }

            if (string.IsNullOrEmpty(userEmail))
            {
                _logger.LogWarning("Could not determine user email from token claims.");
                // Depending on requirements, you might want to return an error here
                // return BadRequest(new { Message = "Could not determine user identity." });
            }
            else
            {
                _logger.LogInformation("GetMatters request received for user: {UserEmail}", userEmail);
            }
                var dataverseScope = _configuration["Dataverse:Scopes"];
                var dataverseScopes = new[] { dataverseScope };
                var accessToken = await _tokenAcquisition.GetAccessTokenForUserAsync(dataverseScopes);
                // 3. Call the Dataverse API to check for team membership.
                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                client.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0");
                client.DefaultRequestHeaders.Add("OData-Version", "4.0");
                client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                
                var dataverseBaseUrl = _configuration["Dataverse:BaseUrl"];
            // TODO: Use userEmail to query Dynamics 365/Dataverse for matters this user can access.
            //api/data/v9.2/fwotrace_matterteammembers?$select=fwotrace_matterteammemberid,fwotrace_name,createdon&$expand=fwotrace_MatterTeamId($select=fwotrace_name;$expand=fwotrace_MatterId($select=fwotrace_mattertitle)),fwotrace_MemberId($select=systemuserid)&$filter=(fwotrace_securityrole eq 230490000) and (fwotrace_MatterTeamId/fwotrace_matterteamid ne null) and (fwotrace_MemberId/internalemailaddress eq %27Ashutosh.Nigam%40fwo.gov.au%27)&$orderby=fwotrace_name asc
            var requestUrl = $"{dataverseBaseUrl}/api/data/v9.2/fwotrace_matterteammembers?$select=fwotrace_matterteammemberid,fwotrace_name,createdon&$expand=fwotrace_MatterTeamId($select=fwotrace_name;$expand=fwotrace_MatterId($select=fwotrace_mattertitle)),fwotrace_MemberId($select=systemuserid)&$filter=(fwotrace_securityrole eq 230490000) and (fwotrace_MatterTeamId/fwotrace_matterteamid ne null) and (fwotrace_MemberId/internalemailaddress eq {userEmail})&$orderby=fwotrace_name asc";
            Console.WriteLine(requestUrl);
            var response = await client.GetAsync(requestUrl);
            if (response.IsSuccessStatusCode)
            {
                var jsonResponse = await response.Content.ReadAsStringAsync();
                Console.WriteLine(jsonResponse);
                using (var doc = JsonDocument.Parse(jsonResponse))
                {
                    var userArray = doc.RootElement.GetProperty("value");
                }
            }

            var matters = new[]
            {
                new { id = "matter1234", name = "Matter 1234" },
                new { id = "matter002-opskyline", name = "Operation Skyline" },
                new { id = "matter003-case734", name = "Case File 734" },
                new { id = "matter-final-review", name = "Final Review Documents" }
            };

            return Ok(matters);
        }

        [HttpGet("message-content")]
        [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> GetMessageContent(string targetContainerName, string blobName)
        {
            if (string.IsNullOrWhiteSpace(targetContainerName) || string.IsNullOrWhiteSpace(blobName))
            {
                return BadRequest(new { Message = "Container and blob names must be provided." });
            }

            try
            {
                using (Stream blobStream = await _blobStorageService.DownloadBlobAsync(targetContainerName, blobName))
                {
                    if (blobStream == null)
                    {
                        return NotFound(new { Message = $"Blob '{blobName}' not found in container '{targetContainerName}'." });
                    }

                    var extension = Path.GetExtension(blobName).ToLowerInvariant();

                    string from = "";
                    string to = "";
                    string subject = "";
                    string bodyText = "";
                    string bodyHtml = "";

                    if (extension == ".eml")
                    {
                        var parserOptions = ParserOptions.Default.Clone();
                        var message = await MimeMessage.LoadAsync(parserOptions, blobStream, CancellationToken.None);

                        from = message.From.ToString();
                        to = message.To.ToString();
                        subject = message.Subject;
                        bodyText = message.TextBody ?? "";
                        bodyHtml = message.HtmlBody ?? "";
                    }
                    else if (extension == ".msg")
                    {
                        using (var memoryStream = new MemoryStream())
                        {
                            await blobStream.CopyToAsync(memoryStream);
                            memoryStream.Position = 0;

                            using (var msg = new MsgReader.Outlook.Storage.Message(memoryStream))
                            {
                                var senderEmail = msg.Sender?.Email ?? "";
                                var senderName = msg.Sender?.DisplayName ?? "";
                                from = $"{senderEmail} ({senderName})";

                                var recipients = msg.GetEmailRecipients(RecipientType.To, false, false);
                                to = recipients != null ? string.Join(", ", recipients) : "";

                                subject = msg.Subject;
                                bodyText = msg.BodyText ?? "";
                                bodyHtml = msg.BodyHtml ?? "";
                            }
                        }
                    }
                    else
                    {
                        return BadRequest(new { Message = "Unsupported file format. Only .eml and .msg files are supported." });
                    }

                    var messageData = new
                    {
                        From = from,
                        To = to,
                        Subject = subject,
                        Text = bodyText,
                        Html = bodyHtml
                    };

                    return Ok(messageData);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving or parsing message content for blob '{BlobName}' in container '{TargetContainerName}'.", blobName, targetContainerName);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "Error retrieving or parsing message content.", Details = ex.Message });
            }
        }







        /// <summary>
        /// Checks if the authenticated user is authorized to perform restricted actions.
        /// </summary>
        /// <param name="user">The ClaimsPrincipal representing the authenticated user.</param>
        /// <returns>A Task resulting in true if the user is authorized, false otherwise.</returns>
        private async Task<bool> IsUserAuthorizedForRestrictedActions(System.Security.Claims.ClaimsPrincipal user)
        {
            try
            {
                // 1. Get the user's unique Azure AD Object ID from the token claims.
                var userObjectId = user.Claims.FirstOrDefault(c => c.Type == "http://schemas.microsoft.com/identity/claims/objectidentifier" || c.Type == "oid")?.Value;

                if (string.IsNullOrEmpty(userObjectId))
                {
                    _logger.LogWarning("Authorization check failed: User OID claim not found in token.");
                    return false;
                }

                // 2. Acquire an On-Behalf-Of token for Dataverse.
                var dataverseScope = _configuration["Dataverse:Scopes"];
                if (string.IsNullOrEmpty(dataverseScope))
                {
                    _logger.LogError("Authorization check failed: Dataverse:Scopes configuration is missing in appsettings.json.");
                    return false;
                }
                var dataverseScopes = new[] { dataverseScope };
                var accessToken = await _tokenAcquisition.GetAccessTokenForUserAsync(dataverseScopes);

                // 3. Call the Dataverse API to check for team membership.
                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                client.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0");
                client.DefaultRequestHeaders.Add("OData-Version", "4.0");
                client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                var dataverseBaseUrl = _configuration["Dataverse:BaseUrl"];
                // This query finds the Dataverse user by their Azure AD Object ID and expands their team memberships.
                // It will return a list of teams the user belongs to.
                // You can make this more specific by adding a $filter to the expanded property,
                // e.g., $expand=teammembership_association($filter=name eq 'Admins';$select=name)
                var requestUrl = $"{dataverseBaseUrl}/api/data/v9.2/systemusers?$filter=azureactivedirectoryobjectid eq {userObjectId}&$expand=teammembership_association($select=name)";

                _logger.LogInformation("Checking Dataverse permissions for user OID {userObjectId}", userObjectId);

                var response = await client.GetAsync(requestUrl);

                if (response.IsSuccessStatusCode)
                {
                    var jsonResponse = await response.Content.ReadAsStringAsync();
                    using (var doc = JsonDocument.Parse(jsonResponse))
                    {
                        // The response is an array of systemuser objects. We expect only one.
                        var userArray = doc.RootElement.GetProperty("value");
                        if (userArray.GetArrayLength() > 0)
                        {
                            var userObject = userArray[0];
                            if (userObject.TryGetProperty("teammembership_association", out var teamsArray))
                            {
                                // If the teams array has one or more teams, the user is in a team.
                                if (teamsArray.GetArrayLength() > 0)
                                {
                                    _logger.LogInformation("Authorization success for user OID {userObjectId}. User is a member of at least one team.", userObjectId);
                                    return true; // User is in at least one team, so they are authorized.
                                }
                            }
                        }
                    }
                }
                else
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError("Dataverse API call failed with status {StatusCode}. Response: {ErrorContent}", response.StatusCode, errorContent);
                }

                _logger.LogWarning("Authorization failed for user OID {userObjectId}. User is not a member of a required team or an error occurred.", userObjectId);
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An unexpected error occurred during Dataverse authorization check.");
                return false;
            }
        }
    }
}