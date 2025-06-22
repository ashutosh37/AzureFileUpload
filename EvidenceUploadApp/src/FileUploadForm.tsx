import { useState, type ChangeEvent, type DragEvent, useEffect } from 'react';
import { useMsal } from "@azure/msal-react";
import { FolderIcon, FileIcon, WordIcon, ExcelIcon, PdfIcon, ImageIcon, EmailIcon, DeleteIcon } from './icons'; // Import all icons
// import { apiRequest } from "./authConfig"; // API request config removed as backend doesn't require auth yet

interface SasUploadInfo {
  blobUri: string;
  sharedAccessSignature: string;
  fullUploadUrl: string;
}

// This interface represents the data structure coming from the backend
interface BackendFileInfo {
  name: string;
  checksum: string; // Assuming checksum is a string, adjust if needed
  metadata?: Record<string, string>; // If your backend sends metadata
}

// This interface represents items displayed in the grid (can be a folder or a file)
interface DisplayItem {
  id: string; // Unique key for React, typically the full path
  displayName: string; // Name to show in the grid, e.g., "MyFolder" or "MyFile.txt"
  fullPath: string; // Full path from container root. For folders, it's the prefix.
  isFolder: boolean;
  checksum: string; // Checksum for files, "N/A" or empty for folders
  metadata?: Record<string, string>;
}

