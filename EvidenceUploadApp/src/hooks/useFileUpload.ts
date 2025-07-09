import { useState } from 'react';
import type { FileToProcess, SasUploadInfo } from '../interfaces';
import * as apiService from '../services/apiService';

interface UseFileUploadProps {
  getAuthHeaders: (isFormData?: boolean) => HeadersInit;
}

export function useFileUpload({ getAuthHeaders }: UseFileUploadProps) {
  const [filesToProcess, setFilesToProcess] = useState<FileToProcess[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');

  const startUpload = async (containerName: string, destinationPath: string, onUploadComplete: (containerName: string) => void) => {
    if (filesToProcess.length === 0) {
      setUploadError('Please select one or more files to upload or clear existing files.');
      return;
    }

    setUploadStatus('Generating upload URL...');
    setUploadError('');

    try {
      const sasInfoArray: SasUploadInfo[] = await apiService.generateUploadUrls(containerName, getAuthHeaders);

      if (!sasInfoArray || sasInfoArray.length === 0) {
        throw new Error('Backend did not return any upload URLs.');
      }

      const containerSasDetails = sasInfoArray[0];

      let successfulUploadsCount = 0;
      let skippedUploadsCount = 0;
      let failedUploadsCount = 0;

      for (let i = 0; i < filesToProcess.length; i++) {
        let currentFileToProcess = filesToProcess[i];
        let uploadAttempted = false;

        while (!uploadAttempted) {
          const uploadResult = await uploadFileToBackend(
            currentFileToProcess,
            containerSasDetails,
            i,
            filesToProcess.length,
            destinationPath
          );

          if (uploadResult.status === 'success') {
            successfulUploadsCount++;
            uploadAttempted = true;
          } else if (uploadResult.status === 'conflict') {
            const confirmOverwrite = window.confirm(`${uploadResult.message}\nDo you want to overwrite it?`);
            if (confirmOverwrite) {
              setFilesToProcess(prev => prev.map((f, idx) => idx === i ? { ...f, overwrite: true, status: 'pending' } : f));
              currentFileToProcess = { ...currentFileToProcess, overwrite: true, status: 'pending' };
            } else {
              skippedUploadsCount++;
              uploadAttempted = true;
              setFilesToProcess(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'skipped' } : f));
            }
          } else { // status === 'error'
            failedUploadsCount++;
            uploadAttempted = true;
          }
        }
      }

      let finalMessage = '';
      if (successfulUploadsCount > 0) finalMessage += `${successfulUploadsCount} file(s) uploaded successfully.`;
      if (skippedUploadsCount > 0) finalMessage += ` ${skippedUploadsCount} file(s) skipped.`;
      if (failedUploadsCount > 0) {
        finalMessage += ` ${failedUploadsCount} file(s) failed to upload.`;
        setUploadError(`Upload errors: ${filesToProcess.filter(f => f.status === 'error').map(f => `${f.file.name}: ${f.errorMessage}`).join('; ')}`);
      }

      setUploadStatus(finalMessage);
      setFilesToProcess([]); // Clear processing list
      onUploadComplete(containerName); // Refresh file list

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

  const uploadFileToBackend = async (
    fileToProcess: FileToProcess,
    containerSasDetails: SasUploadInfo,
    index: number,
    totalFiles: number,
    destinationPath: string
  ): Promise<{ status: 'success' | 'conflict' | 'error', message?: string }> => {
    const file = fileToProcess.file;
    const progress = `(${index + 1}/${totalFiles})`;
    const finalPath = destinationPath.trim() === '' ? '' : (destinationPath.trim().endsWith('/') ? destinationPath.trim() : destinationPath.trim() + '/');
    const blobNameForUpload = finalPath + file.name;

    setUploadStatus(`Uploading ${progress}: "${blobNameForUpload}"...`);
    setFilesToProcess(prev => prev.map((f, idx) => idx === index ? { ...f, status: 'uploading' } : f));

    const uploadResult = await apiService.uploadFileViaSAS(containerSasDetails, file, destinationPath, fileToProcess.overwrite, getAuthHeaders);

    if (!uploadResult.success) {
      if (uploadResult.overwriteOption) {
        setFilesToProcess(prev => prev.map((f, idx) => idx === index ? { ...f, status: 'conflict', errorMessage: uploadResult.message } : f));
        return { status: 'conflict', message: uploadResult.message };
      }
      const errorMessage = uploadResult.message || `Upload failed for "${file.name}". Upload stopped.`;
      setFilesToProcess(prev => prev.map((f, idx) => idx === index ? { ...f, status: 'error', errorMessage: errorMessage } : f));
      return { status: 'error', message: errorMessage };
    }

    setFilesToProcess(prev => prev.map((f, idx) => idx === index ? { ...f, status: 'success' } : f));
    return { status: 'success' };
  };

  return { filesToProcess, setFilesToProcess, uploadStatus, setUploadStatus, uploadError, setUploadError, startUpload };
}