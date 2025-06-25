import './App.css'
import FileUploadForm from './FileUploadForm';
import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal, MsalAuthenticationTemplate } from "@azure/msal-react";
import { loginRequest } from "./authConfig";

function App() {
  const { instance, accounts } = useMsal();

  const handleLogin = () => {
    instance.loginPopup(loginRequest).catch(e => {
      console.error("Login failed: ", e);
    });
  };

  const handleLogout = () => {
    instance.logoutPopup({
      mainWindowRedirectUri: "/" // Redirect to home page after logout
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-between">
      <header className="bg-blue-700 text-white p-4 shadow-md">
        <div className="container mx-auto flex justify-between items-center">
          <div className="text-xl font-semibold">Evidence Upload Portal</div>
          <div>
            <AuthenticatedTemplate>
              <span className="mr-4">
                Welcome, {accounts[0]?.name || accounts[0]?.username}
              </span>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md transition duration-150 ease-in-out"
              >
                Logout
              </button>
            </AuthenticatedTemplate>
            <UnauthenticatedTemplate>
              <button
                onClick={handleLogin}
                className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md transition duration-150 ease-in-out"
              >
                Login
              </button>
            </UnauthenticatedTemplate>
          </div>
        </div>
      </header>

      {/* Use react-router-dom for routing */}
      <Routes>
        {/* Default route for the main application */}
        <Route path="/" element={
          <main className="flex-grow w-full py-8 px-4 sm:px-6 lg:px-8">
            <AuthenticatedTemplate>
              <FileUploadForm />
            </AuthenticatedTemplate>
            <UnauthenticatedTemplate>
              <div className="text-center p-10 bg-white rounded-xl shadow-md">
                <h2 className="text-2xl font-semibold mb-4 text-gray-700">Please log in to access the portal.</h2>
                <p className="text-gray-600">Use the login button in the header to continue.</p>
              </div>
            </UnauthenticatedTemplate>
          </main>
        } />

        {/* New route for direct folder access */}
        <Route path="/matter/:matterId/*" element={<MatterFolderRoute />} />
      </Routes>

      <main className="flex-grow w-full py-8 px-4 sm:px-6 lg:px-8"> {/* Removed max-w-4xl and mx-auto */}
        <AuthenticatedTemplate>
        </AuthenticatedTemplate>
        <UnauthenticatedTemplate>
          <div className="text-center p-10 bg-white rounded-xl shadow-md">
            <h2 className="text-2xl font-semibold mb-4 text-gray-700">Please log in to access the portal.</h2>
            <p className="text-gray-600">Use the login button in the header to continue.</p>
          </div>
        </UnauthenticatedTemplate>
      </main>

      <footer className="bg-gray-800 text-white p-4 text-center text-sm">
        © {new Date().getFullYear()} Evidence Upload App. All rights reserved.
      </footer>
    </div>
  );
}

// Component to extract URL parameters and pass them to FileUploadForm
import { Routes, Route, useParams } from 'react-router-dom';
import { InteractionType } from '@azure/msal-browser'; // Import InteractionType from msal-browser

const MatterFolderRoute = () => {
  const { matterId, '*': folderPath } = useParams(); // '*' captures all segments after :matterId
  // Ensure folderPath ends with a slash if it's not empty
  const formattedFolderPath = folderPath ? (folderPath.endsWith('/') ? folderPath : folderPath + '/') : '';

  return (
    <main className="flex-grow w-full py-8 px-4 sm:px-6 lg:px-8">
      {/* MsalAuthenticationTemplate ensures user is authenticated before rendering FileUploadForm. */}
      {/* Use InteractionType.Popup from msal-react for correct type assignment. */}
      <MsalAuthenticationTemplate interactionType={InteractionType.Popup} authenticationRequest={loginRequest}>
        <FileUploadForm initialContainerName={matterId} initialFolderPath={formattedFolderPath} />
      </MsalAuthenticationTemplate>
    </main>
  );
};

export default App;
