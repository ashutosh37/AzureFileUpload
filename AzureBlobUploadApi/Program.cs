using MyBlobUploadApi.Services;
using MyBlobUploadApi.Models; // Added for StorageAccountDetail
using Microsoft.OpenApi.Models; // Required for OpenApiSchema

var builder = WebApplication.CreateBuilder(args);
var MyAllowSpecificOrigins = "_myAllowSpecificOrigins";
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.MapType<IFormFile>(() => new OpenApiSchema
    {
        Type = "string",
        Format = "binary"
    });
});

// Add CORS services
builder.Services.AddCors(options =>
{
    options.AddPolicy(name: MyAllowSpecificOrigins,
                      policy  =>
                      {
                          policy.WithOrigins("http://localhost:5173") // Your frontend's origin
                                .AllowAnyHeader()
                                .AllowAnyMethod();
                      });
});

// Register your custom BlobStorageService (which now handles SAS generation)
builder.Services.AddSingleton<BlobStorageService>();

// Configure and bind the StorageAccountsForSasUpload settings
builder.Services.Configure<List<StorageAccountDetail>>(
    builder.Configuration.GetSection("StorageAccountsForSasUpload"));

// Authorization services might still be needed if you plan to use other authorization mechanisms.
// If not, this can also be removed. For now, let's keep it if controllers might have [AllowAnonymous] or other policies.
// builder.Services.AddAuthorization(); // Commented out or remove if no authorization is used.

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

// Use CORS middleware - IMPORTANT: Call UseCors before UseAuthorization and MapControllers.
app.UseCors(MyAllowSpecificOrigins);

// app.UseAuthentication(); // Removed authentication middleware
// app.UseAuthorization(); // Commented out or remove if no authorization is used.

app.MapControllers();

app.Run();
