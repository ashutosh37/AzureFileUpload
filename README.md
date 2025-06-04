# Evidence Upload Application

This application allows users to upload files (evidence) to Azure Blob Storage via Azure Front Door. It consists of a .NET Core backend API and a React.js frontend.

## Table of Contents

1.  [Prerequisites](#prerequisites)
2.  [Project Structure](#project-structure)
3.  [Backend API Setup (AzureBlobUploadApi)](#backend-api-setup-azureblobuploadapi)
    *   [Configuration](#configuration)
    *   [Running Locally](#running-locally)
4.  [Frontend App Setup (EvidenceUploadApp)](#frontend-app-setup-evidenceuploadapp)
    *   [Configuration](#configuration-1)
    *   [Running Locally](#running-locally-1)
5.  [Azure Resources Setup](#azure-resources-setup)
    *   [Azure Storage Account](#azure-storage-account)
    *   [Azure Front Door (Optional but Recommended)](#azure-front-door-optional-but-recommended)
    *   [CORS Configuration](#cors-configuration)
6.  [Deployment](#deployment)
    *   [Backend API to Azure App Service](#backend-api-to-azure-app-service)
    *   [Frontend to Static Hosting (e.g., Azure Static Web Apps)](#frontend-to-static-hosting-eg-azure-static-web-apps)
7.  [Troubleshooting](#troubleshooting)

## Prerequisites

*   [.NET SDK](https://dotnet.microsoft.com/download) (Version specified in backend's `.csproj`, e.g., .NET 6.0 or later)
*   Node.js and npm (LTS version recommended)
*   Azure CLI (Optional, for deployment)
*   An active Azure Subscription
*   Code Editor (e.g., Visual Studio Code, Visual Studio)

## Project Structure

. ├── AzureBlobUploadApi/ # Backend .NET Core API │ ├── Controllers/ │ ├── Models/ │ ├── Services/ │ ├── appsettings.json │ ├── Program.cs │ └── AzureBlobUploadApi.csproj ├── EvidenceUploadApp/ # Frontend React App │ ├── public/ │ ├── src/ │ │ ├── App.css │ │ ├── App.tsx │ │ ├── FileUploadForm.tsx │ │ └── main.tsx │ ├── .env │ ├── index.html │ ├── package.json │ ├── tailwind.config.js │ ├── tsconfig.json │ └── vite.config.ts └── README.md


## Backend API Setup (AzureBlobUploadApi)

This is a .NET Core Web API responsible for:
*   Generating Shared Access Signature (SAS) URLs for Azure Blob Storage containers.
*   Listing blobs within a specified container.
*   (Optionally) Directly uploading files to Azure Blob Storage via a SAS URL (demonstration endpoint).

### Configuration

1.  Navigate to the backend directory:
    ```bash
    cd AzureBlobUploadApi
    ```
2.  Open `appsettings.json` (and `appsettings.Development.json` for development-specific overrides).
3.  Configure the `StorageAccountsForSasUpload` section:
    ```json
    "StorageAccountsForSasUpload": [
      {
        "FrontDoorHostname": "YOUR_FRONT_DOOR_HOSTNAME.azurefd.net", // e.g., evidence-ajbtgvegcmh2acc8.z02.azurefd.net
        "ShardName": "", // Optional: if you use sharding in Front Door paths
        "AccountName": "YOUR_AZURE_STORAGE_ACCOUNT_NAME", // e.g., legal365
        "AccountKey": "YOUR_AZURE_STORAGE_ACCOUNT_KEY",
        "ContainerName": "DEFAULT_CONTAINER_NAME_IF_ANY" // This is used by the service if no target container is specified by client, or for default operations. The client specifies the target container for SAS generation.
      }
      // You can add more account configurations if using multiple storage accounts
    ]
    ```
    *   **`FrontDoorHostname`**: The hostname of your Azure Front Door endpoint.
    *   **`ShardName`**: An optional path segment used in Front Door routing. Can be empty.
    *   **`AccountName`**: The name of your Azure Storage account.
    *   **`AccountKey`**: The access key for your Azure Storage account. **Treat this as a secret!** For production, use Azure Key Vault or App Service Configuration.
    *   **`ContainerName`**: A default container name. The API primarily uses the `targetContainerName` provided by the client for SAS generation and listing.

### Running Locally

1.  From the `AzureBlobUploadApi` directory:
    ```bash
    dotnet restore
    dotnet run
    ```
2.  The API will typically start on `https://localhost:7xxx` or `http://localhost:5xxx`. Check the console output for the exact URL.
3.  You can access Swagger UI for API testing at `/swagger` (e.g., `http://localhost:5230/swagger`).

## Frontend App Setup (EvidenceUploadApp)

This is a React.js application built with Vite and styled with Tailwind CSS. It allows users to:
*   Specify a container name.
*   Select a file.
*   Upload the file to the specified container via the backend API.
*   View a list of files in the selected container.

### Configuration

1.  Navigate to the frontend directory:
    ```bash
    cd EvidenceUploadApp
    ```
2.  Create a `.env` file in the root of the `EvidenceUploadApp` directory (if it doesn't exist):
    ```env
    VITE_BACKEND_API_BASE_URL=http://localhost:5230/api/files
    ```
    *   Replace `http://localhost:5230/api/files` with the actual URL where your backend API is running locally.
    *   For deployed environments, you'll update this to point to your deployed backend API URL.

### Running Locally

1.  From the `EvidenceUploadApp` directory:
    ```bash
    npm install
    npm run dev
    ```
2.  The frontend development server will typically start on `http://localhost:5173`. Open this URL in your browser.

## Azure Resources Setup

### Azure Storage Account

1.  Create an Azure Storage Account if you don't have one.
    *   Choose "Standard general-purpose v2".
    *   Enable "Hierarchical namespace" if you plan to use Azure Data Lake Storage Gen2 features (not strictly required for this app but good for analytics).
2.  Once created, navigate to your storage account in the Azure portal.
3.  Go to **Access keys** (under Security + networking) to find your `AccountName` and `AccountKey` for the backend `appsettings.json`.
4.  Create the blob containers you intend to use (e.g., `matter1234`). You can do this via the Azure portal (Storage account -> Containers -> + Container).

### Azure Front Door (Optional but Recommended)

Using Azure Front Door can provide benefits like a global CDN, WAF, custom domains, and path-based routing.

1.  Create an Azure Front Door Standard/Premium profile.
2.  **Origins/Origin Groups**:
    *   Add an origin group.
    *   Add an origin pointing to your Azure Storage Account's blob service endpoint (e.g., `yourstorageaccount.blob.core.windows.net`).
3.  **Routes**:
    *   Create a route that maps a frontend path (e.g., `/*` or `/{shardname}/{containername}/*`) to your storage account origin group.
    *   If you use `ShardName` in your backend configuration, ensure your Front Door route handles this path segment. For example, a path pattern like `/{shardname}/{containername}/{*remainingPath}` could be routed to an origin path of `/{containername}/{*remainingPath}` on the storage account, with `shardname` being used for logic or just part of the URL. If `ShardName` is empty, the path might be `/{containername}/{*remainingPath}`.
    *   The `FrontDoorHostname` in `appsettings.json` will be the endpoint hostname provided by Front Door (e.g., `evidence-something.z01.azurefd.net`).

### CORS Configuration

**1. For Azure Storage Account (Crucial for direct browser uploads):**
   This is required because the browser makes a `PUT` request directly to the Azure Storage (via Front Door) using the SAS URL.
   *   Go to your Azure Storage Account in the Azure portal.
   *   Under **Settings**, click **Resource sharing (CORS)**.
   *   For the **Blob service**:
        *   **Allowed origins**:
            *   For local development: `http://localhost:5173` (or your frontend's dev port)
            *   For deployed frontend: Your frontend's actual domain (e.g., `https://yourapp.azurestaticapps.net`)
        *   **Allowed methods**: `PUT`, `GET`, `HEAD`, `OPTIONS`
        *   **Allowed headers**: `*` (or be specific: `x-ms-blob-type`, `Content-Type`, etc.)
        *   **Exposed headers**: `*`
        *   **Max age (seconds)**: `3600` (or a suitable value)
   *   Click **Save**.

**2. For Backend API (AzureBlobUploadApi):**
   This is required so your React frontend can call your backend API endpoints. This is already configured in `Program.cs` to allow `http://localhost:5173`.
   ```csharp
   // In Program.cs
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
   // ...
   app.UseCors(MyAllowSpecificOrigins);


## Deployment

### Backend API to Azure App Service

1.  **Create an Azure App Service:**
    *   Choose a .NET runtime stack matching your project.
    *   Select an operating system (Linux or Windows).
2.  **Deployment Methods:**
    *   **Visual Studio:** Right-click project -> Publish.
    *   **Azure CLI:**
        ```bash
        # From AzureBlobUploadApi directory
        dotnet publish -c Release -o ./publish
        cd ./publish
        zip -r ../api.zip .
        az webapp deployment source config-zip --resource-group YOUR_RESOURCE_GROUP --name YOUR_APP_SERVICE_NAME --src ../api.zip
        ```
    *   **GitHub Actions / Azure DevOps:** Set up a CI/CD pipeline.
3.  **Configuration in Azure App Service:**
    *   Go to your App Service -> Configuration -> Application settings.
    *   Add application settings for all the values in your `StorageAccountsForSasUpload` section from `appsettings.json`. Use a colon `:` for nesting, e.g.:
        *   `StorageAccountsForSasUpload:0:FrontDoorHostname`
        *   `StorageAccountsForSasUpload:0:AccountName`
        *   `StorageAccountsForSasUpload:0:AccountKey` (Store this as a secret, ideally link to Key Vault)
        *   `StorageAccountsForSasUpload:0:ContainerName`
    *   Update the CORS settings in `Program.cs` or App Service CORS settings to allow your deployed frontend's origin.

### Frontend to Static Hosting (e.g., Azure Static Web Apps)

Azure Static Web Apps is an excellent choice for hosting React apps and can integrate with a backend API (either an Azure Function or a separate App Service).

1.  **Build the Frontend:**
    ```bash
    # From EvidenceUploadApp directory
    npm run build
    ```
    This will create a `dist` folder with your static production assets.
2.  **Deploy to Azure Static Web Apps:**
    *   Create an Azure Static Web App resource.
    *   You can connect it directly to your GitHub repository for CI/CD.
    *   **Build settings:**
        *   App location: `/` (if `package.json` is in the root of `EvidenceUploadApp`)
        *   Api location: (Leave blank if using a separate App Service for backend, or point to your Azure Functions folder if using that pattern)
        *   Output location: `dist`
    *   **Environment Variables:**
        *   In your Static Web App's Configuration, add an application setting for `VITE_BACKEND_API_BASE_URL` and set its value to your deployed backend API's URL.

## Troubleshooting

*   **CORS Errors:**
    *   "No 'Access-Control-Allow-Origin' header": Ensure CORS is configured correctly on **both** your Azure Storage Account (for direct uploads) and your backend API (for calls from frontend to backend).
    *   Check the browser's Network tab for `OPTIONS` (preflight) requests and their responses.
*   **Tailwind CSS Not Applying:**
    *   Ensure `tailwind.config.js` `content` paths are correct.
    *   Make sure `@import "tailwindcss";` (or `@tailwind base/components/utilities;`) is in your main CSS file (e.g., `src/App.css` or `src/index.css`).
    *   Ensure your main CSS file is imported into your React app's entry point (`main.tsx`).
    *   Restart the Vite dev server (`npm run dev`) after Tailwind config changes.
    *   Clear browser cache.
*   **Environment Variables Not Loaded (Frontend):**
    *   Vite requires environment variables to be prefixed with `VITE_`.
    *   Restart the Vite dev server after changing `.env` files.
*   **404 Errors from Backend:**
    *   Verify the `backendApiBaseUrl` in the frontend is correct.
    *   Check API routes in `FileUploadController.cs`.
*   **SAS Token Issues:**
    *   Ensure `AccountName` and `AccountKey` in the backend config are correct.
    *   Check SAS token permissions (`BlobSasPermissions` in `BlobStorageService.cs`).
    *   Verify SAS token expiry time.

