import { type Configuration, LogLevel } from "@azure/msal-browser";

// IMPORTANT: Replace these placeholders with your actual Azure AD App Registration details
const FRONTEND_APP_CLIENT_ID = "c1c02ec7-b99b-402c-87d5-5be79d1fa833"; // Client ID of your Frontend App Registration
const TENANT_ID = "31a47948-63be-48e4-905c-da01be0ac05b"; // Your Azure AD Tenant ID
// const API_APP_CLIENT_ID_URI = "api://YOUR_API_APP_CLIENT_ID_OR_URI"; // Application ID URI of your Backend API App Registration (if used)

// Config object to be passed to Msal on creation
export const msalConfig: Configuration = {
    auth: {
        clientId: FRONTEND_APP_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: "/", // Must match a redirect URI in your Frontend App Registration
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

// Add scopes here for access token to be used at your API endpoints if/when your API requires authorization.
// export const apiRequest = {
//     scopes: [`${API_APP_CLIENT_ID_URI}/Files.ReadWrite`] // Example: "api://<api_client_id>/Files.ReadWrite"
// };