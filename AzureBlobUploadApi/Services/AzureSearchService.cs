using Azure;
using Azure.Search.Documents;
using Azure.Search.Documents.Models;
using Microsoft.Extensions.Options;
using MyBlobUploadApi.Models; // Assuming you might create a SearchConfig model
using System.Collections.Generic;
using System.Threading.Tasks;

namespace MyBlobUploadApi.Services
{
    public class AzureSearchConfig
    {
        public string? Endpoint { get; set; }
        public string? AdminKey { get; set; }
        public string? IndexName { get; set; }
    }

    public class AzureSearchService
    {
        private readonly SearchClient _searchClient;
        private readonly ILogger<AzureSearchService> _logger;

        public AzureSearchService(IOptions<AzureSearchConfig> searchConfig, ILogger<AzureSearchService> logger)
        {
            _logger = logger;
            if (string.IsNullOrWhiteSpace(searchConfig.Value.Endpoint) ||
                string.IsNullOrWhiteSpace(searchConfig.Value.AdminKey) ||
                string.IsNullOrWhiteSpace(searchConfig.Value.IndexName))
            {
                _logger.LogError("Azure Search configuration is missing or incomplete. Endpoint, AdminKey, and IndexName are required.");
                throw new InvalidOperationException("Azure Search configuration is missing or incomplete.");
            }

            Uri endpointUri = new Uri(searchConfig.Value.Endpoint);
            AzureKeyCredential credential = new AzureKeyCredential(searchConfig.Value.AdminKey);
            _searchClient = new SearchClient(endpointUri, searchConfig.Value.IndexName, credential);
        }

        public async Task<SearchResults<SearchDocument>> SearchAsync(string searchText, SearchOptions? options = null)
        {
            if (string.IsNullOrWhiteSpace(searchText))
            {
                // Return empty results or handle as appropriate if search text is empty
                return SearchModelFactory.SearchResults<SearchDocument>(new List<SearchResult<SearchDocument>>(), 0, null, null, null);
            }

            try
            {
                return await _searchClient.SearchAsync<SearchDocument>(searchText, options);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during Azure Search query for text: {SearchText}", searchText);
                throw; // Re-throw to be handled by the controller
            }
        }
    }
}