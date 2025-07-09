import { useState, type ChangeEvent, type DragEvent, type RefObject } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import type { FileToProcess } from '../interfaces';

interface UploadPaneProps {
  // State and state setters from parent
  containerNameInput: string;
  onContainerNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  destinationPath: string;
  onDestinationPathChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFetchFiles: () => void;
  isLoadingFiles: boolean;
  displayedContainerForFiles: string;
  accounts: Readonly<AccountInfo[]>;
  accessToken: string | null;
  initialContainerName?: string;
  initialFolderPath?: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  filesToProcess: FileToProcess[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onUpload: () => void;
  uploadStatus: string;
  uploadError: string;
}

export const UploadPane = ({
  containerNameInput,
  onContainerNameChange,
  destinationPath,
  onDestinationPathChange,
  onFetchFiles,
  isLoadingFiles,
  displayedContainerForFiles,
  accounts,
  accessToken,
  initialContainerName,
  initialFolderPath,
  onFileChange,
  onDrop,
  filesToProcess,
  fileInputRef,
  onUpload,
  uploadStatus,
  uploadError,
}: UploadPaneProps) => {
  const [isUploadFormCollapsed, setIsUploadFormCollapsed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

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

  return (
    <div className="w-full bg-white rounded-xl shadow-2xl">
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
        <div id="upload-form-content" className="p-8 pt-4">
          {accounts.length === 0 && (
            <div className="mb-6 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700">
              <p className="font-bold">Authentication Required</p>
              <p>Please ensure you are logged in and have an active session to use the upload features.</p>
            </div>
          )}

          <div className="mb-6">
            <label htmlFor="containerName" className="block text-gray-700 text-sm font-bold mb-2">
              Container Name:
            </label>
            <input
              type="text"
              id="containerName"
              value={containerNameInput}
              onChange={onContainerNameChange}
              className="shadow-sm appearance-none border border-gray-300 rounded-md w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., matter1234"
              disabled={accounts.length === 0 || !!initialContainerName}
            />
            <button
              onClick={onFetchFiles}
              disabled={isLoadingFiles || !containerNameInput || accounts.length === 0 || !accessToken || !!initialContainerName}
              className={`mt-3 w-full sm:w-auto bg-gray-700 hover:bg-gray-800 text-white font-semibold py-2 px-4 rounded-md focus:outline-none focus:shadow-outline transition duration-150 ease-in-out ${
                (isLoadingFiles || !containerNameInput || accounts.length === 0 || !accessToken || !!initialContainerName) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md'
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
              onDrop={onDrop}
            >
                <span className="flex items-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="font-medium text-gray-600">
                        {accounts.length > 0 ? <>Drop files to Attach, or <span className="text-blue-600 underline">browse</span></> : "Login to enable file selection"}
                    </span>
                </span>
                <input type="file" id="fileInput" multiple onChange={onFileChange} className="hidden" disabled={accounts.length === 0} ref={fileInputRef} />
            </label>
            {filesToProcess.length > 0 && (
              <div className="mt-3 text-sm text-gray-700">
                <p className="font-semibold mb-1">Files to upload ({filesToProcess.length}):</p>
                <ul className="list-disc list-inside max-h-24 overflow-y-auto bg-gray-50 p-2 rounded-md text-left">
                  {filesToProcess.map((f, index) => (
                    <li key={f.file.name + index} className={`truncate ${f.status === 'success' ? 'text-green-600' : f.status === 'error' ? 'text-red-600' : f.status === 'skipped' ? 'text-yellow-600' : f.status === 'conflict' ? 'text-orange-600' : ''}`}>
                      {f.file.name} {f.status !== 'pending' && `(${f.status}${f.errorMessage ? `: ${f.errorMessage}` : ''})`}
                    </li>
                  ))}
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
              onChange={onDestinationPathChange}
              className="shadow-sm appearance-none border border-gray-300 rounded-md w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., folderA/subfolderB"
              disabled={accounts.length === 0 || !!initialFolderPath} // Disable if initialFolderPath is provided
            />
          </div>

          <div className="mt-8">
            <button
              onClick={onUpload}
              disabled={filesToProcess.length === 0 || !containerNameInput || uploadStatus.startsWith('Uploading') || accounts.length === 0 || !accessToken}
              className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md focus:outline-none focus:shadow-outline transition duration-150 ease-in-out ${
                (filesToProcess.length === 0 || !containerNameInput || uploadStatus.startsWith('Uploading') || accounts.length === 0 || !accessToken) ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-lg'
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
  );
};