function FileUploadForm() {
  const { accounts } = useMsal();
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [containerNameInput, setContainerNameInput] = useState(''); // Renamed to avoid confusion
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  
  // State for file listing and navigation
  const [rawBlobList, setRawBlobList] = useState<BackendFileInfo[]>([]); // Full flat list from backend for the current container
  const [displayedItems, setDisplayedItems] = useState<DisplayItem[]>([]); // Processed items for the current view
  const [currentPath, setCurrentPath] = useState<string>(''); // Current virtual path, e.g., "folderA/subfolderB/"
  const [sortColumn, setSortColumn] = useState<string>('displayName'); // Default sort by displayName
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc'); // Default ascending
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [prevPageTokens, setPrevPageTokens] = useState<(string | null)[]>([]); // Stack of tokens for previous pages

  const [destinationPath, setDestinationPath] = useState<string>(''); // Path for the new upload
  const [lastClickedFileIndex, setLastClickedFileIndex] = useState<number | null>(null); // For shift-select
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]); // Store paths of selected files for bulk operations
  const [selectedItem, setSelectedItem] = useState<DisplayItem | null>(null);
  
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [displayedContainerForFiles, setDisplayedContainerForFiles] = useState<string>('');
  const [isUploadFormCollapsed, setIsUploadFormCollapsed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Pass these to PropertiesPane for refreshing data
  const refreshFilesAndSelection = () => fetchAndSetRawFiles(displayedContainerForFiles);

  // Access the environment variable
  const backendApiBaseUrl = import.meta.env.VITE_BACKEND_API_BASE_URL || 'http://localhost:5230/api/files'; // Fallback for safety

  // useEffect for acquiring API-specific token removed as backend doesn't require auth yet.
  // If API auth is added later, this logic (using apiRequest) would be reinstated.

  const getAuthHeaders = (isFormData: boolean = false) => {
    // Authorization header removed as backend doesn't require auth yet.
    // if (!accessToken) return {}; // No longer checking for API-specific token
    const headers: HeadersInit = {}; // { 'Authorization': `Bearer ${accessToken}` };
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      setUploadStatus('');
      setFilesToUpload(Array.from(files));
      setUploadError('');
    }
  };

  const handleContainerNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setContainerNameInput(event.target.value);
    setUploadStatus('');
    setUploadError('');
    // When container name input changes, we don't immediately clear/fetch. Fetching is tied to the button.
    // setFilesInContainer([]); 
    // setDisplayedContainerForFiles('');
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (accounts.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (accounts.length === 0) return;

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setUploadStatus('');
      setFilesToUpload(Array.from(files));
      setUploadError('');
    }
  };

  // Effect to process rawBlobList into displayedItems when rawBlobList or currentPath changes
  useEffect(() => {
    if (!rawBlobList.length && currentPath !== '') {
      // If we have a path but no raw data (e.g. page reload with path in state, but no container selected yet)
      // Potentially clear displayed items or handle as needed. For now, this is okay.
    }

    const itemsMap = new Map<string, DisplayItem>();

    rawBlobList.forEach(blob => {
      if (blob.name.startsWith(currentPath)) {
        const relativePath = blob.name.substring(currentPath.length);
        const segments = relativePath.split('/');
        const firstSegment = segments[0];

        if (segments.length > 1) { // This implies a folder at the current level
          const folderFullPath = currentPath + firstSegment;
          if (!itemsMap.has(folderFullPath)) {
            itemsMap.set(folderFullPath, {
              id: folderFullPath,
              displayName: firstSegment,
              fullPath: folderFullPath,
              isFolder: true,
              checksum: "N/A",
            });
          }
        } else { // This is a file at the current level
          // Ensure we don't add a file if a folder with the same name (as firstSegment) already exists
          // This scenario is unlikely with typical naming but good to be mindful of.
          // For simplicity, we assume distinct names for files and folders at the same level.
          itemsMap.set(blob.name, {
            id: blob.name,
            displayName: firstSegment, // which is the file name
            fullPath: blob.name,
            isFolder: false,
            checksum: blob.checksum,            
            metadata: blob.metadata,
          });
        }
      }
    });

    const getSortValue = (item: DisplayItem, column: string): string => {
        if (item.isFolder) return ''; // Folders don't have these values, sort them first anyway
        if (column === 'DocumentId') {
            // Metadata keys are often lowercased by Azure SDKs when retrieved, so check common cases.
            return item.metadata?.documentid || item.metadata?.DocumentId || '';
        }
        const value = (item as any)[column];
        return typeof value === 'string' ? value : '';
    };

    let sortedItems = Array.from(itemsMap.values()).sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }

      const aValue = getSortValue(a, sortColumn);
      const bValue = getSortValue(b, sortColumn);

      return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    });

    setDisplayedItems(sortedItems);
  }, [rawBlobList, currentPath, sortColumn, sortDirection]);

  // Keep the destination path input in sync with the user's navigation in the file grid
  useEffect(() => {
    setDestinationPath(currentPath);
  }, [currentPath]);


  const fetchAndSetRawFiles = async (containerToFetch: string) => {
    if (!containerToFetch) {
      setUploadError("Container name is required to fetch files.");
      return;
    }
    // Auth check should ideally be done before calling this, or use isEffectivelyAuthenticated
    if (accounts.length === 0) { 
      setUploadError("Not logged in. Please log in to fetch files.");
      return;
    }
    setIsLoadingFiles(true);
    setUploadError(''); // Clear previous errors
    // When fetching for a new container, reset path and raw list
    if (displayedContainerForFiles !== containerToFetch) {
      setCurrentPath('');
      setRawBlobList([]);
      setDisplayedItems([]);
      setSelectedItem(null);
      setPrevPageTokens([]); // Reset pagination history
      setNextPageToken(null); // Reset pagination tokens
      setDestinationPath(''); // Reset destination path on container change
      setLastClickedFileIndex(null); // Clear last clicked index on container change
      setSelectedFiles([]); // Clear selection when container changes
      setSortColumn('displayName'); // Reset sort column
      setSortDirection('asc'); // Reset sort direction
    }

    try {
      const response = await fetch(`${backendApiBaseUrl}/list?targetContainerName=${encodeURIComponent(containerToFetch)}`, { // This is the initial fetch
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list files for '${containerToFetch}': ${response.status} - ${errorText || response.statusText}`);
      }
      const data: { items: BackendFileInfo[]; nextContinuationToken: string | null } = await response.json();
      setRawBlobList(data.items);
      setNextPageToken(data.nextContinuationToken);
      setPrevPageTokens([null]); // Start of history for page 1
      setDisplayedContainerForFiles(containerToFetch);
    } catch (error) {
      setRawBlobList([]); // Clear raw list on error
      setDisplayedItems([]); // Clear displayed items
      setNextPageToken(null);
      setUploadError(error instanceof Error ? `Error fetching files: ${error.message}` : 'An unknown error occurred while fetching files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const goToPage = async (token: string | null) => {
    if (!displayedContainerForFiles) return;

    setIsLoadingFiles(true);
    setUploadError('');
    setSelectedItem(null);
    setSelectedFiles([]);

    try {
      let url = `${backendApiBaseUrl}/list?targetContainerName=${encodeURIComponent(displayedContainerForFiles)}`;
      if (token) {
        url += `&continuationToken=${encodeURIComponent(token)}`;
      }

      const response = await fetch(url, {
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list files: ${response.status} - ${errorText || response.statusText}`);
      }
      const data: { items: BackendFileInfo[]; nextContinuationToken: string | null } = await response.json();

      setRawBlobList(data.items);
      setNextPageToken(data.nextContinuationToken);
    } catch (error) {
      setRawBlobList([]);
      setDisplayedItems([]);
      setNextPageToken(null);
      setUploadError(error instanceof Error ? `Error fetching files: ${error.message}` : 'An unknown error occurred while fetching files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleNextPage = () => {
    if (nextPageToken) {
      goToPage(nextPageToken);
      setPrevPageTokens(prev => [...prev, nextPageToken]);
    }
  };

  const handlePreviousPage = () => {
    if (prevPageTokens.length > 1) {
      const newPrevPageTokens = prevPageTokens.slice(0, -1);
      const tokenForPrevPage = newPrevPageTokens[newPrevPageTokens.length - 1];
      goToPage(tokenForPrevPage);
      setPrevPageTokens(newPrevPageTokens);
    }
  };


  const handleUpload = async () => {
    if (filesToUpload.length === 0) {
      setUploadError('Please select one or more files to upload.');
      return;
    }
    if (!containerNameInput) {
      setUploadError('Please enter a container name.');
      return;
    }
    if (accounts.length === 0) {
      setUploadError("Not logged in. Please log in to upload files.");
      return;
    }

    setUploadStatus('Generating upload URL...');
    setUploadError('');

    try {
      // Step 1: Get the container SAS URL from the backend API (this part remains the same)
      const generateUrl = `${backendApiBaseUrl}/generate-upload-urls?targetContainerName=${encodeURIComponent(containerNameInput)}`;
      const generateResponse = await fetch(generateUrl, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (!generateResponse.ok) {
        const errorDetails = await generateResponse.text();
        throw new Error(`Failed to get upload URL: ${generateResponse.status} ${generateResponse.statusText} - ${errorDetails}`);
      }

      const sasInfoArray: SasUploadInfo[] = await generateResponse.json();

      if (!sasInfoArray || sasInfoArray.length === 0) {
         throw new Error('Backend did not return any upload URLs.');
      }

      // We'll use the first URL provided by the backend
      const containerSasDetails = sasInfoArray[0];
      
      const totalFiles = filesToUpload.length;
      for (let i = 0; i < totalFiles; i++) {
        const fileToUpload = filesToUpload[i];
        const progress = `(${i + 1}/${totalFiles})`;

        // Determine the blob name for upload
        const finalPath = destinationPath.trim() === '' ? '' : (destinationPath.trim().endsWith('/') ? destinationPath.trim() : destinationPath.trim() + '/');
        const blobNameForUpload = finalPath + fileToUpload.name;

        setUploadStatus(`Uploading ${progress}: "${blobNameForUpload}"...`);

        // Step 2: Call the backend's /upload-via-sas endpoint for each file
        const formData = new FormData();
        formData.append('containerSasUrl', containerSasDetails.fullUploadUrl);
        formData.append('file', fileToUpload, blobNameForUpload); 

        const uploadViaSasUrl = `${backendApiBaseUrl}/upload-via-sas`;
        const uploadResponse = await fetch(uploadViaSasUrl, {
          method: 'POST',
          body: formData,
          headers: getAuthHeaders(true)
        });

        if (!uploadResponse.ok) {
           if (uploadResponse.status === 409) {
              const errorBody = await uploadResponse.json();
              throw new Error(errorBody.message || `File "${fileToUpload.name}" already exists. Upload stopped.`);
           }
           const errorDetails = await uploadResponse.text();
           throw new Error(`Upload failed for "${fileToUpload.name}": ${uploadResponse.status} ${uploadResponse.statusText} - ${errorDetails}. Upload stopped.`);
         }
      }

      setUploadStatus(`${totalFiles} file(s) uploaded successfully!`);
      setFilesToUpload([]); // Clear selected files after successful upload
      fetchAndSetRawFiles(containerNameInput); // Refresh file list for the current container
    } catch (error) {
      console.error('Upload error:', error);
      if (error instanceof Error) {
        setUploadError(
          error instanceof TypeError && error.message === 'Failed to fetch'
            ? 'Upload failed: Could not connect to the server. Please check your network connection or server status (CORS issue likely).'
            : `Upload failed: ${error.message}`
        );
      } else {
        setUploadError('An unknown error occurred during upload.');
      }
      setUploadStatus('');
    }
  };

  const handleItemAction = async (item: DisplayItem) => {
    if (item.isFolder) {
      setCurrentPath(item.fullPath + '/'); // Append slash to denote it's a path prefix
      setSelectedItem(null); // Clear selection when navigating
    } else { // It's a file, open it
      console.log("Clicked file:", item.fullPath);
      // Fetch a read SAS URL for the blob and open it
      if (!displayedContainerForFiles) {
        setUploadError("Container context is missing. Cannot open file.");
        return;
      }
      try {
        setUploadStatus(`Fetching URL for ${item.displayName}...`); // Temporary status
        setUploadError('');
        const response = await fetch(`${backendApiBaseUrl}/generate-read-sas?targetContainerName=${encodeURIComponent(displayedContainerForFiles)}&blobName=${encodeURIComponent(item.fullPath)}`, {
          headers: getAuthHeaders() // Add auth headers if your backend requires them for this endpoint
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to get download URL: ${response.status} - ${errorText || response.statusText}`);
        }
        const data: { fullDownloadUrl: string } = await response.json();
        window.open(data.fullDownloadUrl, '_blank'); // Open in a new tab
        setUploadStatus(''); // Clear status
      } catch (error) {
        console.error("Error fetching download URL:", error);
        setUploadError(error instanceof Error ? `Error opening file: ${error.message}` : 'Could not open file.');
        setUploadStatus(''); // Clear status
      }
    }
  };

  const handleDeleteClick = async (item: DisplayItem, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent the row's onClick from firing

    if (!window.confirm(`Are you sure you want to delete "${item.displayName}"? This action cannot be undone.`)) {
        return;
    }

    if (!displayedContainerForFiles) {
        setUploadError("Container context is missing. Cannot delete file.");
        return;
    }

    try {
        setUploadStatus(`Deleting ${item.displayName}...`);
        setUploadError('');

        const response = await fetch(`${backendApiBaseUrl}?targetContainerName=${encodeURIComponent(displayedContainerForFiles)}&blobName=${encodeURIComponent(item.fullPath)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete file: ${response.status} - ${errorText || response.statusText}`);
        }

        setUploadStatus(`"${item.displayName}" was deleted successfully.`);
        fetchAndSetRawFiles(displayedContainerForFiles); // Refresh the file list
    } catch (error) {
        console.error("Error deleting file:", error);
        setUploadError(error instanceof Error ? `Error deleting file: ${error.message}` : 'Could not delete file.');
        setUploadStatus('');
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // If same column is clicked, toggle direction
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      // If new column is clicked, set it and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleGoUp = () => {
    if (currentPath === '') return;
    const pathSegments = currentPath.slice(0, -1).split('/'); // Remove trailing slash, then split
    pathSegments.pop(); // Remove current folder
    setCurrentPath(pathSegments.length > 0 ? pathSegments.join('/') + '/' : '');
    setSelectedItem(null);
  }

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension) return <FileIcon />;

    switch (extension) {
      case 'doc':
      case 'docx':
        return <WordIcon />;
      case 'xls':
      case 'xlsx':
        return <ExcelIcon />;
      case 'pdf':
        return <PdfIcon />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'bmp':
      case 'svg':
        return <ImageIcon />;
      case 'eml':
      case 'msg':
        return <EmailIcon />;
      default:
        return <FileIcon />;
    }
  };

  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>, clickedItem: DisplayItem, currentIndex: number) => {
    const { checked } = event.target;
    const clickedFilePath = clickedItem.fullPath;

    if ((event.nativeEvent as MouseEvent).shiftKey && lastClickedFileIndex !== null) {
      // Shift key is pressed, perform range selection
      const start = Math.min(lastClickedFileIndex, currentIndex);
      const end = Math.max(lastClickedFileIndex, currentIndex);

      const filesInCurrentView = displayedItems.filter(item => !item.isFolder);
      const pathsToToggle = filesInCurrentView.slice(start, end + 1).map(item => item.fullPath);

      setSelectedFiles(prevSelected => {
        let newSelected = new Set(prevSelected);
        if (checked) {
          pathsToToggle.forEach(path => newSelected.add(path));
        } else {
          pathsToToggle.forEach(path => newSelected.delete(path));
        }
        return Array.from(newSelected);
      });
    } else {
      // Normal single selection
      setSelectedFiles(prevSelected => {
        if (checked) {
          // Add the clicked file if it's not already there
          return [...prevSelected, clickedFilePath];
        } else {
          // Remove the clicked file
          return prevSelected.filter(path => path !== clickedFilePath);
        }
      });
      // Update lastClickedFileIndex for future shift-select operations
      setLastClickedFileIndex(currentIndex);
    }
  };





  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.target;
    const allFilePaths = displayedItems
        .filter(item => !item.isFolder)
        .map(item => item.fullPath);

    setSelectedFiles(checked ? allFilePaths : []);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) {
      setUploadError("Please select files to delete.");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete the selected ${selectedFiles.length} files? This action cannot be undone.`)) {
      return;
    }

    if (!displayedContainerForFiles) {
      setUploadError("Container context is missing. Cannot delete files.");
      return;
    }

    try {
      setUploadStatus(`Deleting ${selectedFiles.length} files...`);
      setUploadError('');

      // Create an array of promises for each delete operation
      const deletePromises = selectedFiles.map(blobName =>
          fetch(`${backendApiBaseUrl}?targetContainerName=${encodeURIComponent(displayedContainerForFiles)}&blobName=${encodeURIComponent(blobName)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
          })
      );

      // Use Promise.all to execute all delete operations concurrently
      const responses = await Promise.all(deletePromises);

      // Check if all requests were successful
      const allSuccessful = responses.every(response => response.ok);

      if (allSuccessful) {
        setUploadStatus(`${selectedFiles.length} files were deleted successfully.`);
      } else {
        // Handle partial failures or log more specific error info if needed
        const errorDetails = await Promise.all(responses.filter(response => !response.ok).map(async response => await response.text()));
        console.error("Some files failed to delete:", errorDetails);
        setUploadError(`Some files failed to delete. Check the console for details.`);
      }

      // Refresh the file list and clear selection
      fetchAndSetRawFiles(displayedContainerForFiles);
      setSelectedFiles([]);
    } catch (error) {
      console.error("Error during bulk delete:", error);
      setUploadError(error instanceof Error ? `Error deleting files: ${error.message}` : 'Could not delete files.');
    } finally {
      setUploadStatus('');
    }
  };

  const PropertiesPane = ({ item, containerName, onRefresh }: { item: DisplayItem | null; containerName: string; onRefresh: () => void; }) => {
    if (!item) {
      return (
        <div className="w-96 flex-shrink-0 bg-white p-6 rounded-xl shadow-2xl flex items-center justify-center h-full">
          <p className="text-gray-500 text-center">Select an item to view its properties.</p>
        </div>
      );
    }

    const [newMetadataKey, setNewMetadataKey] = useState<string>('');
    const [newMetadataValue, setNewMetadataValue] = useState<string>('');
    const [editMetadata, setEditMetadata] = useState<Record<string, string>>(() => item.metadata || {});
    const [isSavingMetadata, setIsSavingMetadata] = useState<boolean>(false);
    const [metadataError, setMetadataError] = useState<string>('');

    // Reset editMetadata when item changes
    useEffect(() => {
      setEditMetadata(item.metadata || {});
      setNewMetadataKey('');
      setNewMetadataValue('');
      setMetadataError('');
    }, [item]);

    const handleAddMetadata = () => {
      setMetadataError('');
      if (!newMetadataKey.trim()) {
        setMetadataError('Metadata key cannot be empty.');
        return;
      }
      if (editMetadata.hasOwnProperty(newMetadataKey.trim())) {
        setMetadataError(`Metadata key "${newMetadataKey.trim()}" already exists. Please use a different key or edit the existing one.`);
        return;
      }
      setEditMetadata(prev => ({ ...prev, [newMetadataKey.trim()]: newMetadataValue.trim() }));
      setNewMetadataKey('');
      setNewMetadataValue('');
    };

    const handleSaveMetadata = async () => {
      if (item.isFolder) return; // Cannot add metadata to folders
      setIsSavingMetadata(true);
      setMetadataError('');
      try {
        const response = await fetch(`${backendApiBaseUrl}/${encodeURIComponent(containerName)}/${encodeURIComponent(item.fullPath)}/metadata`, {
          method: 'PUT',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(editMetadata)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to update metadata: ${response.status} - ${errorText || response.statusText}`);
        }

        // Refresh the file list to get updated metadata
        onRefresh();
        // Optionally, re-select the item to ensure the pane updates with fresh data
        // This might be handled by onRefresh if it also updates selectedItem
        console.log("Metadata updated successfully!");
      } catch (error) {
        console.error("Error saving metadata:", error);
        setMetadataError(error instanceof Error ? `Error saving metadata: ${error.message}` : 'An unknown error occurred while saving metadata.');
      } finally {
        setIsSavingMetadata(false);
      }
    };
  
    return (
      <div className="w-96 flex-shrink-0 bg-white p-6 rounded-xl shadow-2xl overflow-auto h-full">
<h3 className="text-xl font-semibold mb-4 text-gray-700 border-b pb-2">Properties</h3>
        <div className="space-y-3 text-sm text-left">
          <div>
            <label className="font-bold text-gray-600">Name:</label> {/* This is for the main item name, not metadata */}
            <p className="text-gray-800 break-words">{item.displayName}</p> {/* This is for the main item name, not metadata */}
          </div>
          {!item.isFolder && ( // Only show metadata for files
            <div className="mt-4 pt-4 border-t border-gray-200"> {/* Container for custom metadata section */}
              {Object.keys(editMetadata).length === 0 && <p className="text-gray-500 text-sm">No custom metadata.</p>}
              <div className="space-y-2">
                {Object.entries(editMetadata).map(([key, value]) => (
                  <div className="font-bold text-gray-600 break-all ">{key}:
                  <div key={key} className="rounded-md flex flex-wrap "> {/* Added flex-wrap */}
                    <div className="flex-grow min-w-0"> {/* Added flex-grow min-w-0 to allow text to wrap */}
                      
                      <p className="font-normal text-gray-800 break-words">{value}</p>
                    </div>
                    {/* Optional: Add a delete button for individual metadata entries */}
                  </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 border border-gray-200 rounded-md bg-gray-50">
                <h4 className="font-semibold text-gray-700 mb-2">Add New Property</h4>
                <div className="mb-2">
                  <input
                    type="text"
                    placeholder="Key"
                    value={newMetadataKey}
                    onChange={(e) => setNewMetadataKey(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md text-gray-800"
                  />
                </div>
                <div className="mb-2">
                  <input
                    type="text"
                    placeholder="Value"
                    value={newMetadataValue}
                    onChange={(e) => setNewMetadataValue(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md text-gray-800"
                  />
                </div>
                {metadataError && <p className="text-red-500 text-xs mb-2">{metadataError}</p>}
                <button
                  onClick={handleAddMetadata}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md text-sm"
                >
                  Add Property
                </button>
              </div>

              <button
                onClick={handleSaveMetadata}
                disabled={isSavingMetadata || item.isFolder}
                className={`mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md ${isSavingMetadata || item.isFolder ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isSavingMetadata ? 'Saving...' : 'Save All Metadata Changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    // Parent flex container: stacks vertically on small screens, horizontally on large screens
    <div className="flex flex-col gap-6 w-full"> {/* Always stack vertically */}
      
      {/* Left Panel: Upload Form */}
      <div className="w-full bg-white rounded-xl shadow-2xl"> {/* Takes full width, removed p-8 for now */}
        <div 
          className="flex justify-between items-center p-6 cursor-pointer hover:bg-gray-50 rounded-t-xl"
          onClick={() => setIsUploadFormCollapsed(!isUploadFormCollapsed)}
        >
          <h2 className="text-2xl font-bold text-gray-800">Upload Evidence</h2>
          <button
            aria-expanded={!isUploadFormCollapsed}
            aria-controls="upload-form-content"
            className="text-blue-600 hover:text-blue-800"
          >
            {isUploadFormCollapsed ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            )}
          </button>
        </div>

        {!isUploadFormCollapsed && (
          <div id="upload-form-content" className="p-8 pt-4"> {/* Added pt-4 to give some space from header */}
            {accounts.length === 0 && (
              <div className="mb-6 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700">
                <p className="font-bold">Authentication Required</p>
                <p>Please ensure you are logged in and have an active session to use the upload features.</p>
              </div>
            )}
            {/* <h2 className="text-3xl font-bold mb-8 text-center text-gray-800">Upload Evidence</h2> */} {/* Title moved to collapsible header */}

            <div className="mb-6">
              <label htmlFor="containerName" className="block text-gray-700 text-sm font-bold mb-2">
                Container Name:
              </label>
              <input
                type="text"
                id="containerName"
                value={containerNameInput}
                onChange={handleContainerNameChange}
                className="shadow-sm appearance-none border border-gray-300 rounded-md w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., matter1234"
                disabled={accounts.length === 0}
              />
              <button
                onClick={() => fetchAndSetRawFiles(containerNameInput)}
                disabled={isLoadingFiles || !containerNameInput || accounts.length === 0}
                className={`mt-3 w-full sm:w-auto bg-gray-700 hover:bg-gray-800 text-white font-semibold py-2 px-4 rounded-md focus:outline-none focus:shadow-outline transition duration-150 ease-in-out ${
                  (isLoadingFiles || !containerNameInput || accounts.length === 0) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md'
                }`}
              >
                {isLoadingFiles && displayedContainerForFiles === containerNameInput ? (
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : null}
                {isLoadingFiles && displayedContainerForFiles === containerNameInput ? 'Loading Files...' : 'View/Refresh Files in Container'}
              </button>
            </div>

            <div className="mb-8">
              <label htmlFor="fileInput" className="block text-gray-700 text-sm font-bold mb-2">
                Select File:
              </label>
              <label 
                htmlFor="fileInput" 
                className={`flex flex-col items-center justify-center w-full h-32 px-4 transition bg-white border-2 border-gray-300 border-dashed rounded-md appearance-none 
                            ${accounts.length === 0 ? 'cursor-not-allowed bg-gray-100' : 'cursor-pointer hover:border-gray-400 focus:outline-none'}
                            ${isDragging ? 'border-blue-500 bg-blue-50' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                  <span className="flex items-center space-x-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="font-medium text-gray-600">
                          {accounts.length > 0 ? <>Drop files to Attach, or <span className="text-blue-600 underline">browse</span></> : "Login to enable file selection"}
                      </span>
                  </span>
                  <input type="file" id="fileInput" multiple onChange={handleFileChange} className="hidden" disabled={accounts.length === 0} />
              </label>
              {filesToUpload.length > 0 && (
                <div className="mt-3 text-sm text-gray-700">
                  <p className="font-semibold mb-1">Selected files ({filesToUpload.length}):</p>
                  <ul className="list-disc list-inside max-h-24 overflow-y-auto bg-gray-50 p-2 rounded-md text-left">
                    {filesToUpload.map(file => (<li key={file.name} className="truncate">{file.name}</li>))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mb-6">
              <label htmlFor="folderName" className="block text-gray-700 text-sm font-bold mb-2">
                Folder Name (optional):
              </label>
              <input
                type="text"
                id="folderName"
                value={destinationPath}
                onChange={(e) => setDestinationPath(e.target.value)}
                className="shadow-sm appearance-none border border-gray-300 rounded-md w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., folderA/subfolderB"
                disabled={accounts.length === 0}
              />
            </div>

            <div className="mt-8">
              <button
                onClick={handleUpload}
                disabled={filesToUpload.length === 0 || !containerNameInput || uploadStatus.startsWith('Uploading') || accounts.length === 0}
                className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md focus:outline-none focus:shadow-outline transition duration-150 ease-in-out ${
                  (filesToUpload.length === 0 || !containerNameInput || uploadStatus.startsWith('Uploading') || accounts.length === 0) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-lg'
                }`}
              >
                {uploadStatus.startsWith('Uploading') ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            {uploadStatus && !uploadStatus.startsWith('Uploading') && (
              <p className="mt-6 text-center text-green-600 font-medium">{uploadStatus}</p>
            )}
            {uploadError && ( // Errors from upload or file listing (if not separated) will show here
              <p className="mt-6 text-center text-red-600 font-medium">{uploadError}</p>
            )}
          </div>
        )}
      </div>

      {/* Right Panel: File List */}
      <div className="flex gap-6">
        <div className="flex-grow bg-white p-8 rounded-xl shadow-2xl flex flex-col min-w-0"> {/* Takes remaining width */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-gray-700 truncate">
              {displayedContainerForFiles 
                ? `Container: '${displayedContainerForFiles}' ${currentPath ? `> ${currentPath}` : ''}` 
                : "Files in Container"}
            </h3>
            {currentPath && (
              <button 
                onClick={handleGoUp}
                className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-3 rounded-md flex-shrink-0"
              >
                &uarr; Up
              </button>
            )}
          </div>
          {/* Action Bar: Create Folder and Bulk Delete */}
          {displayedContainerForFiles && (
            <div className="mb-4 flex justify-between items-center">
                <button
                  onClick={handleBulkDelete}
                  disabled={selectedFiles.length === 0}
                  className={`bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md text-sm ${
                    selectedFiles.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Delete Selected ({selectedFiles.length})
                </button>
              </div>
          )}

          {isLoadingFiles ? ( 
            <div className="flex-grow flex justify-center items-center">
              <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="ml-2 text-gray-600">Loading...</p>
            </div>
          ) : displayedContainerForFiles ? (
            displayedItems.length > 0 ? (
              <div className="overflow-auto flex-grow">
                <p className="mb-2 text-sm text-gray-500">Items: {displayedItems.length}</p>
                <table className="min-w-full divide-y divide-gray-200 shadow-sm rounded-md overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr className="relative"> {/* Added relative for resize handles */}
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer relative"
                          onClick={() => handleSort('displayName')} style={{ width: columnWidths.displayName }}>
                        Name
                        {sortColumn === 'displayName' && (
                          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                        <div className="resize-handle" onMouseDown={(e) => startResize(e, 'displayName')}></div>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer relative"
                          onClick={() => handleSort('DocumentId')} style={{ width: columnWidths.DocumentId }}>
                        Document ID
                        {sortColumn === 'DocumentId' && (
                          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                        <div className="resize-handle" onMouseDown={(e) => startResize(e, 'DocumentId')}></div>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer relative"
                          onClick={() => handleSort('checksum')} style={{ width: columnWidths.checksum }}>
                        Checksum
                        {sortColumn === 'checksum' && (
                          <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                        <div className="resize-handle" onMouseDown={(e) => startResize(e, 'checksum')}></div>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider relative"
                          style={{ width: columnWidths.Actions }}>
                        Actions
                        <div className="resize-handle" onMouseDown={(e) => startResize(e, 'Actions')}></div>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider relative"
                          style={{ width: columnWidths.checkbox }}>
                          <input type="checkbox" onChange={handleSelectAll} checked={selectedFiles.length === displayedItems.filter(item => !item.isFolder).length && displayedItems.filter(item => !item.isFolder).length > 0} />
                          <div className="resize-handle" onMouseDown={(e) => startResize(e, 'checkbox')}></div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                  {displayedItems.map((item) => (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-gray-100 cursor-pointer ${selectedItem?.id === item.id ? 'bg-blue-100' : ''}`}
                      onClick={() => setSelectedItem(item)}
                      onDoubleClick={() => handleItemAction(item)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-left"
                          style={{ width: columnWidths.displayName }}>
                        <span className="flex items-center">
                          {item.isFolder ? <FolderIcon /> : getFileIcon(item.displayName)}
                          {item.displayName}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left"
                          style={{ width: columnWidths.DocumentId }}>
                        {!item.isFolder ? (item.metadata?.documentid || item.metadata?.DocumentId || 'N/A') : ''}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left"
                          style={{ width: columnWidths.checksum }}>
                        {item.checksum}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                          style={{ width: columnWidths.Actions }}>
                        {!item.isFolder && (
                          <button 
                            onClick={(e) => handleDeleteClick(item, e)} 
                            className="p-1 rounded-md hover:bg-red-100"
                            title={`Delete ${item.displayName}`}
                          >
                            <DeleteIcon />
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                          style={{ width: columnWidths.checkbox }}>
                          {!item.isFolder && (
                              <input
                                  type="checkbox"
                                  value={item.fullPath}
                                  onChange={(e) => handleCheckboxChange(e, item, displayedItems.filter(di => !di.isFolder).indexOf(item))}
                                  checked={selectedFiles.includes(item.fullPath)} // Check if the item's fullPath is in selectedFiles
                              />
                          )}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-grow flex justify-center items-center">
                <p className="text-gray-600">No items found in '{displayedContainerForFiles}{currentPath ? `/${currentPath}` : ''}'.</p>
              </div>
            )
          ) : (
            <div className="flex-grow flex justify-center items-center">
              <p className="text-gray-600">Enter a container name and click "View/Refresh Files" to list files.</p>
            </div>
          )}
          {/* Pagination Controls */}
          {displayedContainerForFiles && (rawBlobList.length > 0 || prevPageTokens.length > 1 || nextPageToken) && (
            <div className="flex justify-between items-center mt-4 p-2 border-t border-gray-200">
              <button
                onClick={handlePreviousPage}
                disabled={prevPageTokens.length <= 1 || isLoadingFiles}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-3 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                &larr; Previous
              </button>
              <span className="text-gray-600 text-sm">
                {isLoadingFiles ? "Loading..." : `Page ${prevPageTokens.length}`}
              </span>
              <button
                onClick={handleNextPage}
                disabled={!nextPageToken || isLoadingFiles}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-3 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>
        {displayedContainerForFiles && <PropertiesPane item={selectedItem} containerName={displayedContainerForFiles} onRefresh={refreshFilesAndSelection} />}
      </div>
    </div>
    );
  }


export default FileUploadForm;
