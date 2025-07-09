import { type Configuration, LogLevel } from "@azure/msal-browser";

// IMPORTANT: Replace these placeholders with your actual Azure AD App Registration details
const FRONTEND_APP_CLIENT_ID = import.meta.env.VITE_FRONTEND_APP_CLIENT_ID; // Client ID of your Frontend App Registration
const TENANT_ID = import.meta.env.VITE_TENANT_ID; // Your Azure AD Tenant ID
const API_APP_CLIENT_ID_URI = import.meta.env.VITE_API_APP_CLIENT_ID_URI; // Application ID URI of your Backend API App Registration (if used)

// Config object to be passed to Msal on creation
export const msalConfig: Configuration = {
    auth: {
        clientId: FRONTEND_APP_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: "http://localhost:5173/", // Must match a redirect URI in your Frontend App Registration
        knownAuthorities: [`https://login.microsoftonline.com/${TENANT_ID}`],
        postLogoutRedirectUri: "/", // Optional: Where to redirect after logout
    },
    cache: {
        cacheLocation: "sessionStorage", // This configures where your cache will be stored
        storeAuthStateInCookie: false, // Set to true if you are having issues on IE11 or Edge
    },
    system: {
        loggerOptions: {
            loggerCallback: (_level, _message, containsPii) => {
                if (containsPii) {
                    return;
                }
                // console.debug(_message); // Uncomment for detailed MSAL logs. You can also use _level.
            },
            logLevel: LogLevel.Verbose, // Set to Warning or Error in production
            piiLoggingEnabled: false
        }
    }
};

// Add scopes here for ID token to be used at Microsoft identity platform endpoints.
export const loginRequest = {
    scopes: ["User.Read"] // Basic scope to read user profile
};

//Add scopes here for access token to be used at your API endpoints if/when your API requires authorization.
export const apiRequest = {
    scopes: [`api://${API_APP_CLIENT_ID_URI}/Files.ReadWrite`] // Example: ["api://3ebf717c-3423-4576-8aa8-3d9d03130ff0/Files.ReadWrite"] // Example: "api://<api_client_id>/Files.ReadWrite"
};