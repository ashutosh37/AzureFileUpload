const backendApiBaseUrl = import.meta.env.VITE_BACKEND_API_BASE_URL || 'http://localhost:5230/api/files';

export const listFiles = async (
  containerName: string,
  getAuthHeaders: (isFormData?: boolean) => HeadersInit,
  continuationToken: string | null = null
) => {
  let url = `${backendApiBaseUrl}/list?targetContainerName=${encodeURIComponent(containerName)}`;
  if (continuationToken) {
    url += `&continuationToken=${encodeURIComponent(continuationToken)}`;
  }

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });

  if (response.status === 403) {
    const errorBody = await response.json();
    throw new Error(errorBody.Message || "You do not have access to view these files.");
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list files for '${containerName}': ${response.status} - ${errorText || response.statusText}`);
  }

  return response.json();
};

export const generateUploadUrls = async (
  containerName: string,
  getAuthHeaders: (isFormData?: boolean) => HeadersInit
) => {
  const generateUrl = `${backendApiBaseUrl}/generate-upload-urls?targetContainerName=${encodeURIComponent(containerName)}`;
  const response = await fetch(generateUrl, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (response.status === 403) {
    const errorBody = await response.json();
    throw new Error(errorBody.Message || "You do not have access to perform this action.");
  }

  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`Failed to get upload URL: ${response.status} ${response.statusText} - ${errorDetails}`);
  }

  return response.json();
};

export const uploadFileViaSAS = async (
  containerSasDetails: any, // Replace 'any' with your SasUploadInfo interface
  file: File,
  destinationPath: string,
  overwrite: boolean,
  getAuthHeaders: (isFormData?: boolean) => HeadersInit
) => {
  const finalPath = destinationPath.trim() === '' ? '' : (destinationPath.trim().endsWith('/') ? destinationPath.trim() : destinationPath.trim() + '/');
  const blobNameForUpload = finalPath + file.name;

  const formData = new FormData();
  formData.append('containerSasUrl', containerSasDetails.fullUploadUrl);
  formData.append('file', file, blobNameForUpload);
  formData.append('fileLastModified', new Date(file.lastModified).toISOString()); // Add last modified date
  if (overwrite) {
    formData.append('overwrite', 'true'); // Send overwrite flag
  }

  const uploadViaSasUrl = `${backendApiBaseUrl}/upload-via-sas`;
  const response = await fetch(uploadViaSasUrl, {
    method: 'POST',
    body: formData,
    headers: getAuthHeaders(true),
  });

  if (!response.ok) {
    return { success: false, ...await response.json() }; // Return failure with details
  }

  return { success: true }; // Return success
};

export const generateReadSAS = async (
  containerName: string,
  blobName: string,
  getAuthHeaders: (isFormData?: boolean) => HeadersInit
) => {
  const response = await fetch(`${backendApiBaseUrl}/generate-read-sas?targetContainerName=${encodeURIComponent(containerName)}&blobName=${encodeURIComponent(blobName)}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get download URL: ${response.status} - ${errorText || response.statusText}`);
  }

  return response.json();
};

export const deleteFile = async (containerName: string, blobName: string, getAuthHeaders: (isFormData?: boolean) => HeadersInit) => {
  return fetch(`${backendApiBaseUrl}?targetContainerName=${encodeURIComponent(containerName)}&blobName=${encodeURIComponent(blobName)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
};

export const updateMetadata = async (
  containerName: string,
  blobName: string,
  metadata: Record<string, string>,
  getAuthHeaders: (isFormData?: boolean) => HeadersInit
) => {
  const backendApiBaseUrl = import.meta.env.VITE_BACKEND_API_BASE_URL || 'http://localhost:5230/api/files';
  const response = await fetch(`${backendApiBaseUrl}/${encodeURIComponent(containerName)}/${encodeURIComponent(blobName)}/metadata`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update metadata: ${response.status} - ${errorText || response.statusText}`);
  }
  // No content is expected on success, so we don't need to return response.json()
};

export const getMessageFileContent = async (
  containerName: string,
  blobName: string,
  getAuthHeaders: (isFormData?: boolean) => HeadersInit
): Promise<any> => {
  const response = await fetch(`${backendApiBaseUrl}/message-content?targetContainerName=${encodeURIComponent(containerName)}&blobName=${encodeURIComponent(blobName)}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get message content: ${response.status} - ${errorText || response.statusText}`);
  }
  return response.json();
};