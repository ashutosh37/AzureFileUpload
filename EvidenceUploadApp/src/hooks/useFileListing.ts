import { useState, useEffect, type ChangeEvent } from 'react';
import type { BackendFileInfo, DisplayItem } from '../interfaces';
import * as apiService from '../services/apiService';

interface UseFileListingProps {
  initialContainerName?: string;
  initialFolderPath?: string;
  accessToken: string | null;
  getAuthHeaders: (isFormData?: boolean) => HeadersInit;
  setUploadStatus: (status: string) => void;
  setUploadError: (error: string) => void;
}

export function useFileListing({
  initialContainerName,
  initialFolderPath,
  accessToken,
  getAuthHeaders,
  setUploadStatus,
  setUploadError,
}: UseFileListingProps) {
  const [rawBlobList, setRawBlobList] = useState<BackendFileInfo[]>([]);
  const [displayedItems, setDisplayedItems] = useState<DisplayItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<string>('displayName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [prevPageTokens, setPrevPageTokens] = useState<(string | null)[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [lastClickedFileIndex, setLastClickedFileIndex] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<DisplayItem | null>(null);
  const [displayedContainerForFiles, setDisplayedContainerForFiles] = useState<string>('');

const fetchAndSetItems = async (containerToFetch: string, path: string | null = null, listFoldersOnly: boolean = false) => {
    if (!containerToFetch || !accessToken) {
      setUploadError("Container name and authentication are required to fetch files.");
      return;
    }

    setIsLoadingFiles(true);
    setUploadError('');

    // If we are changing the container or the path, reset relevant state
    if (displayedContainerForFiles !== containerToFetch || currentPath !== path) {
      setRawBlobList([]);
      setDisplayedItems([]);
      setSelectedItem(null);
      setPrevPageTokens([]);
      setNextPageToken(null);
      setLastClickedFileIndex(null);
      setSelectedFiles([]);
      setSortColumn('displayName');
      setSortDirection('asc');
    }

    try {
      const data: { items: BackendFileInfo[]; nextContinuationToken: string | null } = await apiService.listFiles(containerToFetch, getAuthHeaders, path, null, listFoldersOnly);
      setRawBlobList(data.items);
      setNextPageToken(data.nextContinuationToken);
      setPrevPageTokens([null]); // Reset pagination when fetching new path
      setDisplayedContainerForFiles(containerToFetch);
      setCurrentPath(path || ''); // Update current path based on the fetch
    } catch (error) {
      setRawBlobList([]);
      setDisplayedItems([]);
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
      const data: { items: BackendFileInfo[]; nextContinuationToken: string | null } = await apiService.listFiles(
        displayedContainerForFiles,
        getAuthHeaders,
        currentPath, // Pass the current folder path for correct pagination context
        token,       // The continuation token for the next page
        false        // We are paginating files/folders, not just folders
      );
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

  useEffect(() => {
    const itemsMap = new Map<string, DisplayItem>();
    rawBlobList.forEach(blob => {
      if (blob.name.startsWith(currentPath)) {
        const relativePath = blob.name.substring(currentPath.length);
        const segments = relativePath.split('/');
        const firstSegment = segments[0];

        if (segments.length > 1) {
          const folderFullPath = currentPath + firstSegment + '/'; // Ensure folder paths end with '/'
          if (!itemsMap.has(folderFullPath)) {
            itemsMap.set(folderFullPath, { id: folderFullPath, displayName: firstSegment, fullPath: folderFullPath, isFolder: true, checksum: "N/A", parentId: currentPath || undefined });
          }
        } else {
          // This is a file or folder directly in the current path
          // If currentPath is empty, we only want to show folders, not files.
          // If currentPath is not empty, we show both files and folders.
          // The condition `segments.length === 1` means it's either a file at the current level
          // or a folder that is explicitly represented as a blob (e.g., "myfolder/").
          // Assuming backend doesn't return explicit folder blobs, this branch is for files.
          if (currentPath !== '') { // Only add files if not at the root
            itemsMap.set(blob.name, { id: blob.name, displayName: firstSegment, fullPath: blob.name, isFolder: false, checksum: blob.checksum, metadata: blob.metadata, parentId: blob.parentId, documentId: blob.documentId });
          }
          // If currentPath is '', we do nothing here, effectively filtering out root-level files.
        }
      }
    });

    const getSortValue = (item: DisplayItem, column: string): any => {
      if (item.isFolder && column !== 'displayName') return '';
      switch (column) {
        case 'displayName': return item.displayName;
        case 'checksum': return item.checksum;
        case 'documentId':
          const docId = item.documentId;
          if (docId === undefined || docId === null) return '';
          const numDocId = Number(docId);
          return isNaN(numDocId) ? docId : numDocId;
        case 'parentId': return item.parentId || '';
        case 'createdDate': return item.metadata?.createdDate ? new Date(item.metadata.createdDate).getTime() : 0;
        case 'modifiedDate': return item.metadata?.modifiedDate ? new Date(item.metadata.modifiedDate).getTime() : 0;
        case 'modifiedBy': return item.metadata?.modifiedBy || '';
        default: return '';
      }
    };

    const sortedItems = Array.from(itemsMap.values()).sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      const aValue = getSortValue(a, sortColumn);
      const bValue = getSortValue(b, sortColumn);

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return sortDirection === 'asc' ? String(aValue).localeCompare(String(bValue)) : String(bValue).localeCompare(String(aValue));
    });

    setDisplayedItems(sortedItems);
    // Automatically select the first item in the list when the view loads/changes.
    if (sortedItems.length > 0) {
      setSelectedItem(sortedItems[0]);
    } else {
      // If the list is empty (e.g., navigating to an empty folder), ensure no item is selected.
      setSelectedItem(null);
    }
  }, [rawBlobList, currentPath, sortColumn, sortDirection]);

  useEffect(() => {
    if (initialContainerName && accessToken) {
      fetchAndSetItems(initialContainerName, initialFolderPath || null, !initialFolderPath); // Fetch root folders if no initial folder path, else fetch content of initial folder
    }
  }, [initialContainerName, accessToken]);

  useEffect(() => {
    if (initialFolderPath)
    {
      setCurrentPath(initialFolderPath);
    }
  }, [initialContainerName, initialFolderPath, accessToken]);

  const handleSort = (column: string) => {
    setSortDirection(prev => (sortColumn === column && prev === 'asc' ? 'desc' : 'asc'));
    setSortColumn(column);
  };

  const handleGoUp = () => {
    if (currentPath === '') return;
    const pathSegments = currentPath.slice(0, -1).split('/');
    pathSegments.pop();
    const newPath = pathSegments.length > 0 ? pathSegments.join('/') + '/' : '';
    fetchAndSetItems(displayedContainerForFiles, newPath, newPath === ''); // If going to root, list folders only
  };

  const handleBreadcrumbClick = (pathSegment: string) => {
    fetchAndSetItems(displayedContainerForFiles, pathSegment, false);
  };

  const handleNextPage = () => {
    if (nextPageToken) {
      setPrevPageTokens(prev => [...prev, nextPageToken]);
      goToPage(nextPageToken);
    }
  };
  const handlePreviousPage = () => {
    if (prevPageTokens.length <= 1) return;
    const newPrevPageTokens = prevPageTokens.slice(0, -1);
    goToPage(newPrevPageTokens[newPrevPageTokens.length - 1]);
    setPrevPageTokens(newPrevPageTokens);
  };

  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>, clickedItem: DisplayItem, currentIndex: number) => {
    const { checked } = event.target;
    const clickedFilePath = clickedItem.fullPath;

    if ((event.nativeEvent as MouseEvent).shiftKey && lastClickedFileIndex !== null) {
      const start = Math.min(lastClickedFileIndex, currentIndex);
      const end = Math.max(lastClickedFileIndex, currentIndex);

      const filesInCurrentView = displayedItems.filter(item => !item.isFolder);
      const pathsToToggle = filesInCurrentView.slice(start, end + 1).map(item => item.fullPath);

      setSelectedFiles(prevSelected => {
        const newSelected = new Set(prevSelected);
        if (checked) {
          pathsToToggle.forEach(path => newSelected.add(path));
        } else {
          pathsToToggle.forEach(path => newSelected.delete(path));
        }
        return Array.from(newSelected);
      });
    } else {
      setSelectedFiles(prevSelected => {
        if (checked) {
          return [...prevSelected, clickedFilePath];
        } else {
          return prevSelected.filter(path => path !== clickedFilePath);
        }
      });
      setLastClickedFileIndex(currentIndex);
    }
  };

  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.target;
    const allFilePaths = displayedItems.filter(item => !item.isFolder).map(item => item.fullPath);
    setSelectedFiles(checked ? allFilePaths : []);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0 || !window.confirm(`Are you sure you want to delete the selected ${selectedFiles.length} files? This action cannot be undone.`)) {
      return;
    }

    setUploadStatus(`Deleting ${selectedFiles.length} files...`);
    setUploadError('');

    try {
      const deletePromises = selectedFiles.map(blobName => apiService.deleteFile(displayedContainerForFiles, blobName, getAuthHeaders));
      const responses = await Promise.all(deletePromises);

      if (responses.every(response => response.ok)) {
        setUploadStatus(`${selectedFiles.length} files were deleted successfully.`);
      } else {
        const errorDetails = await Promise.all(responses.filter(r => !r.ok).map(r => r.text()));
        console.error('Some files failed to delete:', errorDetails);
        setUploadError(`Some files failed to delete. Check the console for details.`);
      }

      fetchAndSetItems(displayedContainerForFiles, currentPath);
      setSelectedFiles([]);
    } catch (error) {
      setUploadError(error instanceof Error ? `Error deleting files: ${error.message}` : 'Could not delete files.');
    } finally {
      setUploadStatus(''); // Clear status even if there was an error
    }    
  };

  return { displayedItems, currentPath, isLoadingFiles, displayedContainerForFiles, nextPageToken, prevPageTokens, sortColumn, sortDirection, selectedItem, selectedFiles, fetchAndSetItems, handleSort, handleGoUp, handleBreadcrumbClick, handleNextPage, handlePreviousPage, setCurrentPath, setSelectedItem, handleCheckboxChange, handleSelectAll, handleBulkDelete };
}