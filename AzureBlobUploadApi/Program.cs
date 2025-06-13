using MyBlobUploadApi.Services;
using MyBlobUploadApi.Models; // Added for StorageAccountDetail
using Microsoft.OpenApi.Models; // Required for OpenApiSchema
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);
var MyAllowSpecificOrigins = "_myAllowSpecificOrigins";

// Add services to the container.

// Configure Azure AD authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

builder.Services.AddAuthorization(); // You can add policies here if needed later

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "My Blob Upload API", Version = "v1" });
    options.MapType<IFormFile>(() => new OpenApiSchema
    {
        Type = "string",
        Format = "binary"
    });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Example: \"Authorization: Bearer {token}\"",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey, // Using ApiKey for simplicity in Swagger UI for Bearer tokens
        Scheme = "Bearer"
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement()
    {
        { new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }, new List<string>() }
    });
});

// Add CORS services
builder.Services.AddCors(options =>
{
    options.AddPolicy(name: MyAllowSpecificOrigins,
                      policy  =>
                      {
                          // Read from configuration or use a default
                          policy.WithOrigins(builder.Configuration.GetValue<string>("FrontendAppUrl") ?? "http://localhost:5173")
                                .AllowAnyHeader()
                                .AllowAnyMethod();
                      });
});

// Register your custom BlobStorageService (which now handles SAS generation)
builder.Services.AddSingleton<BlobStorageService>();

// Configure and bind the StorageAccountsForSasUpload settings
builder.Services.Configure<List<StorageAccountDetail>>(
    builder.Configuration.GetSection("StorageAccountsForSasUpload"));

// Configure and bind Azure Search settings
builder.Services.Configure<AzureSearchConfig>(
    builder.Configuration.GetSection("AzureSearch"));
builder.Services.AddSingleton<AzureSearchService>();
var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "My Blob Upload API V1");
    });
}

app.UseHttpsRedirection();

// Use CORS middleware - IMPORTANT: Call UseCors before UseAuthorization and MapControllers.
app.UseCors(MyAllowSpecificOrigins);

app.UseAuthentication(); // Enable authentication middleware
app.UseAuthorization(); // Enable authorization middleware

app.MapControllers();

app.Run();
