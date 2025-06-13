using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyBlobUploadApi.Services;
using Azure.Search.Documents.Models;
using Azure.Search.Documents;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace MyBlobUploadApi.Controllers
{
    //[Authorize]
    [ApiController]
    [Route("api/search")]
    public class SearchController : ControllerBase
    {
        private readonly AzureSearchService _azureSearchService;
        private readonly ILogger<SearchController> _logger;

        public SearchController(AzureSearchService azureSearchService, ILogger<SearchController> logger)
        {
            _azureSearchService = azureSearchService;
            _logger = logger;
        }

        [HttpGet]
        [ProducesResponseType(typeof(SearchResults<SearchDocument>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> Search([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return BadRequest(new { Message = "Search query cannot be empty." });
            }

            try
            {
                var searchOptions = new SearchOptions { IncludeTotalCount = true };
                SearchResults<SearchDocument> results = await _azureSearchService.SearchAsync(query, searchOptions);
                return Ok(results);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An error occurred while processing the search query: {Query}", query);
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "An error occurred while searching.", Details = ex.Message });
            }
        }
    }
}