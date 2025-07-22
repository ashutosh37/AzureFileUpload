import {
  useState,
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
} from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { apiRequest } from "./authConfig";
import type { DisplayItem, FileUploadFormProps } from "./interfaces";
import { useFileUpload } from "./hooks/useFileUpload";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { RefreshIcon } from "./icons"; // Import RefreshIcon
import { useFileListing } from "./hooks/useFileListing";
import * as apiService from "./services/apiService";
import { UploadPane } from "./components/UploadPane";
import { PropertiesPane } from "./components/PropertiesPane";
import { FileListing } from "./components/FileListing";
import { Pagination } from "./components/Pagination";
import { PdfRedactorDialog } from "./components/PdfRedactorDialog"; // Import the new component

interface Matter {
  id: string;
  name: string;
}

function FileUploadForm({
  initialContainerName,
  initialFolderPath,
}: FileUploadFormProps) {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [containerNameInput, setContainerNameInput] = useState(""); // Renamed to avoid confusion
  const [matters, setMatters] = useState<Matter[]>([]);
  const [isLoadingMatters, setIsLoadingMatters] = useState(false);
  const [rootFolders, setRootFolders] = useState<string[]>([]); // New state for root folders

  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for the file input element

  const [destinationPath, setDestinationPath] = useState<string>(""); // Path for the new upload

  const [isRedactionDialogOpen, setIsRedactionDialogOpen] = useState(false);
  const [selectedFileForRedaction, setSelectedFileForRedaction] =
    useState<DisplayItem | null>(null);
  const [pdfRedactionUrl, setPdfRedactionUrl] = useState<string | null>(null);

   const [isRedacting, setIsRedacting] = useState<boolean>(false); 


  // useEffect for acquiring an access token for the backend API
  useEffect(() => {
    if (accounts.length > 0) {
      const request = {
        ...apiRequest,
        account: accounts[0],
        // Explicitly provide the authority to prevent mismatch errors for guest users or different account types.
        authority: `https://login.microsoftonline.com/${
          import.meta.env.VITE_TENANT_ID
        }`,
      };

      instance
        .acquireTokenSilent(request)
        .then((response) => {
          setAccessToken(response.accessToken);
          console.log("Access Token (silent):", response.accessToken); // For debugging
        })
        .catch((error) => {
          // Fallback to interactive request if silent fails
          if (error instanceof InteractionRequiredAuthError) {
            instance
              .acquireTokenPopup(request)
              .then((response) => {
                setAccessToken(response.accessToken);
                console.log("Access Token (popup):", response.accessToken); // For debugging
              })
              .catch((e) => {
                console.error("Interactive token acquisition failed: ", e);
              });
          }
          console.error("Silent token acquisition failed: ", error);
        });
    }
  }, [accounts, instance]);

  // useEffect to fetch matters from the new API endpoint
  useEffect(() => {
    // Only fetch if we have a token, are authenticated, and are not on a pre-set matter route
    if (accessToken && isAuthenticated && !initialContainerName) {
      const fetchMatters = async () => {
        setIsLoadingMatters(true);
        try {
          // This fetch call assumes your apiService is not yet updated.
          // In a real scenario, this would be `apiService.getMatters(getAuthHeaders)`.
          const response = await fetch(
            `${import.meta.env.VITE_BACKEND_API_BASE_URL}/matters`,
            {
              headers: getAuthHeaders(),
            }
          );
          if (!response.ok)
            throw new Error(`Failed to fetch matters: ${response.statusText}`);
          const data: Matter[] = await response.json();
          setMatters(data);
        } catch (error) {
          console.error("Error fetching matters:", error);
          setUploadError("Could not load the list of matters.");
        } finally {
          setIsLoadingMatters(false);
        }
      };
      fetchMatters();
    }
  }, [accessToken, isAuthenticated, initialContainerName]);

  const getAuthHeaders = (isFormData: boolean = false) => {
    if (!accessToken) return {};
    const headers: HeadersInit = { Authorization: `Bearer ${accessToken}` };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  };

  const handleMatterSelectionChange = (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedMatterId = event.target.value;
    setContainerNameInput(selectedMatterId);
    if (selectedMatterId) {
      // Fetch root of the selected matter, showing only top-level folders.
      fetchAndSetItems(selectedMatterId, null, true);
      // Also, fetch the root folder names for the new dropdown.
      fetchRootFolderNames(selectedMatterId);
    }
  };

  const handleRootFolderSelectionChange = (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedFolderPath = event.target.value;
    // When a root folder is selected from the dropdown, fetch its contents.
    // An empty value means "go back to root of matter", where we list only folders.
    // A specific folder path means we want to see its contents (files and folders).
    fetchAndSetItems(
      containerNameInput,
      selectedFolderPath || null,
      !selectedFolderPath
    );
  };

  const fetchRootFolderNames = async (matterId: string) => {
    try {
      const { items } = await apiService.listFiles(
        matterId,
        getAuthHeaders,
        null,
        null,
        true
      );
      // Extract display names (folder names) from items and update the state
      console.log("Items:", items);
      const folderNames = items.map((item: any) => item.name);
      setRootFolders(folderNames);
      console.log("Root folder names:", folderNames);
      // If you want to set the destination path to the first root folder by default
      // you can uncomment the following line:
      // if (folderNames.length > 0) handleRootFolderSelectionChange({ target: { value: folderNames[0] } } as any);
    } catch (error) {
      console.error("Error fetching root folders:", error);
      setUploadError("Could not load root folders for the selected matter.");
      setRootFolders([]); // Clear folders on error
    }
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      setFilesToProcess(
        Array.from(files).map((f) => ({
          file: f,
          overwrite: false,
          status: "pending",
        }))
      );
      setUploadError("");
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (accounts.length === 0) return;

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setFilesToProcess(
        Array.from(files).map((f) => ({
          file: f,
          overwrite: false,
          status: "pending",
        }))
      );
      setUploadError("");
    }
  };

  // --- HOOK INTEGRATION ---
  // The useFileUpload hook must be called *before* useFileListing because
  // useFileListing depends on the setUploadError function from useFileUpload.
  const {
    filesToProcess,
    setFilesToProcess,
    uploadStatus,
    setUploadStatus,
    uploadError,
    setUploadError,
    startUpload,
  } = useFileUpload({ getAuthHeaders });

  const {
    displayedItems,
    currentPath,
    isLoadingFiles,
    displayedContainerForFiles,
    nextPageToken,
    prevPageTokens,
    sortColumn,
    sortDirection,
    selectedItem,
    selectedFiles,
    fetchAndSetItems,
    handleSort,
    //handleGoUp,
    handleBreadcrumbClick,
    handleNextPage,
    handlePreviousPage,
    setSelectedItem,
    handleCheckboxChange,
    handleSelectAll,
    handleBulkDelete,
  } = useFileListing({
    initialContainerName,
    initialFolderPath,
    accessToken,
    getAuthHeaders,
    setUploadStatus,
    setUploadError,
  });

  const currentMatterName =
    matters.find((m) => m.id === displayedContainerForFiles)?.name ||
    displayedContainerForFiles;

  const showContent = !!displayedContainerForFiles && !!currentPath;

  // Effect to set initial container name from props
  useEffect(() => {
    if (initialContainerName) {
      setContainerNameInput(initialContainerName);
    }
  }, [initialContainerName]);

  // Keep the destination path input in sync with the user's navigation in the file grid
  useEffect(() => {
    setDestinationPath(currentPath);
  }, [currentPath]);

  // Pass these to PropertiesPane for refreshing data
  const refreshFilesAndSelection = () =>
    fetchAndSetItems(displayedContainerForFiles);

  const handleRefresh = () => {
    fetchAndSetItems(displayedContainerForFiles, currentPath, false);
  };

  const isRedactDisabled = (() => {
    if (selectedFiles.length !== 1) {
      return true;
    }
    const selectedItem = displayedItems.find(
      (item) => item.fullPath === selectedFiles[0]
    );
    if (!selectedItem || selectedItem.isFolder) {
      return true;
    }
    return !selectedItem.displayName.toLowerCase().endsWith(".pdf");
  })();

  const handleRedactClick = async () => {
    if (isRedactDisabled) return;

    const selectedFile = displayedItems.find(
      (item) => item.fullPath === selectedFiles[0]
    );

    if (!selectedFile || !displayedContainerForFiles || !accessToken) {
      setUploadError(
        "Cannot redact: file, container, or access token missing."
      );
      return;
    }

    try {
      setUploadStatus(
        `Generating secure URL for ${selectedFile.displayName}...`
      );
      setUploadError("");
      const sasData = await apiService.generateReadSAS(
        displayedContainerForFiles,
        selectedFile.fullPath,
        getAuthHeaders
      );
      setPdfRedactionUrl(sasData.fullDownloadUrl);
      setSelectedFileForRedaction(selectedFile);
      setIsRedactionDialogOpen(true);
    } catch (error) {
      console.error("Error generating SAS URL for redaction:", error);
      setUploadError(
        error instanceof Error
          ? `Error preparing for redaction: ${error.message}`
          : "An unknown error occurred while preparing for redaction."
      );
      setUploadStatus(""); // Clear status on error
    }
  };

  const handleCloseRedactionDialog = () => {
    setIsRedactionDialogOpen(false);
    setSelectedFileForRedaction(null);
    // Optionally refresh the file list if a redaction was saved
    fetchAndSetItems(displayedContainerForFiles, currentPath, false);
  };

  const handleSaveRedaction = async (redactionCoordinates: any[]) => {
    if (
      !selectedFileForRedaction ||
      !displayedContainerForFiles ||
      !accessToken
    ) {
      setUploadError(
        "Cannot save redaction: file, container, or access token missing."
      );
      return;
    }

    try {
      setUploadStatus(
        `Applying redactions to ${selectedFileForRedaction.displayName}...`
      );
      setIsRedacting(true); 
      setUploadError("");
      
      // Call the backend API to apply redactions with coordinates
      await apiService.redactPdf(
        displayedContainerForFiles,
        selectedFileForRedaction.fullPath,
        redactionCoordinates,
        getAuthHeaders // Pass the function itself
      );

      setUploadStatus(
        `"${selectedFileForRedaction.displayName}" redacted successfully.`
      );
      handleCloseRedactionDialog(); // Close dialog and refresh list
    } catch (error) {
      console.error("Error applying redactions:", error);
      setUploadError(
        error instanceof Error
          ? `Error applying redactions: ${error.message}`
          : "An unknown error occurred during redaction application."
      );
    } finally {
      setTimeout(() => setUploadStatus(""), 3000);
      setIsRedacting(false); 
    }
  };

  const isProcessDisabled = (() => {
    if (selectedFiles.length === 0) {
      return true;
    }
    // The button is disabled if any of the selected files is a PDF.
    // It is enabled if at least one file is selected and NONE of them are PDFs.
    return selectedFiles.some((filePath) => {
      const selectedItem = displayedItems.find(
        (item) => item.fullPath === filePath
      );
      // We shouldn't have folders in selectedFiles, but as a safeguard...
      if (!selectedItem || selectedItem.isFolder) {
        return false; // Folders are not PDFs
      }
      return selectedItem.displayName.toLowerCase().endsWith(".pdf");
    });
  })();

  const handleProcessClick = () => {
    if (isProcessDisabled) return;
    // Placeholder for actual processing logic
    alert(`Process action for: ${selectedFiles.join(", ")}`);
  };

  const isSendToSharePointDisabled = (() => {
    // Disabled if no files are selected.
    return selectedFiles.length === 0;
  })();

  const handleSendToSharePointClick = () => {
    if (isSendToSharePointDisabled) return;
    // Placeholder for actual "Send to SharePoint" logic
    alert(`Send to SharePoint action for: ${selectedFiles.join(", ")}`);
  };

  const handleUpload = async () => {
    if (!containerNameInput) {
      setUploadError("Please enter a container name.");
      return;
    }
    if (accounts.length === 0) {
      setUploadError("Not logged in. Please log in to upload files.");
      return;
    }
    // Add a guard to ensure the access token is available before making the API call.
    if (!accessToken) {
      setUploadError(
        "Authentication token is not yet available. Please wait a moment and try again."
      );
      console.warn("handleUpload called before accessToken was ready.");
      return;
    }

    // The useFileUpload hook now handles the entire upload process.
    await startUpload(containerNameInput, destinationPath, () =>
      fetchAndSetItems(displayedContainerForFiles, currentPath, false)
    );

    // Clear the file input ref after the upload process is complete
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleItemAction = async (item: DisplayItem) => {
    if (item.isFolder) {
      // Navigate into the folder by fetching its contents. This will also update the current path.
      fetchAndSetItems(displayedContainerForFiles, item.fullPath, false);
    } else {
      // It's a file, open it
      console.log("Clicked file:", item.fullPath);
      // Fetch a read SAS URL for the blob and open it
      if (!displayedContainerForFiles) {
        setUploadError("Container context is missing. Cannot open the file.");
        return;
      }
      // Add a guard to ensure the access token is available before making the API call.
      if (!accessToken) {
        setUploadError(
          "Authentication token is not yet available. Please wait a moment and try again."
        );
        console.warn("handleItemAction called before accessToken was ready.");
        return;
      }
      try {
        setUploadStatus(`Fetching URL for ${item.displayName}...`); // Temporary status
        setUploadError("");
        const sasData = await apiService.generateReadSAS(
          displayedContainerForFiles,
          item.fullPath,
          getAuthHeaders
        );
        window.open(sasData.fullDownloadUrl, "_blank"); // Open in a new tab
        setUploadStatus(""); // Clear status
      } catch (error) {
        console.error("Error fetching download URL:", error);
        setUploadError(
          error instanceof Error
            ? `Error opening file: ${error.message}`
            : "Could not open file."
        );
        setUploadStatus(""); // Clear status
      }
    }
  };

  const handleDeleteClick = async (
    item: DisplayItem,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent the row's onClick from firing

    if (
      !window.confirm(
        `Are you sure you want to delete "${item.displayName}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    if (!displayedContainerForFiles) {
      setUploadError("Container context is missing. Cannot delete file.");
      return;
    }
    // Add a guard to ensure the access token is available before making the API call.
    if (!accessToken) {
      setUploadError(
        "Authentication token is not yet available. Please wait a moment and try again."
      );
      console.warn("handleDeleteClick called before accessToken was ready.");
      return;
    }

    try {
      setUploadStatus(`Deleting ${item.displayName}...`);
      setUploadError("");

      const response = await apiService.deleteFile(
        displayedContainerForFiles,
        item.fullPath,
        getAuthHeaders
      );
      if (!response.ok)
        throw new Error(`Failed to delete file: ${response.statusText}`);
      setUploadStatus(`"${item.displayName}" was deleted successfully.`);
      fetchAndSetItems(displayedContainerForFiles); // Refresh the file list
    } catch (error) {
      console.error("Error deleting file:", error);
      setUploadError(
        error instanceof Error
          ? `Error deleting file: ${error.message}`
          : "Could not delete file."
      );
      setUploadStatus("");
    }
  };

  return (
    // Parent flex container: stacks vertically on small screens, horizontally on large screens
    <div className="flex flex-col gap-2 w-full">
      {/* Container Selection Panel */}
      {!initialContainerName && (
        <div className="bg-white p-6 shadow-2xl flex space-x-4">
          {/* Matter Selection */}
          <div className="relative flex-grow">
            <select
              id="matter-select"
              value={containerNameInput}
              onChange={handleMatterSelectionChange}
              disabled={
                isLoadingMatters || accounts.length === 0 || !accessToken
              }
              className="shadow-sm appearance-none border border-gray-300 w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-200 disabled:cursor-not-allowed"
            >
              <option value="">
                {isLoadingMatters ? "Loading matters..." : "Select a matter"}
              </option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
              <svg
                className="fill-current h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
              >
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
              </svg>
            </div>

            {isRedactionDialogOpen && (
              <PdfRedactorDialog
                isOpen={isRedactionDialogOpen}
                onClose={handleCloseRedactionDialog}
                onSave={handleSaveRedaction}
                pdfFile={selectedFileForRedaction}
                pdfUrl={pdfRedactionUrl}
                isSaving={isRedacting}  // Pass the loading state to the dialog
        />
            )}
          </div>

          {/* Root Folder Selection (Conditional rendering) */}
          {containerNameInput && rootFolders.length > 0 && (
            <div className="relative flex-grow">
              <select
                id="root-folder-select"
                onChange={handleRootFolderSelectionChange}
                className="shadow-sm appearance-none border border-gray-300 w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a Container</option>
                {rootFolders.map((folderName) => (
                  <option key={folderName} value={folderName}>
                    {folderName.slice(0, -1)}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                <svg
                  className="fill-current h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Upload Pane - now sits between container selection and file list */}
      {showContent && (
        <UploadPane
          destinationPath={destinationPath}
          onDestinationPathChange={(e) => setDestinationPath(e.target.value)}
          accounts={accounts}
          accessToken={accessToken}
          initialFolderPath={initialFolderPath}
          onFileChange={handleFileChange}
          onDrop={handleDrop}
          filesToProcess={filesToProcess}
          fileInputRef={fileInputRef}
          onUpload={handleUpload}
          uploadStatus={uploadStatus}
          uploadError={uploadError}
          isContainerSelected={!!displayedContainerForFiles}
        />
      )}
      {/* Main Content Area: File List & Properties */}
      {showContent && (
        <div className="flex flex-col lg:flex-row">
          {/* Left Panel: File List */}
          <div className="flex-grow bg-white p-8 shadow-2xl flex flex-col min-w-0">
            <div className="flex justify-between items-center mb-4 min-h-[28px]">
              {" "}
              {/* Adjusted min-h */}
              <div className="flex items-center text-sm text-gray-600 flex-grow truncate">
                {displayedContainerForFiles ? (
                  <div className="flex items-center flex-shrink-0">
                    {initialContainerName ? (
                      <span className="flex items-center text-gray-700">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 mr-1.5"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                        </svg>
                        <span className="font-medium">
                          {displayedContainerForFiles}
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center text-gray-700">
                        <span className="font-medium">
                          {displayedContainerForFiles}
                        </span>
                      </span>
                    )}
                    <Breadcrumbs
                      currentPath={currentPath}
                      handleBreadcrumbClick={handleBreadcrumbClick}
                    />
                    <button
                      onClick={handleRefresh}
                      className="flex items-center p-2 focus:outline-none"
                      title="Refresh Files"
                    >
                      <RefreshIcon />
                    </button>
                  </div>
                ) : (
                  <h3 className="text-xl font-semibold text-gray-700">
                    Files in Container
                  </h3>
                )}
              </div>
              {/* Action Bar: Create Folder and Bulk Delete - Moved to top right */}
              {displayedContainerForFiles && (
                <div className="flex items-center space-x-2 ml-auto flex-wrap justify-end">
                  <button
                    onClick={handleBulkDelete}
                    disabled={selectedFiles.length === 0}
                    className={`px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-md hover:bg-red-700 ${
                      selectedFiles.length === 0
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                  >
                    Delete Selected ({selectedFiles.length})
                  </button>
                  <button
                    onClick={handleRedactClick}
                    disabled={isRedactDisabled}
                    className={`px-4 py-2 text-sm font-bold text-white bg-purple-600 rounded-md hover:bg-purple-700 ${
                      isRedactDisabled ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    title={
                      isRedactDisabled
                        ? "Select a single PDF file to redact"
                        : "Redact selected PDF"
                    }
                  >
                    Redact PDF
                  </button>
                  <button
                    onClick={handleProcessClick}
                    disabled={isProcessDisabled}
                    className={`px-4 py-2 text-sm font-bold text-white bg-green-600 rounded-md hover:bg-green-700 ${
                      isProcessDisabled ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    title={
                      isProcessDisabled
                        ? "Select one or more non-PDF files to process"
                        : "Process selected documents"
                    }
                  >
                    Convert to PDF
                  </button>
                  <button
                    onClick={handleSendToSharePointClick}
                    disabled={isSendToSharePointDisabled}
                    className={`px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 ${
                      isSendToSharePointDisabled
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                    title={
                      isSendToSharePointDisabled
                        ? "Select one or more files to send"
                        : "Send selected files to SharePoint"
                    }
                  >
                    Send To SharePoint
                  </button>
                </div>
              )}
            </div>

            {isLoadingFiles ? (
              <div className="flex-grow flex justify-center items-center">
                <svg
                  className="animate-spin h-8 w-8 text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <p className="ml-2 text-gray-600">Loading...</p>
              </div>
            ) : displayedContainerForFiles ? (
              currentPath ? (
                <FileListing
                  displayedItems={displayedItems}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  handleSort={handleSort}
                  selectedItem={selectedItem}
                  setSelectedItem={setSelectedItem}
                  handleItemAction={handleItemAction}
                  handleDeleteClick={handleDeleteClick}
                  selectedFiles={selectedFiles}
                  handleCheckboxChange={handleCheckboxChange}
                  handleSelectAll={handleSelectAll}
                />
              ) : (
                <div className="flex-grow flex justify-center items-center">
                  <p className="text-gray-600">
                    No items found in '{currentMatterName}
                    {currentPath ? `/${currentPath}` : ""}'.
                  </p>
                </div>
              )
            ) : (
              <div className="flex-grow flex justify-center items-center">
                <p className="text-gray-600">
                  Enter a container name and click "View/Refresh Files" to list
                  files.
                </p>
              </div>
            )}
            {/* Pagination Controls */}
            <Pagination
              displayedContainerForFiles={displayedContainerForFiles}
              displayedItemsCount={displayedItems.length}
              prevPageTokens={prevPageTokens}
              nextPageToken={nextPageToken}
              isLoadingFiles={isLoadingFiles}
              handlePreviousPage={handlePreviousPage}
              handleNextPage={handleNextPage}
            />
          </div>

          {/* Right Panel: Properties */}
          <div className="lg:w-[32rem] flex-shrink-0">
            {displayedContainerForFiles && (
              <PropertiesPane
                item={selectedItem}
                containerName={displayedContainerForFiles}
                onRefresh={refreshFilesAndSelection}
                accessToken={accessToken}
                getAuthHeaders={getAuthHeaders}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUploadForm;
