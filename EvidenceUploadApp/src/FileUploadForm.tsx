import { useState, type ChangeEvent } from 'react';

interface SasUploadInfo {
  blobUri: string;
  sharedAccessSignature: string;
  fullUploadUrl: string;
}

function FileUploadForm() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [containerName, setContainerName] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  const [filesInContainer, setFilesInContainer] = useState<string[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [displayedContainerForFiles, setDisplayedContainerForFiles] = useState<string>('');

  // Access the environment variable
  const backendApiBaseUrl = import.meta.env.VITE_BACKEND_API_BASE_URL || 'http://localhost:5230/api/files'; // Fallback for safety

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files && event.target.files.length > 0 ? event.target.files[0] : null);
    setUploadStatus('');
    setUploadError('');
  };

  const handleContainerNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setContainerName(event.target.value);
    setUploadStatus('');
    setUploadError('');
    // Optionally clear files when container name changes, or fetch new ones
    // setFilesInContainer([]); 
    // setDisplayedContainerForFiles('');
  };

  const fetchFiles = async (containerToFetch: string) => {
    if (!containerToFetch) {
      setUploadError("Container name is required to fetch files.");
      return;
    }
    setIsLoadingFiles(true);
    setUploadError(''); // Clear previous errors
    setFilesInContainer([]); // Clear previous file list
    try {
      const response = await fetch(`${backendApiBaseUrl}/list?targetContainerName=${encodeURIComponent(containerToFetch)}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list files: ${response.status} - ${errorText}`);
      }
      const data: string[] = await response.json();
      setFilesInContainer(data);
      setDisplayedContainerForFiles(containerToFetch);
    } catch (error) {
      setUploadError(error instanceof Error ? `Error fetching files: ${error.message}` : 'An unknown error occurred while fetching files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleUpload = async () => {
    // If this button is intended to be part of a <form> and of type="submit",
    // you would re-add 'event: FormEvent' as a parameter and call 'event.preventDefault()'.
    if (!selectedFile) {
      setUploadError('Please select a file.');
      return;
    }
    if (!containerName) {
      setUploadError('Please enter a container name.');
      return;
    }

    setUploadStatus('Generating upload URL...');
    setUploadError('');

    try {
      // Step 1: Get the container SAS URL from the backend API (this part remains the same)
      const generateUrl = `${backendApiBaseUrl}/generate-upload-urls?targetContainerName=${encodeURIComponent(containerName)}`;
      const generateResponse = await fetch(generateUrl, {
        method: 'POST',
        // If your backend requires authentication, add headers here (e.g., Authorization: Bearer <token>)
        // headers: {
        //   'Authorization': `Bearer ${yourAuthToken}`,
        // }
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
      
      setUploadStatus(`Preparing to upload "${selectedFile.name}"...`);

      // Step 2: Call the backend's /upload-via-sas endpoint
      // This endpoint will handle the existence check and the actual upload to Azure
      const formData = new FormData();
      formData.append('containerSasUrl', containerSasDetails.fullUploadUrl); // Send the full SAS URL for the container
      formData.append('file', selectedFile);

      setUploadStatus(`Uploading "${selectedFile.name}"...`);

      const uploadViaSasUrl = `${backendApiBaseUrl}/upload-via-sas`;
      const uploadResponse = await fetch(uploadViaSasUrl, {
        method: 'POST',
        body: formData,
        // Headers are set by FormData for multipart/form-data
        // If your backend /upload-via-sas needs authentication, add Authorization header here
      });

      if (!uploadResponse.ok) {
         if (uploadResponse.status === 409) {
            const errorBody = await uploadResponse.json(); // Assuming backend sends JSON for 409
            throw new Error(errorBody.message || `File "${selectedFile.name}" already exists.`);
         }
         const errorDetails = await uploadResponse.text(); // For other errors, get text
         throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorDetails}`);
      }

      setUploadStatus(`File "${selectedFile.name}" uploaded successfully!`);
      setSelectedFile(null); // Clear selected file after successful upload
      fetchFiles(containerName); // Refresh file list for the current container
      setContainerName(''); // Clear container name

    } catch (error) {
      console.error('Upload error:', error);
      if (error instanceof Error) {
        setUploadError(`Upload failed: ${error.message}`);
      } else {
        setUploadError('An unknown error occurred during upload.');
      }
      setUploadStatus('');
    }
  };

  return (
    <div className="w-full mx-auto p-8 bg-white rounded-xl shadow-2xl"> {/* Removed max-w-lg and mt-12 */}
      <h2 className="text-3xl font-bold mb-8 text-center text-gray-800">Upload Evidence</h2> {/* Kept text-center */}

      <div className="mb-6">
        <label htmlFor="containerName" className="block text-gray-700 text-sm font-bold mb-2">
          Container Name:
        </label>
        <input
          type="text"
          id="containerName"
          value={containerName}
          onChange={handleContainerNameChange}
          className="shadow-sm appearance-none border border-gray-300 rounded-md w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="e.g., matter1234"
        />
        <button
          onClick={() => fetchFiles(containerName)}
          disabled={isLoadingFiles || !containerName}
          className={`mt-3 w-full sm:w-auto bg-gray-700 hover:bg-gray-800 text-white font-semibold py-2 px-4 rounded-md focus:outline-none focus:shadow-outline transition duration-150 ease-in-out ${
            (isLoadingFiles || !containerName) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md'
          }`}
        >
          {isLoadingFiles && displayedContainerForFiles === containerName ? (
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : null}
          {isLoadingFiles && displayedContainerForFiles === containerName ? 'Loading Files...' : 'View/Refresh Files in Container'}
        </button>
      </div>

      <div className="mb-8">
        <label htmlFor="fileInput" className="block text-gray-700 text-sm font-bold mb-2">
          Select File:
        </label>
        <label htmlFor="fileInput" className="flex flex-col items-center justify-center w-full h-32 px-4 transition bg-white border-2 border-gray-300 border-dashed rounded-md appearance-none cursor-pointer hover:border-gray-400 focus:outline-none">
            <span className="flex items-center space-x-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="font-medium text-gray-600">
                    Drop files to Attach, or <span className="text-blue-600 underline">browse</span>
                </span>
            </span>
            <input type="file" id="fileInput" onChange={handleFileChange} className="hidden" />
        </label>
        {selectedFile && (
          <p className="mt-3 text-sm text-gray-700">Selected: <span className="font-semibold">{selectedFile.name}</span></p>
        )}
      </div>

      <div className="mt-8">
        <button
          onClick={handleUpload}
          disabled={!selectedFile || !containerName || uploadStatus.startsWith('Uploading')}
          className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md focus:outline-none focus:shadow-outline transition duration-150 ease-in-out ${
            (!selectedFile || !containerName || uploadStatus.startsWith('Uploading')) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-lg'
          }`}
        >
          {uploadStatus.startsWith('Uploading') ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {uploadStatus && !uploadStatus.startsWith('Uploading') && (
        <p className="mt-6 text-center text-green-600 font-medium">{uploadStatus}</p>
      )}
      {uploadError && (
        <p className="mt-6 text-center text-red-600 font-medium">{uploadError}</p>
      )}

      {/* File List Grid */}
      {!isLoadingFiles && filesInContainer.length > 0 && displayedContainerForFiles && (
        <div className="mt-10 pt-6 border-t border-gray-200">
          <h3 className="text-xl font-semibold mb-4 text-gray-700">
            Files in '{displayedContainerForFiles}' ({filesInContainer.length})
          </h3>
          <div className="overflow-x-auto"> {/* Add overflow for responsiveness */}
          <table className="min-w-full divide-y divide-gray-200 shadow-sm rounded-md overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  File Name
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
            {filesInContainer.map((fileName) => (
              <tr key={fileName} className="hover:bg-gray-100">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {fileName}
                </td>
              </tr>
            ))}
            </tbody>
          </table>
          </div> {/* End overflow-x-auto */}
        </div>
      )}
      {!isLoadingFiles && displayedContainerForFiles && filesInContainer.length === 0 && (
         <p className="mt-6 text-center text-gray-600">No files found in '{displayedContainerForFiles}'.</p>
      )}
    </div>
  );
}

export default FileUploadForm;
